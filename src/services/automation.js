// Automation engine: every high-level operation lives here so the API, the
// scheduler (autopilot) and tests share one implementation.
import { q, id, hydrate, logActivity } from '../db.js';
import { charge, refund } from '../credits.js';
import { PLANS } from '../pricing.js';
import * as google from './google.js';
import * as ai from './ai.js';
import { generateKeywords, enrichVolumes } from './keywords.js';
import { auditLocation } from './audit.js';
import { runScan } from './geogrid.js';
import { getIndustry } from './industries.js';
import { createLink } from './leads.js';
import { config } from '../config.js';

export const DEFAULT_AUTOPILOT = {
  enabled: true,
  posts_per_week: 3,
  post_weekdays: [1, 3, 5], // Mon, Wed, Fri
  post_hour_utc: 15,
  approval_required: false,
  auto_reply_reviews: true,
  auto_reply_min_rating: 4, // below this, drafts wait for approval
  weekly_scan: true,
  scan_keywords: 3,
  grid_size: 7,
  radius_km: 5,
  sync_hours: 24,
  post_cta_channel: 'whatsapp', // call | whatsapp | sms | website
};

export const getLocation = async (tenantId, locationId) => {
  const l = hydrate(await q.get('SELECT * FROM locations WHERE id = ? AND tenant_id = ?', locationId, tenantId));
  if (!l) throw Object.assign(new Error('Location not found'), { status: 404 });
  l.autopilot = { ...DEFAULT_AUTOPILOT, ...(l.autopilot || {}) };
  return l;
};

