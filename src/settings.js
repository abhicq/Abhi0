// Platform settings managed from the admin panel:
//  - integration API keys (encrypted at rest, override env vars)
//  - plans, top-ups and per-action credit prices (override pricing.js defaults)
// Values are cached per instance and refreshed every SETTINGS_TTL_MS so changes
// propagate across serverless instances within seconds.
import { q, id } from './db.js';
import { overrides, config } from './config.js';
import { encrypt, decrypt } from './auth.js';
import { PLANS, TOPUPS, CREDIT_ACTIONS } from './pricing.js';

const SETTINGS_TTL_MS = Number(process.env.SETTINGS_TTL_MS || 30_000);

export const KEY_FIELDS = [
  { name: 'ANTHROPIC_API_KEY', group: 'anthropic', label: 'Anthropic API key', secret: true, hint: 'console.anthropic.com → API keys' },
  { name: 'ANTHROPIC_MODEL', group: 'anthropic', label: 'Claude model', secret: false, hint: 'Default: claude-opus-5-5' },
  { name: 'DATAFORSEO_LOGIN', group: 'dataforseo', label: 'DataForSEO login', secret: false, hint: 'app.dataforseo.com → API access' },
  { name: 'DATAFORSEO_PASSWORD', group: 'dataforseo', label: 'DataForSEO API password', secret: true },
  { name: 'GOOGLE_CLIENT_ID', group: 'google', label: 'Google OAuth client ID', secret: false, hint: 'Google Cloud → APIs & Services → Credentials' },
  { name: 'GOOGLE_CLIENT_SECRET', group: 'google', label: 'Google OAuth client secret', secret: true },
  { name: 'STRIPE_SECRET_KEY', group: 'stripe', label: 'Stripe secret key', secret: true, hint: 'dashboard.stripe.com → Developers → API keys' },
  { name: 'STRIPE_WEBHOOK_SECRET', group: 'stripe', label: 'Stripe webhook signing secret', secret: true },
];
const KEY_NAMES = new Set(KEY_FIELDS.map((f) => f.name));

// Snapshot of code defaults so "reset" and partial overrides always start clean.
const clone = (o) => JSON.parse(JSON.stringify(o));
const DEFAULTS = { plans: clone(PLANS), topups: clone(TOPUPS), actions: clone(CREDIT_ACTIONS) };

let loadedAt = 0;
let loading = null;

export function refreshSettings({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < SETTINGS_TTL_MS) return Promise.resolve();
  loading ??= (async () => {
    const rows = await q.all('SELECT key, value, is_secret FROM platform_settings');
    const map = Object.fromEntries(rows.map((r) => [r.key, r.is_secret ? safeDecrypt(r.value) : r.value]));
    for (const k of Object.keys(overrides)) delete overrides[k];
    for (const f of KEY_FIELDS) if (map[f.name]) overrides[f.name] = map[f.name];
    applyPricing(parse(map.pricing_plans), parse(map.pricing_topups), parse(map.pricing_actions));
    loadedAt = Date.now();
  })().finally(() => { loading = null; });
  return loading;
}

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
function safeDecrypt(v) { try { return decrypt(v); } catch { return ''; } } // e.g. ENCRYPTION_KEY rotated

/** Mutate the shared pricing objects in place so every importer sees the change. */
function applyPricing(plans, topups, actions) {
  for (const k of Object.keys(PLANS)) delete PLANS[k];
  Object.assign(PLANS, clone(plans || DEFAULTS.plans));
  if (!PLANS.trial) PLANS.trial = clone(DEFAULTS.plans.trial);
  TOPUPS.splice(0, TOPUPS.length, ...clone(topups || DEFAULTS.topups));
  for (const k of Object.keys(CREDIT_ACTIONS)) CREDIT_ACTIONS[k] = { ...clone(DEFAULTS.actions[k]), ...(actions?.[k] || {}) };
}

