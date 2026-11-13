// Platform admin API (mounted at /api/admin, platform admins only).
// Organizations & subscriptions, API keys, plans & pricing, audit log.
import express from 'express';
import { q, hydrate } from './db.js';
import { signJwt } from './auth.js';
import { integrationStatus, config } from './config.js';
import { PLANS, TOPUPS, CREDIT_ACTIONS, valueMap, planEconomics } from './pricing.js';
import { grant } from './credits.js';
import * as settings from './settings.js';

export const admin = express.Router();
const STATUSES = ['active', 'past_due', 'suspended', 'cancelled'];
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ── Overview ────────────────────────────────────────────────────────────────
admin.get('/overview', async (req, res) => {
  const tenants = await q.all('SELECT id, plan, plan_status, credits_balance, created_at, plan_renews_at FROM tenants');
  const paidActive = tenants.filter((t) => t.plan !== 'trial' && t.plan_status === 'active');
  const mrr = paidActive.reduce((a, t) => a + (PLANS[t.plan]?.priceMonthly || 0), 0);
  const usage = await q.get(`SELECT COALESCE(-SUM(delta),0) credits, COALESCE(SUM(vendor_cost_usd),0) vendor FROM credit_ledger WHERE delta < 0 AND created_at >= datetime('now','-30 days')`);
  const byPlan = {}; const byStatus = {};
  for (const t of tenants) { byPlan[t.plan] = (byPlan[t.plan] || 0) + 1; byStatus[t.plan_status] = (byStatus[t.plan_status] || 0) + 1; }
  const count = async (sql) => (await q.get(sql)).n;
  const signups30 = tenants.filter((t) => (Date.now() - new Date(t.created_at + 'Z')) / 864e5 <= 30).length;
  const infra = 1.5 * paidActive.length + 0.6 * (await count('SELECT COUNT(*) n FROM locations'));
  const stripeFees = paidActive.reduce((a, t) => a + (PLANS[t.plan]?.priceMonthly || 0) * 0.029 + 0.3, 0);
  res.json({
    organizations: tenants.length, paying: paidActive.length, by_plan: byPlan, by_status: byStatus, signups_30d: signups30,
    mrr, arr: mrr * 12, arpa: paidActive.length ? Math.round((mrr / paidActive.length) * 100) / 100 : 0,
    credits_used_30d: usage.credits, vendor_cost_30d: Math.round(usage.vendor * 100) / 100,
    est_gross_margin: mrr ? Math.round(((mrr - usage.vendor - infra - stripeFees) / mrr) * 1000) / 10 : null,
    locations: await count('SELECT COUNT(*) n FROM locations'),
    posts_published_30d: await count("SELECT COUNT(*) n FROM posts WHERE status='published' AND published_at >= datetime('now','-30 days')"),
    scans_30d: await count("SELECT COUNT(*) n FROM grid_scans WHERE created_at >= datetime('now','-30 days')"),
    citations_open: await count("SELECT COUNT(*) n FROM citations WHERE status IN ('queued','in_progress','submitted')"),
    leads_30d: await count("SELECT COUNT(*) n FROM lead_events WHERE created_at >= datetime('now','-30 days')"),
    trials_expiring: await q.all(`SELECT t.id, t.name, t.plan_renews_at, (SELECT email FROM users WHERE tenant_id = t.id ORDER BY created_at LIMIT 1) email
                                  FROM tenants t WHERE t.plan = 'trial' AND t.plan_renews_at <= datetime('now','+7 days') ORDER BY t.plan_renews_at LIMIT 10`),
    low_credit: tenants.filter((t) => t.plan !== 'trial' && t.plan_status === 'active' && t.credits_balance < (PLANS[t.plan]?.credits || 0) * 0.1).length,
    integrations: integrationStatus(),
  });
});