export async function updateLocationFields(locationId, fields) {
  const allowed = ['name', 'industry', 'primary_category', 'secondary_categories', 'description', 'phone', 'whatsapp', 'website', 'address', 'city', 'region', 'postal_code', 'country', 'lat', 'lng', 'service_areas', 'services', 'hours', 'attributes', 'photos_count', 'avg_lead_value', 'close_rate', 'autopilot', 'place_id'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k) && fields[k] !== undefined);
  if (!keys.length) return;
  const vals = keys.map((k) => (typeof fields[k] === 'object' && fields[k] !== null ? JSON.stringify(fields[k]) : fields[k]));
  await q.run(`UPDATE locations SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...vals, locationId);
}

export async function locationLimit(tenantId) {
  const t = await q.get('SELECT plan FROM tenants WHERE id = ?', tenantId);
  return PLANS[t?.plan]?.locations ?? 1;
}

export async function importLocation(tenantId, connectionId, remote) {
  const count = (await q.get('SELECT COUNT(*) n FROM locations WHERE tenant_id = ?', tenantId)).n;
  if (count >= await locationLimit(tenantId)) throw Object.assign(new Error('Location limit reached for your plan — upgrade to add more'), { status: 402 });
  const existing = remote.gbp_location && await q.get('SELECT id FROM locations WHERE tenant_id = ? AND gbp_location = ?', tenantId, remote.gbp_location);
  if (existing) return existing.id;
  const locId = id('loc_');
  await q.run('INSERT INTO locations (id, tenant_id, connection_id, name) VALUES (?,?,?,?)', locId, tenantId, connectionId, remote.name);
  await q.run('UPDATE locations SET gbp_account = ?, gbp_location = ? WHERE id = ?', remote.gbp_account || null, remote.gbp_location || null, locId);
  await updateLocationFields(locId, { ...remote, industry: remote.industry || guessIndustry(remote.primary_category), autopilot: DEFAULT_AUTOPILOT });
  await logActivity(tenantId, locId, 'connect', `Connected ${remote.name}`);
  return locId;
}

export function guessIndustry(category = '') {
  const c = String(category).toLowerCase();
  const map = [['plumb', 'plumber'], ['electric', 'electrician'], ['hvac', 'hvac'], ['air condition', 'hvac'], ['heating', 'hvac'], ['dent', 'dentist'], ['law', 'lawyer'], ['attorney', 'lawyer'], ['restaurant', 'restaurant'], ['cafe', 'restaurant'], ['salon', 'salon'], ['spa', 'salon'], ['real estate', 'real_estate'], ['auto', 'auto_repair'], ['mechanic', 'auto_repair'], ['clinic', 'medical_clinic'], ['doctor', 'medical_clinic']];
  return map.find(([k]) => c.includes(k))?.[1] || 'general';
}

// ── Sync ────────────────────────────────────────────────────────────────────
export async function syncLocation(tenantId, locationId) {
  const loc = await getLocation(tenantId, locationId);
  const reviews = await google.fetchReviews(loc);
  for (const r of reviews) {
    await q.run(`INSERT INTO reviews (id, tenant_id, location_id, gbp_review_name, reviewer, rating, comment, review_time, reply, reply_status)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(location_id, gbp_review_name) DO UPDATE SET rating=excluded.rating, comment=excluded.comment,
             reply = COALESCE(reviews.reply, excluded.reply),
             reply_status = CASE WHEN reviews.reply_status IN ('draft','pending_approval') THEN reviews.reply_status WHEN excluded.reply IS NOT NULL THEN 'published' ELSE reviews.reply_status END`,
      id('rv_'), tenantId, loc.id, r.gbp_review_name, r.reviewer, r.rating, r.comment, r.review_time, r.reply, r.reply ? 'published' : 'none');
  }
  const perf = await google.fetchPerformance(loc, 60);
  for (const p of perf) await q.run('INSERT INTO gbp_metrics (location_id, date, metric, value) VALUES (?,?,?,?) ON CONFLICT DO UPDATE SET value = excluded.value', loc.id, p.date, p.metric, p.value);
  await q.run("UPDATE locations SET last_synced_at = datetime('now') WHERE id = ?", loc.id);
  await charge(tenantId, 'sync_profile', { locationId });
  await logActivity(tenantId, loc.id, 'sync', `Synced ${reviews.length} reviews and ${perf.length} insight datapoints`);
  return { reviews: reviews.length, metrics: perf.length };
}

// ── Keywords ────────────────────────────────────────────────────────────────
export async function buildKeywords(tenantId, locationId, { withVolumes = false } = {}) {
  const loc = await getLocation(tenantId, locationId);
  let kws = generateKeywords(loc);
  if (withVolumes) {
    const c = await charge(tenantId, 'keyword_research', { locationId, note: `${kws.length} keywords` });
    try { kws = await enrichVolumes(kws, { country: loc.country }); }
    catch (e) { await refund(tenantId, 'keyword_research', c.credits, { locationId }); throw e; }
  }
  for (const k of kws) {
    await q.run(`INSERT INTO keywords (id, tenant_id, location_id, keyword, intent, priority, search_volume, cpc) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(location_id, keyword) DO UPDATE SET search_volume = COALESCE(excluded.search_volume, keywords.search_volume), cpc = COALESCE(excluded.cpc, keywords.cpc)`,
      id('kw_'), tenantId, loc.id, k.keyword, k.intent, k.priority, k.search_volume ?? null, k.cpc ?? null);
  }
  await logActivity(tenantId, loc.id, 'keywords', `Built ${kws.length} keywords${withVolumes ? ' with search volumes' : ''}`);
  return await listKeywords(locationId);
}

export const listKeywords = async (locationId) => await q.all('SELECT * FROM keywords WHERE location_id = ? ORDER BY priority, COALESCE(search_volume,0) DESC', locationId);

/** Keyword rotation: next keyword to target = highest priority, least recently used. */
async function nextKeyword(locationId) {
  const k = await q.get(`SELECT * FROM keywords WHERE location_id = ? AND tracked = 1 ORDER BY (last_used_at IS NOT NULL), last_used_at, priority, COALESCE(search_volume,0) DESC LIMIT 1`, locationId);
  if (k) await q.run("UPDATE keywords SET last_used_at = datetime('now') WHERE id = ?", k.id);
  return k?.keyword;
}

// ── Audit & optimization ────────────────────────────────────────────────────
export async function runAudit(tenantId, locationId) {
  const loc = await getLocation(tenantId, locationId);
  const ctx = {
    keywords: await listKeywords(loc.id),
    reviews: await q.all('SELECT * FROM reviews WHERE location_id = ?', loc.id),
    posts: await q.all('SELECT * FROM posts WHERE location_id = ?', loc.id),
    citations: await q.all('SELECT * FROM citations WHERE location_id = ?', loc.id),
    lastScan: await q.get('SELECT keyword, solv, atrp, arp FROM grid_scans WHERE location_id = ? ORDER BY created_at DESC LIMIT 1', loc.id),
    trackingLinks: await q.all('SELECT channel FROM tracking_links WHERE location_id = ?', loc.id),
  };
  const report = auditLocation(loc, ctx);
  const auditId = id('au_');
  await q.run('INSERT INTO audits (id, tenant_id, location_id, score, report) VALUES (?,?,?,?,?)', auditId, tenantId, loc.id, report.score, JSON.stringify(report));
  return { id: auditId, ...report };
}

export async function generateOptimization(tenantId, locationId) {
  const loc = await getLocation(tenantId, locationId);
  const kws = (await listKeywords(loc.id)).length ? await listKeywords(loc.id) : await buildKeywords(tenantId, locationId);
  const c = await charge(tenantId, 'ai_profile_optimize', { locationId });
  try {
    const result = await ai.optimizeProfile(loc, kws);
    await logActivity(tenantId, loc.id, 'optimize', 'Generated AI profile optimization proposal');
    return { ...result, credits_used: c.credits };
  } catch (e) { await refund(tenantId, 'ai_profile_optimize', c.credits, { locationId }); throw e; }
}

export async function applyOptimization(tenantId, locationId, { description, services, secondary_categories }) {
  const loc = await getLocation(tenantId, locationId);
  const push = await google.updateProfile(loc, { description, services });
  await updateLocationFields(loc.id, {
    description: description ?? loc.description, services: services ?? loc.services,
    secondary_categories: secondary_categories ?? loc.secondary_categories,
  });
  await logActivity(tenantId, loc.id, 'optimize', `Applied optimization to Google (${push.mode}): ${push.updated.join(', ') || 'local only'}`);
  return { pushed: push, note: secondary_categories ? 'Categories are applied locally; confirm category IDs in GBP (category IDs must match Google taxonomy).' : undefined };
}

// ── Posts ───
// CTA follows the location's autopilot lead channel so every post click is a
// tracked call / SMS / WhatsApp lead.
// ───────────────────────────────────────────────────────────────────
async function ctaFor(tenantId, loc) {
  const ch = loc.autopilot?.post_cta_channel || 'whatsapp';
  if (ch === 'call') return { cta_type: 'CALL', cta_url: null };
  if (ch === 'website') return { cta_type: 'LEARN_MORE', cta_url: loc.website };
  let link = await q.get('SELECT * FROM tracking_links WHERE location_id = ? AND channel = ? ORDER BY created_at LIMIT 1', loc.id, ch);
  if (!link) { try { link = await createLink(tenantId, loc, ch, { label: `${ch} (GBP posts)` }); } catch { return { cta_type: 'CALL', cta_url: null }; } }
  return { cta_type: 'LEARN_MORE', cta_url: `${config.baseUrl}/t/${link.code}` };
}

export async function createAiPost(tenantId, locationId, { keyword, theme, topicType = 'STANDARD', offer, scheduledAt, source = 'manual', status } = {}) {
  const loc = await getLocation(tenantId, locationId);
  keyword ||= await nextKeyword(loc.id) || `${loc.primary_category || 'services'} ${loc.city || ''}`.trim();
  const c = await charge(tenantId, 'ai_post', { locationId, note: keyword });
  let gen;
  try { gen = await ai.generatePost(loc, { keyword, theme, topicType, offer }); }
  catch (e) { await refund(tenantId, 'ai_post', c.credits, { locationId }); throw e; }
  const cta = await ctaFor(tenantId, loc);
  const postId = id('po_');
  const st = status || (scheduledAt ? (loc.autopilot.approval_required && source === 'autopilot' ? 'pending_approval' : 'scheduled') : 'draft');
  await q.run(`INSERT INTO posts (id, tenant_id, location_id, topic_type, summary, cta_type, cta_url, keyword, offer, status, scheduled_at, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, postId, tenantId, loc.id, topicType, gen.summary,
    cta.cta_type, cta.cta_url, keyword, offer || null, st, scheduledAt || null, source);
  return { ...(await q.get('SELECT * FROM posts WHERE id = ?', postId)), image_prompt: gen.image_prompt, ai_mode: gen.mode };
}

