import express from 'express';
import { q, id, hydrate, logActivity } from './db.js';
import { config, integrationStatus } from './config.js';
import { signJwt, hashPassword, checkPassword, requireAuth, requirePlatformAdmin } from './auth.js';
import { PLANS, TOPUPS, CREDIT_ACTIONS, valueMap, planEconomics, monthlyWorkload, roiProjection } from './pricing.js';
import { balance, usageSummary, charge, refund, grant } from './credits.js';
import { checkout, handleWebhook } from './billing.js';
import { industryList, getIndustry } from './services/industries.js';
import * as google from './services/google.js';
import * as auto from './services/automation.js';
import { recommendedDirectories, DIRECTORIES, napMatch } from './services/citations.js';
import { createLink, recordLead, leadSummary } from './services/leads.js';

export const api = express.Router();
const loc = (req) => auto.getLocation(req.tenantId, req.params.id);

// ── Public ──────────────────────────────────────────────────────────────────
api.get('/health', (req, res) => res.json({ ok: true, integrations: integrationStatus() }));
api.get('/meta', (req, res) => res.json({
  industries: industryList(), plans: PLANS, topups: TOPUPS, actions: CREDIT_ACTIONS, integrations: integrationStatus(),
}));
api.get('/pricing', (req, res) => res.json({ plans: PLANS, topups: TOPUPS, value_map: valueMap(req.query.plan || 'starter'), economics: planEconomics(), reference_workload: monthlyWorkload() }));

api.post('/auth/signup', (req, res) => {
  const { email, password, name, company } = req.body || {};
  if (!email || !password || password.length < 8) return res.status(400).json({ error: 'Email and password (8+ chars) required' });
  if (q.get('SELECT id FROM users WHERE email = ?', email.toLowerCase())) return res.status(409).json({ error: 'Email already registered' });
  const tenantId = id('ten_'); const userId = id('usr_');
  q.run("INSERT INTO tenants (id, name, plan, plan_renews_at) VALUES (?,?, 'trial', datetime('now', '+14 days'))", tenantId, company || `${name || email}'s workspace`);
  q.run('INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES (?,?,?,?,?)', userId, tenantId, email.toLowerCase(), name || null, hashPassword(password));
  grant(tenantId, PLANS.trial.credits, 'trial_credits');
  res.json({ token: signJwt({ uid: userId }) });
});

api.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = q.get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase());
  if (!u || !checkPassword(password || '', u.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: signJwt({ uid: u.id }) });
});

api.get('/google/callback', async (req, res) => {
  try {
    const { tenantId, connectionId } = await google.handleCallback(req.query.code, req.query.state);
    logActivity(tenantId, null, 'connect', 'Google account connected');
    res.redirect(`/#locations?connection=${connectionId}`);
  } catch (e) { res.redirect(`/#locations?error=${encodeURIComponent(e.message)}`); }
});

api.post('/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  res.json(handleWebhook(req.body, req.headers['stripe-signature']));
});

// ── Authenticated ───────────────────────────────────────────────────────────
api.use(requireAuth);

api.get('/me', (req, res) => {
  const t = q.get('SELECT * FROM tenants WHERE id = ?', req.tenantId);
  res.json({ user: req.user, tenant: { ...t, plan_info: PLANS[t.plan] }, integrations: integrationStatus() });
});