async function put(key, value, { secret = false, userId = null } = {}) {
  await q.run(`INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at) VALUES (?,?,?,?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  key, secret ? encrypt(value) : value, secret ? 1 : 0, userId);
}

export async function audit(user, action, target, detail) {
  await q.run('INSERT INTO admin_audit (id, admin_user_id, admin_email, action, target, detail) VALUES (?,?,?,?,?,?)',
    id('aud_'), user?.id || null, user?.email || null, action, target || null, detail ? JSON.stringify(detail) : null);
}

// ── API keys ────────────────────────────────────────────────────────────────
const mask = (v) => (!v ? '' : v.length <= 8 ? '••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`);

export async function listKeys() {
  await refreshSettings({ force: true });
  const rows = Object.fromEntries((await q.all('SELECT key, updated_at, updated_by FROM platform_settings')).map((r) => [r.key, r]));
  return KEY_FIELDS.map((f) => {
    const panel = overrides[f.name]; const envVal = process.env[f.name];
    const value = panel || envVal || '';
    return {
      ...f, source: panel ? 'panel' : envVal ? 'env' : 'unset',
      display: f.secret ? mask(value) : value, updated_at: rows[f.name]?.updated_at || null,
    };
  });
}

export async function saveKeys(user, values) {
  const changed = [];
  for (const [name, raw] of Object.entries(values || {})) {
    if (!KEY_NAMES.has(name)) throw Object.assign(new Error(`Unknown key ${name}`), { status: 400 });
    const v = String(raw ?? '').trim();
    if (!v) continue; // blank = keep current
    if (v.length > 500) throw Object.assign(new Error(`${name} is too long`), { status: 400 });
    await put(name, v, { secret: KEY_FIELDS.find((f) => f.name === name).secret, userId: user.id });
    changed.push(name);
  }
  if (changed.length) await audit(user, 'keys.update', changed.join(','), null); // never log values
  await refreshSettings({ force: true });
  return changed;
}

export async function clearKey(user, name) {
  if (!KEY_NAMES.has(name)) throw Object.assign(new Error(`Unknown key ${name}`), { status: 400 });
  await q.run('DELETE FROM platform_settings WHERE key = ?', name);
  await audit(user, 'keys.clear', name, null);
  await refreshSettings({ force: true });
}

/** Live connectivity check for an integration, using the currently effective keys. */
export async function testKey(group) {
  const t0 = Date.now();
  const ok = (detail) => ({ group, ok: true, detail, ms: Date.now() - t0 });
  const fail = (detail) => ({ group, ok: false, detail, ms: Date.now() - t0 });
  try {
    if (group === 'anthropic') {
      if (!config.anthropic.enabled) return fail('No API key set');
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic(config.anthropic.apiKey ? { apiKey: config.anthropic.apiKey } : {});
      const m = await client.models.retrieve(config.anthropic.model);
      return ok(`Key valid · model ${m.id} available`);
    }
    if (group === 'dataforseo') {
      if (!config.dataforseo.enabled) return fail('Login and password required');
      const auth = Buffer.from(`${config.dataforseo.login}:${config.dataforseo.password}`).toString('base64');
      const r = await fetch('https://api.dataforseo.com/v3/appendix/user_data', { headers: { Authorization: `Basic ${auth}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.status_code !== 20000) return fail(j.status_message || `HTTP ${r.status}`);
      return ok(`Connected · balance $${j.tasks?.[0]?.result?.[0]?.money?.balance ?? '?'}`);
    }
    if (group === 'stripe') {
      if (!config.stripe.enabled) return fail('No secret key set');
      const { getStripe } = await import('./billing.js');
      const b = await getStripe().balance.retrieve();
      const live = config.stripe.secretKey.startsWith('sk_live') ? 'LIVE mode' : 'test mode';
      return ok(`Connected (${live}) · ${b.available.map((a) => `${(a.amount / 100).toFixed(2)} ${a.currency.toUpperCase()}`).join(', ') || 'no balance'}${config.stripe.webhookSecret ? '' : ' · ⚠ webhook secret missing'}`);
    }
    if (group === 'google') {
      if (!config.google.enabled) return fail('Client ID and secret required');
      if (!/\.apps\.googleusercontent\.com$/.test(config.google.clientId)) return fail('Client ID should end with .apps.googleusercontent.com');
      return ok(`Configured · register redirect URI ${config.google.redirectUri} (verified on first Google sign-in)`);
    }
    return fail('Unknown integration');
  } catch (e) { return fail(e.message); }
}

// ── Plans & pricing ─────────────────────────────────────────────────────────
const bad = (m) => Object.assign(new Error(m), { status: 400 });

function validatePlan(key, p) {
  if (!/^[a-z0-9_]{2,30}$/.test(key)) throw bad('Plan key: 2-30 lowercase letters, digits or _');
  const num = (v, name, { min = 0, max = 1e7, int = false } = {}) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw bad(`${name} must be ${int ? 'a whole number' : 'a number'} between ${min} and ${max}`);
    return n;
  };
  const out = {
    name: String(p.name || '').trim().slice(0, 40) || (() => { throw bad('Plan name required'); })(),
    priceMonthly: num(p.priceMonthly, 'Monthly price'),
    priceAnnual: p.priceAnnual === '' || p.priceAnnual == null ? undefined : num(p.priceAnnual, 'Annual price'),
    credits: num(p.credits, 'Credits', { int: true, max: 10_000_000 }),
    locations: num(p.locations, 'Locations', { min: 1, max: 10_000, int: true }),
    maxGrid: num(p.maxGrid ?? 5, 'Max grid', { min: 3, max: 21, int: true }),
    seats: num(p.seats ?? 1, 'Seats', { min: 1, max: 1000, int: true }),
    features: (Array.isArray(p.features) ? p.features : String(p.features || '').split('\n')).map((f) => String(f).trim()).filter(Boolean).slice(0, 20),
    popular: Boolean(p.popular),
    whiteLabel: Boolean(p.whiteLabel),
    hidden: Boolean(p.hidden),
  };
  if (out.maxGrid % 2 === 0) throw bad('Max grid must be odd (3, 5, 7 …)');
  if (key === 'trial') { out.priceMonthly = 0; out.trialDays = num(p.trialDays ?? 14, 'Trial days', { min: 1, max: 90, int: true }); }
  else if (out.priceMonthly <= 0) throw bad('Paid plans need a monthly price above 0');
  return out;
}

const savePlans = (user) => put('pricing_plans', JSON.stringify(PLANS), { userId: user.id });

export async function upsertPlan(user, key, body) {
  await refreshSettings({ force: true });
  const plan = validatePlan(key, body);
  const existed = Boolean(PLANS[key]);
  PLANS[key] = plan;
  await savePlans(user);
  await audit(user, existed ? 'plan.update' : 'plan.create', key, plan);
  await refreshSettings({ force: true });
  return PLANS[key];
}

export async function deletePlan(user, key) {
  await refreshSettings({ force: true });
  if (key === 'trial') throw bad('The trial plan cannot be deleted');
  if (!PLANS[key]) throw Object.assign(new Error('Plan not found'), { status: 404 });
  const n = (await q.get('SELECT COUNT(*) n FROM tenants WHERE plan = ?', key)).n;
  if (n) throw Object.assign(new Error(`${n} organization(s) are on this plan — move them first, or hide the plan instead`), { status: 409 });
  delete PLANS[key];
  await savePlans(user);
  await audit(user, 'plan.delete', key, null);
  await refreshSettings({ force: true });
}

export async function saveTopups(user, list) {
  if (!Array.isArray(list) || list.length > 10) throw bad('Provide up to 10 top-up packs');
  const clean = list.map((t, i) => {
    const credits = Number(t.credits), priceUsd = Number(t.priceUsd);
    if (!Number.isInteger(credits) || credits < 100 || !(priceUsd > 0)) throw bad(`Top-up ${i + 1}: credits ≥ 100 and price > 0 required`);
    return { id: /^[a-z0-9_]{2,30}$/.test(t.id || '') ? t.id : `topup_${credits}`, credits, priceUsd };
  });
  if (new Set(clean.map((t) => t.id)).size !== clean.length) throw bad('Top-up ids must be unique');
  await put('pricing_topups', JSON.stringify(clean), { userId: user.id });
  await audit(user, 'topups.update', null, clean);
  await refreshSettings({ force: true });
  return TOPUPS;
}

export async function saveActionPrices(user, updates) {
  await refreshSettings({ force: true });
  const current = parse((await q.get("SELECT value FROM platform_settings WHERE key = 'pricing_actions'"))?.value) || {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (!DEFAULTS.actions[k]) throw bad(`Unknown action ${k}`);
    const credits = Number(v.credits), cost = Number(v.vendorCostUsd);
    if (!Number.isInteger(credits) || credits < 0 || credits > 100_000) throw bad(`${k}: credits must be a whole number 0-100000`);
    if (!(cost >= 0) || cost > 1000) throw bad(`${k}: vendor cost must be between 0 and 1000`);
    current[k] = { credits, vendorCostUsd: cost };
  }
  await put('pricing_actions', JSON.stringify(current), { userId: user.id });
  await audit(user, 'actions.update', Object.keys(updates || {}).join(','), updates);
  await refreshSettings({ force: true });
  return CREDIT_ACTIONS;
}

export async function resetPricing(user, what = 'all') {
  const keys = { plans: ['pricing_plans'], topups: ['pricing_topups'], actions: ['pricing_actions'], all: ['pricing_plans', 'pricing_topups', 'pricing_actions'] }[what];
  if (!keys) throw bad('Unknown reset target');
  if (keys.includes('pricing_plans')) {
    const orphan = await q.get(`SELECT plan, COUNT(*) n FROM tenants WHERE plan NOT IN (${Object.keys(DEFAULTS.plans).map(() => '?').join(',')}) GROUP BY plan LIMIT 1`, ...Object.keys(DEFAULTS.plans));
    if (orphan) throw Object.assign(new Error(`${orphan.n} organization(s) are on custom plan "${orphan.plan}" — move them before resetting plans`), { status: 409 });
  }
  for (const k of keys) await q.run('DELETE FROM platform_settings WHERE key = ?', k);
  await audit(user, 'pricing.reset', what, null);
  await refreshSettings({ force: true });
}