export async function publishPostNow(tenantId, postId) {
  const post = await q.get('SELECT * FROM posts WHERE id = ? AND tenant_id = ?', postId, tenantId);
  if (!post) throw Object.assign(new Error('Post not found'), { status: 404 });
  if (post.status === 'published') return post;
  const loc = await getLocation(tenantId, post.location_id);
  const c = await charge(tenantId, 'publish_post', { locationId: loc.id, refId: post.id });
  try {
    const r = await google.publishPost(loc, post);
    await q.run("UPDATE posts SET status = 'published', published_at = datetime('now'), gbp_post_name = ?, error = NULL WHERE id = ?", r.name, post.id);
    await logActivity(tenantId, loc.id, 'post', `Published post targeting "${post.keyword}" (${r.mode})`);
  } catch (e) {
    await refund(tenantId, 'publish_post', c.credits, { locationId: loc.id, refId: post.id });
    await q.run("UPDATE posts SET status = 'failed', error = ? WHERE id = ?", e.message, post.id);
    throw e;
  }
  return await q.get('SELECT * FROM posts WHERE id = ?', post.id);
}

/** Next N posting slots according to autopilot weekdays/hour. */
export function nextSlots(autopilot, count, from = new Date()) {
  const slots = []; const d = new Date(from);
  d.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 60 && slots.length < count; i++) {
    const cand = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + i, autopilot.post_hour_utc));
    if (cand > from && autopilot.post_weekdays.includes(cand.getUTCDay())) slots.push(cand);
  }
  return slots;
}

