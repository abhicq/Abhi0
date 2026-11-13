import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rankpilot-admin-'));
process.env.DB_PATH = path.join(tmpDir, 'admin.db');
process.env.ADMIN_EMAILS = 'boss@test.dev';
process.env.SETTINGS_TTL_MS = '0';
for (const k of ['VERCEL', 'TURSO_DATABASE_URL', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DATAFORSEO_LOGIN', 'STRIPE_SECRET_KEY']) delete process.env[k];

const { createApp } = await import('../src/server.js');
const { q } = await import('../src/db.js');
const { config } = await import('../src/config.js');

let server, base;
const call = async (token, method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => { server = createApp().listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

let adminT, userT, userTenant;
test('ADMIN_EMAILS user becomes platform admin; others are blocked from /admin', async () => {
  adminT = (await call(null, 'POST', '/api/auth/signup', { email: 'boss@test.dev', password: 'password123' })).body.token;
  userT = (await call(null, 'POST', '/api/auth/signup', { email: 'cust@test.dev', password: 'password123', company: 'Cust Co' })).body.token;
  userTenant = (await call(userT, 'GET', '/api/me')).body.tenant.id;
  assert.equal((await call(userT, 'GET', '/api/admin/overview')).status, 403);
  const o = await call(adminT, 'GET', '/api/admin/overview');
  assert.equal(o.status, 200); assert.equal(o.body.organizations, 2);
});

test('API keys: saved encrypted, masked, override env, cleared back to env', async () => {
  process.env.DATAFORSEO_LOGIN = 'env-login';
  const r = await call(adminT, 'PUT', '/api/admin/keys', { ANTHROPIC_API_KEY: 'sk-ant-test-1234567890abcd', DATAFORSEO_LOGIN: 'panel-login' });
  assert.deepEqual(r.body.changed.sort(), ['ANTHROPIC_API_KEY', 'DATAFORSEO_LOGIN']);
  const k = Object.fromEntries(r.body.keys.map((x) => [x.name, x]));
  assert.equal(k.ANTHROPIC_API_KEY.source, 'panel');
  assert.equal(k.ANTHROPIC_API_KEY.display, 'sk-a••••abcd');
  assert.equal(k.DATAFORSEO_LOGIN.display, 'panel-login');
  const raw = await q.get("SELECT value, is_secret FROM platform_settings WHERE key = 'ANTHROPIC_API_KEY'");
  assert.equal(raw.is_secret, 1); assert.ok(!raw.value.includes('sk-ant'), 'stored encrypted');
  assert.equal(config.anthropic.apiKey, 'sk-ant-test-1234567890abcd');
  assert.equal(config.dataforseo.login, 'panel-login');
  const audit = (await call(adminT, 'GET', '/api/admin/audit')).body;
  assert.ok(!JSON.stringify(audit).includes('sk-ant-test'), 'audit never contains key values');
  const c = await call(adminT, 'DELETE', '/api/admin/keys/DATAFORSEO_LOGIN');
  assert.equal(c.body.keys.find((x) => x.name === 'DATAFORSEO_LOGIN').source, 'env');
  assert.equal(config.dataforseo.login, 'env-login');
  await call(adminT, 'DELETE', '/api/admin/keys/ANTHROPIC_API_KEY');
  delete process.env.DATAFORSEO_LOGIN;
  assert.equal((await call(adminT, 'POST', '/api/admin/keys/test/stripe')).body.ok, false);
});

test('plans: create, edit, validate, used by checkout, delete guarded', async () => {
  const bad = await call(adminT, 'PUT', '/api/admin/pricing/plans/scale', { name: 'Scale', priceMonthly: 349, credits: 50000, locations: 20, maxGrid: 10 });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /odd/);
  const p = await call(adminT, 'PUT', '/api/admin/pricing/plans/scale', { name: 'Scale', priceMonthly: 349, credits: 50000, locations: 20, maxGrid: 11, features: 'Line one\nLine two' });
  assert.equal(p.status, 200); assert.deepEqual(p.body.features, ['Line one', 'Line two']);
  const meta = (await call(userT, 'GET', '/api/meta')).body;
  assert.equal(meta.plans.scale.priceMonthly, 349);
  const co = await call(userT, 'POST', '/api/billing/checkout', { plan: 'scale' });
  assert.equal(co.body.mode, 'demo');
  assert.equal((await call(userT, 'GET', '/api/billing')).body.balance, 300 + 50000);
  const del = await call(adminT, 'DELETE', '/api/admin/pricing/plans/scale');
  assert.equal(del.status, 409, 'cannot delete a plan with subscribers');
  await call(adminT, 'PUT', '/api/admin/pricing/plans/scale', { name: 'Scale', priceMonthly: 349, credits: 50000, locations: 20, maxGrid: 11, hidden: true });
  assert.equal((await call(userT, 'POST', '/api/billing/checkout', { plan: 'scale' })).status, 400, 'hidden plans cannot be bought');
  assert.equal((await call(adminT, 'DELETE', '/api/admin/pricing/plans/trial')).status, 400);
});

test('credit action prices and top-ups are editable and enforced', async () => {
  const r = await call(adminT, 'PUT', '/api/admin/pricing/actions', { ai_post: { credits: 6, vendorCostUsd: 0.012 } });
  assert.equal(r.body.ai_post.credits, 6); assert.ok(r.body.ai_post.label, 'labels kept');
  const pr = (await call(adminT, 'GET', '/api/admin/pricing')).body;
  assert.equal(pr.value_map.find((v) => v.key === 'ai_post').credits, 6);
  const t = await call(adminT, 'PUT', '/api/admin/pricing/topups', { topups: [{ credits: 5000, priceUsd: 45 }] });
  assert.equal(t.body.length, 1); assert.equal(t.body[0].id, 'topup_5000');
  assert.equal((await call(userT, 'GET', '/api/meta')).body.topups.length, 1);
  assert.equal((await call(adminT, 'POST', '/api/admin/pricing/reset', { what: 'plans' })).status, 409, 'custom plan still in use');
  await call(adminT, 'POST', '/api/admin/pricing/reset', { what: 'actions' });
  assert.equal((await call(adminT, 'GET', '/api/admin/pricing')).body.actions.ai_post.credits, 4);
});

test('subscriptions: change plan, adjust credits, suspend blocks access, impersonate', async () => {
  const ch = await call(adminT, 'PATCH', `/api/admin/tenants/${userTenant}`, { plan: 'growth', grant_plan_credits: true });
  assert.equal(ch.body.plan, 'growth');
  const before = (await call(userT, 'GET', '/api/billing')).body.balance;
  assert.equal((await call(adminT, 'POST', `/api/admin/tenants/${userTenant}/credits`, { delta: 500 })).status, 400, 'reason required');
  const g = await call(adminT, 'POST', `/api/admin/tenants/${userTenant}/credits`, { delta: -500, note: 'goodwill reversal' });
  assert.equal(g.body.balance, before - 500);
  assert.equal((await call(adminT, 'POST', `/api/admin/tenants/${userTenant}/credits`, { delta: -99999999, note: 'x' })).status, 400);
  await call(adminT, 'PATCH', `/api/admin/tenants/${userTenant}`, { plan_status: 'suspended' });
  assert.equal((await call(userT, 'GET', '/api/locations')).status, 403);
  assert.equal((await call(userT, 'GET', '/api/me')).status, 200, 'can still see account');
  assert.equal((await call(userT, 'GET', '/api/billing')).status, 200, 'can still pay');
  await call(adminT, 'PATCH', `/api/admin/tenants/${userTenant}`, { plan_status: 'active' });
  assert.equal((await call(userT, 'GET', '/api/locations')).status, 200);
  const imp = await call(adminT, 'POST', `/api/admin/tenants/${userTenant}/impersonate`);
  const me = (await call(imp.body.token, 'GET', '/api/me')).body;
  assert.equal(me.user.email, 'cust@test.dev'); assert.ok(me.user.impersonated_by);
  const list = (await call(adminT, 'GET', '/api/admin/tenants?q=cust')).body;
  assert.equal(list.length, 1); assert.equal(list[0].mrr, 99);
  const audit = (await call(adminT, 'GET', '/api/admin/audit')).body.map((a) => a.action);
  for (const a of ['tenant.update', 'tenant.credits', 'tenant.impersonate', 'plan.create', 'keys.update']) assert.ok(audit.includes(a), a);
});