// Google connections
api.get('/google/connect', (req, res) => {
  if (config.google.enabled && req.query.demo !== '1') return res.json({ mode: 'live', url: google.authUrl(req.tenantId) });
  res.json({ mode: 'demo', connection_id: google.createDemoConnection(req.tenantId) });
});
api.get('/google/connections', (req, res) => res.json(q.all('SELECT id, google_email, mode, created_at FROM google_connections WHERE tenant_id = ?', req.tenantId)));
api.get('/google/connections/:cid/locations', async (req, res) => {
  const conn = q.get('SELECT * FROM google_connections WHERE id = ? AND tenant_id = ?', req.params.cid, req.tenantId);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  const remote = await google.listRemoteLocations(conn);
  const imported = new Set(q.all('SELECT gbp_location FROM locations WHERE tenant_id = ?', req.tenantId).map((r) => r.gbp_location));
  res.json(remote.map((r) => ({ ...r, imported: imported.has(r.gbp_location) })));
});
api.post('/google/import', async (req, res) => {
  const { connection_id, gbp_locations = [] } = req.body || {};
  const conn = q.get('SELECT * FROM google_connections WHERE id = ? AND tenant_id = ?', connection_id, req.tenantId);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  const remote = (await google.listRemoteLocations(conn)).filter((r) => gbp_locations.includes(r.gbp_location));
  const ids = remote.map((r) => auto.importLocation(req.tenantId, conn.id, r));
  for (const lid of ids) { await auto.syncLocation(req.tenantId, lid); await auto.buildKeywords(req.tenantId, lid); auto.runAudit(req.tenantId, lid); }
  res.json({ imported: ids });
});

// Locations
api.get('/locations', (req, res) => {
  const rows = q.all('SELECT * FROM locations WHERE tenant_id = ? ORDER BY created_at', req.tenantId).map(hydrate);
  res.json(rows.map((l) => ({
    ...l,
    score: q.get('SELECT score FROM audits WHERE location_id = ? ORDER BY created_at DESC LIMIT 1', l.id)?.score ?? null,
    last_scan: q.get('SELECT keyword, solv, atrp, created_at FROM grid_scans WHERE location_id = ? ORDER BY created_at DESC LIMIT 1', l.id) || null,
    leads_30d: leadSummary([l.id], 30).total_leads,
  })));
});
api.post('/locations', async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const lid = auto.importLocation(req.tenantId, null, { ...b, industry: b.industry || auto.guessIndustry(b.primary_category) });
  await auto.buildKeywords(req.tenantId, lid);
  auto.runAudit(req.tenantId, lid);
  res.json(auto.getLocation(req.tenantId, lid));
});
api.get('/locations/:id', (req, res) => res.json({ ...loc(req), industry_playbook: getIndustry(loc(req).industry) }));
api.patch('/locations/:id', (req, res) => { loc(req); auto.updateLocationFields(req.params.id, req.body || {}); res.json(loc(req)); });
api.put('/locations/:id/autopilot', (req, res) => {
  const l = loc(req); auto.updateLocationFields(l.id, { autopilot: { ...l.autopilot, ...(req.body || {}) } });
  logActivity(req.tenantId, l.id, 'autopilot', `Autopilot settings updated`); res.json(loc(req).autopilot);
});
api.delete('/locations/:id', (req, res) => { loc(req); q.run('DELETE FROM locations WHERE id = ?', req.params.id); res.json({ ok: true }); });
api.post('/locations/:id/sync', async (req, res) => res.json(await auto.syncLocation(req.tenantId, loc(req).id)));
api.post('/locations/:id/autopilot/run', async (req, res) => res.json(await auto.runAutopilot(req.tenantId, loc(req).id)));

// Keywords
api.get('/locations/:id/keywords', (req, res) => res.json(auto.listKeywords(loc(req).id)));
api.post('/locations/:id/keywords/build', async (req, res) => res.json(await auto.buildKeywords(req.tenantId, loc(req).id, { withVolumes: Boolean(req.body?.with_volumes) })));
api.post('/locations/:id/keywords', (req, res) => {
  const l = loc(req); const kw = String(req.body?.keyword || '').toLowerCase().trim();
  if (!kw) return res.status(400).json({ error: 'keyword required' });
  q.run('INSERT OR IGNORE INTO keywords (id, tenant_id, location_id, keyword, intent, priority) VALUES (?,?,?,?,?,?)', id('kw_'), req.tenantId, l.id, kw, 'custom', Number(req.body.priority || 1));
  res.json(auto.listKeywords(l.id));
});
api.patch('/keywords/:kid', (req, res) => {
  const k = q.get('SELECT * FROM keywords WHERE id = ? AND tenant_id = ?', req.params.kid, req.tenantId);
  if (!k) return res.status(404).json({ error: 'Not found' });
  q.run('UPDATE keywords SET tracked = ?, priority = ? WHERE id = ?', req.body.tracked ?? k.tracked, req.body.priority ?? k.priority, k.id);
  res.json(q.get('SELECT * FROM keywords WHERE id = ?', k.id));
});
api.delete('/keywords/:kid', (req, res) => { q.run('DELETE FROM keywords WHERE id = ? AND tenant_id = ?', req.params.kid, req.tenantId); res.json({ ok: true }); });

