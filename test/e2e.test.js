import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rankpilot-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.CRON_SECRET = 'test-cron-secret';
process.env.DISABLE_SCHEDULER = '1';
for (const k of ['VERCEL', 'TURSO_DATABASE_URL', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GOOGLE_CLIENT_ID', 'DATAFORSEO_LOGIN', 'STRIPE_SECRET_KEY']) delete process.env[k];

const { createApp } = await import('../src/server.js');
const { tick } = await import('../src/scheduler.js');
const { q } = await import('../src/db.js');
const { planEconomics } = await import('../src/pricing.js');

let server, base, token;
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
};

before(async () => { server = createApp().listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

let locId;
test('signup gives trial credits', async () => {
  const r = await call('POST', '/api/auth/signup', { email: 'owner@test.dev', password: 'password123', name: 'Owner', company: 'Test Co' });
  assert.equal(r.status, 200); token = r.body.token;
  const me = await call('GET', '/api/me');
  assert.equal(me.body.tenant.plan, 'trial');
  assert.equal(me.body.tenant.credits_balance, 300);
});

test('upgrade (demo checkout) grants plan credits', async () => {
  const r = await call('POST', '/api/billing/checkout', { plan: 'growth' });
  assert.equal(r.body.mode, 'demo');
  const b = await call('GET', '/api/billing');
  assert.equal(b.body.plan, 'growth'); assert.equal(b.body.balance, 300 + 12000);
});

test('connect GBP (demo) and import location → keywords + audit', async () => {
  const c = await call('GET', '/api/google/connect');
  assert.equal(c.body.mode, 'demo');
  const remote = await call('GET', `/api/google/connections/${c.body.connection_id}/locations`);
  assert.ok(remote.body.length >= 1);
  const imp = await call('POST', '/api/google/import', { connection_id: c.body.connection_id, gbp_locations: [remote.body[0].gbp_location] });
  assert.equal(imp.body.imported.length, 1); locId = imp.body.imported[0];
  const kws = await call('GET', `/api/locations/${locId}/keywords`);
  assert.ok(kws.body.length > 10, 'keywords generated');
  assert.ok(kws.body.some((k) => k.keyword === 'plumber austin'));
  const reviews = await call('GET', `/api/locations/${locId}/reviews`);
  assert.equal(reviews.body.length, 10);
  const audit = await call('GET', `/api/locations/${locId}/audit`);
  assert.ok(audit.body.latest.score >= 0 && audit.body.latest.score < 70, `weak initial score ${audit.body.latest.score}`);
});

test('AI optimization raises audit score', async () => {
  const before = (await call('GET', `/api/locations/${locId}/audit`)).body.latest.score;
  const opt = await call('POST', `/api/locations/${locId}/optimize`);
  assert.ok(opt.body.description.length > 300);
  const ap = await call('POST', `/api/locations/${locId}/optimize/apply`, { description: opt.body.description, services: opt.body.services, secondary_categories: opt.body.secondary_categories });
  assert.ok(ap.body.audit.score > before, `${ap.body.audit.score} > ${before}`);
});

test('posts: generate, fill queue, scheduler publishes due', async () => {
  const p = await call('POST', `/api/locations/${locId}/posts/generate`, { keyword: 'drain cleaning austin' });
  assert.equal(p.body.status, 'draft'); assert.match(p.body.summary, /drain cleaning austin/i);
  const pub = await call('POST', `/api/posts/${p.body.id}/publish`);
  assert.equal(pub.body.status, 'published');
  const queue = await call('POST', `/api/locations/${locId}/posts/fill-queue`);
  assert.equal(queue.body.length, 3);
  assert.ok(queue.body.every((x) => x.status === 'scheduled' && x.cta_url?.includes('/t/')), 'WhatsApp tracked CTA');
  await q.run("UPDATE posts SET scheduled_at = datetime('now','-1 minute') WHERE id = ?", queue.body[0].id);
  await q.run("UPDATE locations SET last_autopilot_at = datetime('now')"); // isolate publishing
  const s = await tick();
  assert.equal(s.published, 1);
});

test('reviews auto-reply publishes positives, holds negatives', async () => {
  const r = await call('POST', `/api/locations/${locId}/reviews/auto-reply`);
  assert.ok(r.body.published >= 1);
  const rows = (await call('GET', `/api/locations/${locId}/reviews`)).body;
  assert.ok(rows.filter((x) => x.rating <= 2).every((x) => x.reply_status !== 'published' || x.reply === 'Thanks for choosing us!'));
});

test('geo-grid scan charges per point and computes metrics', async () => {
  const bal = (await call('GET', '/api/billing')).body.balance;
  const s = await call('POST', `/api/locations/${locId}/scans`, { keyword: 'plumber austin', grid_size: 7, radius_km: 6 });
  assert.equal(s.body.points.length, 49); assert.equal(s.body.credits_used, 49);
  assert.ok(s.body.solv >= 0 && s.body.atrp >= 1);
  assert.ok(s.body.competitors.length > 0);
  assert.equal((await call('GET', '/api/billing')).body.balance, bal - 49);
  const big = await call('POST', `/api/locations/${locId}/scans`, { keyword: 'plumber austin', grid_size: 15 });
  assert.equal(big.body.grid_size, 9, 'capped at plan maxGrid');
});

test('citations: order charges credits, verify detects NAP mismatch', async () => {
  const list = await call('GET', `/api/locations/${locId}/citations`);
  assert.ok(list.body.directories.some((d) => d.id === 'angi'), 'industry niche directory recommended');
  assert.ok(!list.body.directories.some((d) => d.id === 'healthgrades'), 'irrelevant niche excluded');
  const o = await call('POST', `/api/locations/${locId}/citations/order`, { directory_ids: ['yelp', 'bbb', 'angi'] });
  assert.equal(o.body.ordered.length, 3);
  assert.equal(o.body.ordered.find((x) => x.directory === 'Yelp').credits, 200);
  const cid = o.body.ordered[0].id;
  const v = await call('POST', `/api/locations/${locId}/citations/${cid}/verify`, { found_name: 'BluePeak Plumbing and Drains LLC', found_address: '1200 Congress Avenue', found_phone: '(512) 555-0100' });
  assert.deepEqual(v.body.issues, ['phone']);
});

test('tracking links redirect and count as leads', async () => {
  const l = await call('POST', `/api/locations/${locId}/tracking-links`, { channel: 'call' });
  const code = l.body.code;
  const r = await call('GET', `/t/${code}`);
  assert.equal(r.status, 200); assert.match(r.body, /tel:\+15125550142/);
  const links = await call('GET', `/api/locations/${locId}/tracking-links`);
  const wa = links.body.find((x) => x.channel === 'whatsapp');
  const r2 = await call('GET', `/t/${wa.code}`);
  assert.equal(r2.status, 302); assert.match(r2.headers.get('location'), /^https:\/\/wa\.me\/15125550142\?text=/);
  const ov = await call('GET', '/api/analytics/overview');
  assert.ok(ov.body.leads.tracked.call >= 1 && ov.body.leads.tracked.whatsapp >= 1);
  assert.ok(ov.body.leads.total_leads > 0 && ov.body.est_revenue > 0);
});

test('insufficient credits returns 402 and does not run', async () => {
  await q.run('UPDATE tenants SET credits_balance = 3');
  const r = await call('POST', `/api/locations/${locId}/posts/generate`, {});
  assert.equal(r.status, 402);
});

test('full autopilot run', async () => {
  await q.run('UPDATE tenants SET credits_balance = 5000');
  await q.run("UPDATE posts SET status='published', published_at = datetime('now') WHERE status='scheduled'");
  await q.run("UPDATE grid_scans SET created_at = datetime('now','-8 days')");
  const r = await call('POST', `/api/locations/${locId}/autopilot/run`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.scans.length, 3); assert.ok(r.body.audit > 0);
});

test('tenant isolation', async () => {
  const other = await call('POST', '/api/auth/signup', { email: 'x@test.dev', password: 'password123' });
  const saved = token; token = other.body.token;
  assert.equal((await call('GET', `/api/locations/${locId}`)).status, 404);
  assert.equal((await call('GET', '/api/locations')).body.length, 0);
  token = saved;
});

test('pricing economics keep healthy margins', async () => {
  for (const p of planEconomics()) assert.ok(p.gross_margin_at_full_use > 0.6, `${p.plan} margin ${p.gross_margin_at_full_use}`);
  const est = await call('POST', '/api/billing/estimate', { locations: 2, avg_lead_value: 200 });
  assert.equal(est.body.recommended.plan, 'growth');
});

test('cron endpoint requires CRON_SECRET and runs a tick', async () => {
  const saved = token; token = null;
  assert.equal((await call('GET', '/api/cron/tick')).status, 401);
  token = 'test-cron-secret';
  const r = await call('GET', '/api/cron/tick');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok('published' in r.body && 'deferred' in r.body);
  token = saved;
});

test('OAuth state is signed and tamper-proof', async () => {
  const { handleCallback } = await import('../src/services/google.js');
  await assert.rejects(handleCallback('code', 'forged.state'), /Invalid or expired OAuth state/);
});