export async function fillPostingQueue(tenantId, locationId) {
  const loc = await getLocation(tenantId, locationId);
  const ap = loc.autopilot;
  const upcoming = (await q.all("SELECT scheduled_at FROM posts WHERE location_id = ? AND status IN ('scheduled','pending_approval') AND scheduled_at > datetime('now')", loc.id)).map((p) => p.scheduled_at);
  const weekdays = ap.post_weekdays.slice(0, ap.posts_per_week);
  const slots = nextSlots({ ...ap, post_weekdays: weekdays }, ap.posts_per_week).filter((s) => !upcoming.some((u) => Math.abs(new Date(u + 'Z') - s) < 36e5));
  const ind = getIndustry(loc.industry);
  const created = [];
  for (const [i, slot] of slots.entries()) {
    const topicType = i % 3 === 2 ? 'OFFER' : 'STANDARD';
    const post = await createAiPost(tenantId, loc.id, {
      scheduledAt: slot.toISOString().replace('T', ' ').slice(0, 19), source: 'autopilot', topicType,
      theme: ind.postThemes[(new Date(slot).getUTCDate() + i) % ind.postThemes.length],
      offer: topicType === 'OFFER' ? 'Free estimate for new customers this month' : undefined,
    });
    created.push(post);
  }
  if (created.length) await logActivity(tenantId, loc.id, 'autopilot', `Scheduled ${created.length} keyword-targeted posts`);
  return created;
}

// ── Reviews ─────────────────────────────────────────────────────────────────
export async function draftReply(tenantId, reviewId) {
  const rv = await q.get('SELECT * FROM reviews WHERE id = ? AND tenant_id = ?', reviewId, tenantId);
  if (!rv) throw Object.assign(new Error('Review not found'), { status: 404 });
  const loc = await getLocation(tenantId, rv.location_id);
  const c = await charge(tenantId, 'ai_review_reply', { locationId: loc.id, refId: rv.id });
  try {
    const r = await ai.generateReviewReply(loc, rv, (await listKeywords(loc.id)).slice(0, 5).map((k) => k.keyword));
    await q.run("UPDATE reviews SET reply = ?, reply_status = ? WHERE id = ?", r.reply, r.needs_human ? 'pending_approval' : 'draft', rv.id);
    return { ...(await q.get('SELECT * FROM reviews WHERE id = ?', rv.id)), needs_human: r.needs_human, sentiment: r.sentiment };
  } catch (e) { await refund(tenantId, 'ai_review_reply', c.credits, { locationId: loc.id }); throw e; }
}

export async function publishReply(tenantId, reviewId, text) {
  const rv = await q.get('SELECT * FROM reviews WHERE id = ? AND tenant_id = ?', reviewId, tenantId);
  if (!rv) throw Object.assign(new Error('Review not found'), { status: 404 });
  const reply = text || rv.reply;
  if (!reply) throw Object.assign(new Error('No reply text'), { status: 400 });
  const loc = await getLocation(tenantId, rv.location_id);
  await google.replyToReview(loc, rv.gbp_review_name, reply);
  await q.run("UPDATE reviews SET reply = ?, reply_status = 'published', replied_at = datetime('now') WHERE id = ?", reply, rv.id);
  return await q.get('SELECT * FROM reviews WHERE id = ?', rv.id);
}