// Audit & optimization
api.post('/locations/:id/audit', (req, res) => res.json(auto.runAudit(req.tenantId, loc(req).id)));
api.get('/locations/:id/audit', (req, res) => {
  const a = q.get('SELECT * FROM audits WHERE location_id = ? ORDER BY created_at DESC LIMIT 1', loc(req).id);
  const history = q.all('SELECT score, created_at FROM audits WHERE location_id = ? ORDER BY created_at', req.params.id);
  res.json({ latest: a ? { ...hydrate(a).report, created_at: a.created_at } : null, history });
});
api.post('/locations/:id/optimize', async (req, res) => res.json(await auto.generateOptimization(req.tenantId, loc(req).id)));
api.post('/locations/:id/optimize/apply', async (req, res) => {
  const r = await auto.applyOptimization(req.tenantId, loc(req).id, req.body || {});
  res.json({ ...r, audit: auto.runAudit(req.tenantId, req.params.id) });
});

// Posts
api.get('/locations/:id/posts', (req, res) => res.json(q.all('SELECT * FROM posts WHERE location_id = ? ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT 200', loc(req).id)));
api.post('/locations/:id/posts/generate', async (req, res) => {
  const b = req.body || {};
  res.json(await auto.createAiPost(req.tenantId, loc(req).id, { keyword: b.keyword, theme: b.theme, topicType: b.topic_type, offer: b.offer, scheduledAt: b.scheduled_at }));
});
api.post('/locations/:id/posts/fill-queue', async (req, res) => res.json(await auto.fillPostingQueue(req.tenantId, loc(req).id)));
api.post('/locations/:id/posts', (req, res) => {
  const l = loc(req); const b = req.body || {};
  if (!b.summary) return res.status(400).json({ error: 'summary required' });
  const pid = id('po_');
  q.run('INSERT INTO posts (id, tenant_id, location_id, topic_type, summary, cta_type, cta_url, keyword, status, scheduled_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    pid, req.tenantId, l.id, b.topic_type || 'STANDARD', b.summary, b.cta_type || null, b.cta_url || null, b.keyword || null, b.scheduled_at ? 'scheduled' : 'draft', b.scheduled_at || null);
  res.json(q.get('SELECT * FROM posts WHERE id = ?', pid));
});
api.patch('/posts/:pid', (req, res) => {
  const p = q.get('SELECT * FROM posts WHERE id = ? AND tenant_id = ?', req.params.pid, req.tenantId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  let status = b.status ?? p.status;
  if (b.approve) status = (b.scheduled_at ?? p.scheduled_at) ? 'scheduled' : 'draft';
  q.run('UPDATE posts SET summary = ?, scheduled_at = ?, status = ?, cta_type = ?, cta_url = ? WHERE id = ?',
    b.summary ?? p.summary, b.scheduled_at ?? p.scheduled_at, status, b.cta_type ?? p.cta_type, b.cta_url ?? p.cta_url, p.id);
  res.json(q.get('SELECT * FROM posts WHERE id = ?', p.id));
});
api.post('/posts/:pid/publish', async (req, res) => res.json(await auto.publishPostNow(req.tenantId, req.params.pid)));
api.delete('/posts/:pid', (req, res) => { q.run("DELETE FROM posts WHERE id = ? AND tenant_id = ? AND status != 'published'", req.params.pid, req.tenantId); res.json({ ok: true }); });

// Reviews
api.get('/locations/:id/reviews', (req, res) => res.json(q.all('SELECT * FROM reviews WHERE location_id = ? ORDER BY review_time DESC', loc(req).id)));
api.post('/locations/:id/reviews/auto-reply', async (req, res) => res.json(await auto.autoReplyReviews(req.tenantId, loc(req).id)));
api.post('/reviews/:rid/draft', async (req, res) => res.json(await auto.draftReply(req.tenantId, req.params.rid)));
api.post('/reviews/:rid/publish', async (req, res) => res.json(await auto.publishReply(req.tenantId, req.params.rid, req.body?.reply)));

// Geo-grid
api.post('/locations/:id/scans', async (req, res) => {
  const b = req.body || {};
  if (!b.keyword) return res.status(400).json({ error: 'keyword required' });
  res.json(await auto.scanKeyword(req.tenantId, loc(req).id, b.keyword, { size: b.grid_size, radiusKm: b.radius_km }));
});
api.get('/locations/:id/scans', (req, res) => res.json(q.all('SELECT id, keyword, grid_size, radius_km, arp, atrp, solv, mode, credits_used, created_at FROM grid_scans WHERE location_id = ? ORDER BY created_at DESC LIMIT 100', loc(req).id)));
api.get('/scans/:sid', (req, res) => {
  const s = hydrate(q.get('SELECT * FROM grid_scans WHERE id = ? AND tenant_id = ?', req.params.sid, req.tenantId));
  if (!s) return res.status(404).json({ error: 'Not found' });
  const l = q.get('SELECT lat, lng, name FROM locations WHERE id = ?', s.location_id);
  res.json({ ...s, center: l });
});

// Citations
api.get('/locations/:id/citations', (req, res) => {
  const l = loc(req);
  const existing = new Map(q.all('SELECT * FROM citations WHERE location_id = ?', l.id).map((c) => [c.directory_id, c]));
  const dirs = recommendedDirectories(l, getIndustry(l.industry)).map((d) => ({ ...d, credits: CREDIT_ACTIONS[d.credit_action].credits, citation: existing.get(d.id) || null }));
  const live = [...existing.values()].filter((c) => c.status === 'live');
  res.json({ directories: dirs, summary: { recommended: dirs.length, live: live.length, in_progress: [...existing.values()].filter((c) => ['queued', 'in_progress', 'submitted'].includes(c.status)).length, nap_issues: live.filter((c) => c.nap_match === 0).length } });
});
api.post('/locations/:id/citations/order', (req, res) => {
  const l = loc(req); const ids = req.body?.directory_ids || [];
  const ordered = [];
  for (const did of ids) {
    const d = DIRECTORIES.find((x) => x.id === did);
    if (!d || d.managed) continue;
    if (q.get('SELECT id FROM citations WHERE location_id = ? AND directory_id = ?', l.id, did)) continue;
    const action = d.tier === 'aggregator' ? 'citation_aggregator' : d.tier === 'premium' ? 'citation_premium' : 'citation_standard';
    const cid = id('ci_');
    const c = charge(req.tenantId, action, { locationId: l.id, refId: cid, note: d.name });
    q.run('INSERT INTO citations (id, tenant_id, location_id, directory_id, status, credits_charged) VALUES (?,?,?,?,?,?)', cid, req.tenantId, l.id, did, 'queued', c.credits);
    ordered.push({ id: cid, directory: d.name, credits: c.credits });
  }
  if (ordered.length) logActivity(req.tenantId, l.id, 'citations', `Ordered ${ordered.length} citations`);
  res.json({ ordered, balance: balance(req.tenantId) });
});
api.post('/locations/:id/citations/:cid/verify', (req, res) => {
  // Record what was found on a directory (by fulfilment team, scanner, or the customer) and check NAP.
  const l = loc(req);
  const c = q.get('SELECT * FROM citations WHERE id = ? AND location_id = ?', req.params.cid, l.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { listing_url, found_name, found_address, found_phone } = req.body || {};
  const m = napMatch(l, { name: found_name, address: found_address, phone: found_phone });
  q.run("UPDATE citations SET status = 'live', listing_url = ?, found_name = ?, found_address = ?, found_phone = ?, nap_match = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
    listing_url || c.listing_url, found_name || null, found_address || null, found_phone || null, m.match ? 1 : 0, m.issues.length ? `NAP mismatch: ${m.issues.join(', ')}` : null, c.id);
  res.json({ ...q.get('SELECT * FROM citations WHERE id = ?', c.id), issues: m.issues });
});
// Fulfilment queue for platform operators
api.get('/admin/citations', requirePlatformAdmin, (req, res) => res.json(q.all(`SELECT c.*, l.name, l.address, l.city, l.phone, l.website FROM citations c JOIN locations l ON l.id = c.location_id WHERE c.status IN ('queued','in_progress','submitted') ORDER BY c.created_at`)));
api.patch('/admin/citations/:cid', requirePlatformAdmin, (req, res) => {
  const c = q.get('SELECT * FROM citations WHERE id = ?', req.params.cid);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const status = req.body.status;
  if (!['queued', 'in_progress', 'submitted', 'live', 'rejected'].includes(status)) return res.status(400).json({ error: 'bad status' });
  q.run("UPDATE citations SET status = ?, listing_url = COALESCE(?, listing_url), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?", status, req.body.listing_url || null, req.body.notes || null, c.id);
  if (status === 'rejected' && c.credits_charged) refund(c.tenant_id, 'citation', c.credits_charged, { locationId: c.location_id, refId: c.id });
  res.json(q.get('SELECT * FROM citations WHERE id = ?', c.id));
});

// Lead tracking
api.get('/locations/:id/tracking-links', (req, res) => {
  const l = loc(req);
  const links = q.all('SELECT * FROM tracking_links WHERE location_id = ? ORDER BY created_at', l.id);
  res.json(links.map((t) => ({ ...t, url: `${config.baseUrl}/t/${t.code}`, clicks_30d: q.get("SELECT COUNT(*) n FROM lead_events WHERE link_id = ? AND created_at >= datetime('now','-30 days')", t.id).n })));
});
api.post('/locations/:id/tracking-links', (req, res) => {
  const l = loc(req); const b = req.body || {};
  const link = createLink(req.tenantId, l, b.channel, { label: b.label, message: b.message, number: b.number });
  res.json({ ...link, url: `${config.baseUrl}/t/${link.code}` });
});
api.post('/locations/:id/leads', (req, res) => {
  // Manual / webhook lead logging (e.g. from call-tracking provider or CRM)
  const l = loc(req); const { channel, source = 'manual', meta } = req.body || {};
  if (!['call', 'sms', 'whatsapp', 'form', 'booking'].includes(channel)) return res.status(400).json({ error: 'bad channel' });
  recordLead({ tenantId: req.tenantId, locationId: l.id, channel, source, meta }); res.json({ ok: true });
});

// Analytics / ROI
api.get('/analytics/overview', (req, res) => {
  const days = Number(req.query.days || 30);
  const locs = req.query.location_id ? [auto.getLocation(req.tenantId, req.query.location_id)] : q.all('SELECT * FROM locations WHERE tenant_id = ?', req.tenantId);
  const ids = locs.map((l) => l.id);
  const leads = leadSummary(ids, days);
  const t = q.get('SELECT * FROM tenants WHERE id = ?', req.tenantId);
  const avgVal = locs.length ? locs.reduce((a, l) => a + (l.avg_lead_value || 100), 0) / locs.length : 100;
  const close = locs.length ? locs.reduce((a, l) => a + (l.close_rate || 0.3), 0) / locs.length : 0.3;
  const estRevenue = Math.round(leads.total_leads * close * avgVal);
  const cost = PLANS[t.plan]?.priceMonthly || 0;
  const usage = usageSummary(req.tenantId, days);
  const prevLeads = leadSummary(ids, days * 2).total_leads - leads.total_leads;
  res.json({
    days, leads, est_revenue: estRevenue, plan_cost: cost, roi_multiple: cost ? Math.round((estRevenue / cost) * 10) / 10 : null,
    lead_growth_pct: prevLeads > 0 ? Math.round(((leads.total_leads - prevLeads) / prevLeads) * 100) : null,
    cost_per_lead: leads.total_leads && cost ? Math.round((cost / leads.total_leads) * 100) / 100 : null,
    credits: { balance: balance(req.tenantId), used: usage.reduce((a, u) => a + u.credits, 0) },
    usage,
    activity: q.all(`SELECT * FROM activity_log WHERE tenant_id = ? ${req.query.location_id ? 'AND location_id = ?' : ''} ORDER BY created_at DESC LIMIT 25`, req.tenantId, ...(req.query.location_id ? [req.query.location_id] : [])),
  });
});

// Billing
api.get('/billing', (req, res) => {
  const t = q.get('SELECT * FROM tenants WHERE id = ?', req.tenantId);
  res.json({
    plan: t.plan, plan_status: t.plan_status, renews_at: t.plan_renews_at, balance: t.credits_balance,
    plans: PLANS, topups: TOPUPS, usage_30d: usageSummary(req.tenantId, 30),
    ledger: q.all('SELECT * FROM credit_ledger WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50', req.tenantId),
    value_map: valueMap(t.plan === 'trial' ? 'starter' : t.plan), economics: planEconomics(),
  });
});
api.post('/billing/checkout', async (req, res) => {
  const t = q.get('SELECT * FROM tenants WHERE id = ?', req.tenantId);
  res.json(await checkout(t, req.body || {}));
});
api.post('/billing/estimate', (req, res) => {
  const b = req.body || {};
  const workload = monthlyWorkload({ postsPerWeek: b.posts_per_week, reviewsPerMonth: b.reviews_per_month, keywords: b.keywords, gridSize: b.grid_size, scansPerMonth: b.scans_per_month, citationsPerMonth: b.citations_per_month });
  const perLoc = workload.total_credits; const locsN = Number(b.locations || 1);
  const need = perLoc * locsN;
  const fit = Object.entries(PLANS).filter(([, p]) => p.priceMonthly && p.locations >= locsN)
    .map(([k, p]) => { const extra = Math.max(0, need - p.credits); const packs = Math.ceil(extra / TOPUPS[1].credits); return { plan: k, name: p.name, monthly_total: p.priceMonthly + packs * TOPUPS[1].priceUsd, topups_needed: packs }; })
    .sort((a, b) => a.monthly_total - b.monthly_total);
  res.json({ workload, credits_needed: need, recommended: fit[0] || null, options: fit, roi: roiProjection({ planKey: fit[0]?.plan, avgLeadValue: Number(b.avg_lead_value || 150), closeRate: Number(b.close_rate || 0.3), baselineLeads: Number(b.baseline_leads || 20) * locsN }) });
});

api.get('/activity', (req, res) => res.json(q.all('SELECT * FROM activity_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100', req.tenantId)));

// Public tracking redirect lives outside /api (see server.js)
export function trackingRedirect(req, res) {
  const link = q.get('SELECT * FROM tracking_links WHERE code = ?', req.params.code);
  if (!link) return res.status(404).send('Link not found');
  recordLead({ tenantId: link.tenant_id, locationId: link.location_id, channel: link.channel, source: 'tracking_link', linkId: link.id, meta: { ua: req.headers['user-agent']?.slice(0, 160), ref: req.headers.referer || null } });
  if (link.target.startsWith('http')) return res.redirect(302, link.target);
  // tel:/sms: — browsers need an HTML hop for custom schemes on some clients
  res.type('html').send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><meta http-equiv="refresh" content="0;url=${link.target.replace(/"/g, '')}"><a href="${link.target.replace(/"/g, '')}" style="font:18px system-ui">Continue</a>`);
}