// ── Organizations & subscriptions ───────────────────────────────────────────
admin.get('/tenants', async (req, res) => {
  const where = []; const args = [];
  if (req.query.q) { where.push('(t.name LIKE ? OR EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.email LIKE ?))'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.plan) { where.push('t.plan = ?'); args.push(req.query.plan); }
  if (req.query.status) { where.push('t.plan_status = ?'); args.push(req.query.status); }
  const rows = await q.all(`SELECT t.*,
      (SELECT email FROM users WHERE tenant_id = t.id ORDER BY created_at LIMIT 1) owner_email,
      (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) users,
      (SELECT COUNT(*) FROM locations WHERE tenant_id = t.id) locations,
      (SELECT COALESCE(-SUM(delta),0) FROM credit_ledger WHERE tenant_id = t.id AND delta < 0 AND created_at >= datetime('now','-30 days')) credits_used_30d,
      (SELECT COALESCE(SUM(vendor_cost_usd),0) FROM credit_ledger WHERE tenant_id = t.id AND created_at >= datetime('now','-30 days')) vendor_cost_30d,
      (SELECT MAX(created_at) FROM activity_log WHERE tenant_id = t.id) last_activity
    FROM tenants t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.created_at DESC LIMIT 500`, ...args);
  res.json(rows.map((t) => ({ ...t, plan_name: PLANS[t.plan]?.name || `${t.plan} (removed)`, mrr: t.plan !== 'trial' && t.plan_status === 'active' ? PLANS[t.plan]?.priceMonthly || 0 : 0 })));
});

admin.get('/tenants/:id', async (req, res) => {
  const t = await q.get('SELECT * FROM tenants WHERE id = ?', req.params.id);
  if (!t) return bad(res, 'Organization not found', 404);
  res.json({
    tenant: { ...t, plan_info: PLANS[t.plan] || null },
    users: await q.all('SELECT id, email, name, role, is_platform_admin, created_at FROM users WHERE tenant_id = ? ORDER BY created_at', t.id),
    locations: (await q.all('SELECT id, name, city, industry, gbp_location, last_synced_at, autopilot FROM locations WHERE tenant_id = ?', t.id)).map(hydrate),
    ledger: await q.all('SELECT * FROM credit_ledger WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50', t.id),
    activity: await q.all('SELECT * FROM activity_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20', t.id),
  });
});

admin.patch('/tenants/:id', async (req, res) => {
  const t = await q.get('SELECT * FROM tenants WHERE id = ?', req.params.id);
  if (!t) return bad(res, 'Organization not found', 404);
  const b = req.body || {};
  if (b.plan !== undefined && !PLANS[b.plan]) return bad(res, 'Unknown plan');
  if (b.plan_status !== undefined && !STATUSES.includes(b.plan_status)) return bad(res, `Status must be one of ${STATUSES.join(', ')}`);
  if (b.plan_renews_at !== undefined && b.plan_renews_at && Number.isNaN(Date.parse(b.plan_renews_at))) return bad(res, 'Invalid renewal date');
  const renews = b.plan_renews_at ? new Date(b.plan_renews_at).toISOString().replace('T', ' ').slice(0, 19) : t.plan_renews_at;
  await q.run('UPDATE tenants SET name = ?, plan = ?, plan_status = ?, plan_renews_at = ?, white_label_name = ? WHERE id = ?',
    b.name ?? t.name, b.plan ?? t.plan, b.plan_status ?? t.plan_status, renews, b.white_label_name ?? t.white_label_name, t.id);
  if (b.plan && b.plan !== t.plan && b.grant_plan_credits) await grant(t.id, PLANS[b.plan].credits, 'admin_plan_change', { note: `${t.plan} → ${b.plan} by ${req.user.email}` });
  await settings.audit(req.user, 'tenant.update', t.id, { from: { plan: t.plan, status: t.plan_status, renews: t.plan_renews_at }, to: b });
  res.json(await q.get('SELECT * FROM tenants WHERE id = ?', t.id));
});

admin.post('/tenants/:id/credits', async (req, res) => {
  const t = await q.get('SELECT id, credits_balance FROM tenants WHERE id = ?', req.params.id);
  if (!t) return bad(res, 'Organization not found', 404);
  const delta = Number(req.body?.delta); const note = String(req.body?.note || '').slice(0, 200);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10_000_000) return bad(res, 'Delta must be a non-zero whole number');
  if (!note) return bad(res, 'A reason is required');
  if (t.credits_balance + delta < 0) return bad(res, `Balance is ${t.credits_balance}; cannot remove ${-delta}`);
  const balance = await grant(t.id, delta, delta > 0 ? 'admin_grant' : 'admin_deduct', { note: `${note} (by ${req.user.email})` });
  await settings.audit(req.user, 'tenant.credits', t.id, { delta, note });
  res.json({ balance });
});

admin.post('/tenants/:id/impersonate', async (req, res) => {
  const u = await q.get('SELECT id, email FROM users WHERE tenant_id = ? ORDER BY created_at LIMIT 1', req.params.id);
  if (!u) return bad(res, 'Organization has no users', 404);
  await settings.audit(req.user, 'tenant.impersonate', req.params.id, { as: u.email });
  res.json({ token: signJwt({ uid: u.id, imp: req.user.id }, 60 * 60), email: u.email });
});

// ── API keys ────────────────────────────────────────────────────────────────
admin.get('/keys', async (req, res) => res.json({ keys: await settings.listKeys(), integrations: integrationStatus(), redirect_uri: config.google.redirectUri, webhook_url: `${config.baseUrl}/api/billing/webhook` }));
admin.put('/keys', async (req, res) => res.json({ changed: await settings.saveKeys(req.user, req.body || {}), keys: await settings.listKeys() }));
admin.delete('/keys/:name', async (req, res) => { await settings.clearKey(req.user, req.params.name); res.json({ keys: await settings.listKeys() }); });
admin.post('/keys/test/:group', async (req, res) => res.json(await settings.testKey(req.params.group)));

// ── Plans & pricing ─────────────────────────────────────────────────────────
admin.get('/pricing', async (req, res) => {
  await settings.refreshSettings({ force: true });
  const counts = Object.fromEntries((await q.all('SELECT plan, COUNT(*) n FROM tenants GROUP BY plan')).map((r) => [r.plan, r.n]));
  const custom = new Set((await q.all("SELECT key FROM platform_settings WHERE key LIKE 'pricing_%'")).map((r) => r.key));
  res.json({ plans: PLANS, topups: TOPUPS, actions: CREDIT_ACTIONS, value_map: valueMap('starter'), economics: planEconomics(), subscribers: counts, customized: [...custom] });
});
admin.put('/pricing/plans/:key', async (req, res) => res.json(await settings.upsertPlan(req.user, req.params.key, req.body || {})));
admin.delete('/pricing/plans/:key', async (req, res) => { await settings.deletePlan(req.user, req.params.key); res.json({ ok: true }); });
admin.put('/pricing/topups', async (req, res) => res.json(await settings.saveTopups(req.user, req.body?.topups)));
admin.put('/pricing/actions', async (req, res) => res.json(await settings.saveActionPrices(req.user, req.body || {})));
admin.post('/pricing/reset', async (req, res) => { await settings.resetPricing(req.user, req.body?.what || 'all'); res.json({ ok: true }); });

// ── Audit log ───────────────────────────────────────────────────────────────
admin.get('/audit', async (req, res) => res.json(await q.all('SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 200')));