export async function autoReplyReviews(tenantId, locationId) {
  const loc = await getLocation(tenantId, locationId);
  const pending = await q.all("SELECT * FROM reviews WHERE location_id = ? AND reply_status = 'none' AND reply IS NULL ORDER BY review_time DESC LIMIT 20", loc.id);
  let published = 0, held = 0;
  for (const rv of pending) {
    const d = await draftReply(tenantId, rv.id);
    if (!d.needs_human && rv.rating >= loc.autopilot.auto_reply_min_rating) { await publishReply(tenantId, rv.id); published++; }
    else { await q.run("UPDATE reviews SET reply_status = 'pending_approval' WHERE id = ?", rv.id); held++; }
  }
  if (pending.length) await logActivity(tenantId, loc.id, 'reviews', `Auto-replied to ${published} reviews, ${held} held for approval`);
  return { published, held };
}

// ── Geo-grid ────────────────────────────────────────────────────────────────
export async function scanKeyword(tenantId, locationId, keyword, { size, radiusKm } = {}) {
  const loc = await getLocation(tenantId, locationId);
  const plan = PLANS[(await q.get('SELECT plan FROM tenants WHERE id = ?', tenantId)).plan] || PLANS.trial;
  size = Math.min(Number(size || loc.autopilot.grid_size || 7), plan.maxGrid || 5);
  if (size % 2 === 0) size -= 1;
  radiusKm = Number(radiusKm || loc.autopilot.radius_km || 5);
  const points = size * size;
  const c = await charge(tenantId, 'grid_point', { qty: points, locationId, note: `${keyword} ${size}x${size}` });
  let scan;
  try {
    const audit = await q.get('SELECT score FROM audits WHERE location_id = ? ORDER BY created_at DESC LIMIT 1', loc.id);
    const published = (await q.get("SELECT COUNT(*) n FROM posts WHERE location_id = ? AND status = 'published'", loc.id)).n;
    const strength = Math.min(0.95, ((audit?.score ?? 40) / 100) * 0.8 + Math.min(published, 20) / 100);
    scan = await runScan(loc, keyword, { size, radiusKm, strength });
  } catch (e) { await refund(tenantId, 'grid_point', c.credits, { locationId }); throw e; }
  const scanId = id('gs_');
  await q.run(`INSERT INTO grid_scans (id, tenant_id, location_id, keyword, grid_size, radius_km, points, arp, atrp, solv, competitors, mode, credits_used)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, scanId, tenantId, loc.id, keyword, size, radiusKm, JSON.stringify(scan.points), scan.arp, scan.atrp, scan.solv, JSON.stringify(scan.competitors), scan.mode, c.credits);
  await logActivity(tenantId, loc.id, 'scan', `Geo-grid "${keyword}" ${size}×${size}: SoLV ${scan.solv}%, ATRP ${scan.atrp}`);
  return hydrate(await q.get('SELECT * FROM grid_scans WHERE id = ?', scanId));
}

// ── Autopilot tick for one location ─────────────────────────────────────────
export async function runAutopilot(tenantId, locationId) {
  const loc = await getLocation(tenantId, locationId);
  const ap = loc.autopilot; const out = {};
  if (!ap.enabled) return { skipped: 'autopilot disabled' };
  const hoursSinceSync = loc.last_synced_at ? (Date.now() - new Date(loc.last_synced_at + 'Z')) / 36e5 : Infinity;
  if (hoursSinceSync >= ap.sync_hours) out.sync = await syncLocation(tenantId, loc.id);
  if (!(await listKeywords(loc.id)).length) await buildKeywords(tenantId, loc.id);
  out.posts = (await fillPostingQueue(tenantId, loc.id)).length;
  if (ap.auto_reply_reviews) out.reviews = await autoReplyReviews(tenantId, loc.id);
  if (ap.weekly_scan) {
    const last = await q.get('SELECT created_at FROM grid_scans WHERE location_id = ? ORDER BY created_at DESC LIMIT 1', loc.id);
    if (!last || (Date.now() - new Date(last.created_at + 'Z')) / 864e5 >= 7) {
      const kws = await q.all('SELECT keyword FROM keywords WHERE location_id = ? AND tracked = 1 ORDER BY priority, COALESCE(search_volume,0) DESC LIMIT ?', loc.id, ap.scan_keywords);
      out.scans = [];
      for (const k of kws) out.scans.push((await scanKeyword(tenantId, loc.id, k.keyword)).solv);
    }
  }
  out.audit = (await runAudit(tenantId, loc.id)).score;
  return out;
}
