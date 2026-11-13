// Database: libSQL (SQLite-compatible).
//  - Production / Vercel: Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
//  - Local dev:           file:./data/rankpilot.db
//  - Vercel without Turso: file:/tmp (ephemeral demo, auto-seeded)
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

let client;
let ready;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  plan_status TEXT NOT NULL DEFAULT 'active',
  credits_balance INTEGER NOT NULL DEFAULT 0,
  plan_renews_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  white_label_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS google_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  google_email TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  expires_at INTEGER,
  mode TEXT NOT NULL DEFAULT 'live',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES google_connections(id) ON DELETE SET NULL,
  gbp_account TEXT,
  gbp_location TEXT,
  place_id TEXT,
  name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'general',
  primary_category TEXT,
  secondary_categories TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  phone TEXT,
  whatsapp TEXT,
  website TEXT,
  address TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  lat REAL,
  lng REAL,
  service_areas TEXT NOT NULL DEFAULT '[]',
  services TEXT NOT NULL DEFAULT '[]',
  hours TEXT NOT NULL DEFAULT '{}',
  attributes TEXT NOT NULL DEFAULT '[]',
  photos_count INTEGER NOT NULL DEFAULT 0,
  avg_lead_value REAL NOT NULL DEFAULT 100,
  close_rate REAL NOT NULL DEFAULT 0.3,
  autopilot TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT,
  last_autopilot_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  intent TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  search_volume INTEGER,
  cpc REAL,
  tracked INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(location_id, keyword)
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  topic_type TEXT NOT NULL DEFAULT 'STANDARD',
  summary TEXT NOT NULL,
  cta_type TEXT,
  cta_url TEXT,
  keyword TEXT,
  image_url TEXT,
  offer TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  published_at TEXT,
  gbp_post_name TEXT,
  error TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  gbp_review_name TEXT,
  reviewer TEXT,
  rating INTEGER,
  comment TEXT,
  review_time TEXT,
  reply TEXT,
  reply_status TEXT NOT NULL DEFAULT 'none',
  replied_at TEXT,
  UNIQUE(location_id, gbp_review_name)
);
CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  report TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS grid_scans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  grid_size INTEGER NOT NULL,
  radius_km REAL NOT NULL,
  points TEXT NOT NULL,
  arp REAL,
  atrp REAL,
  solv REAL,
  competitors TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  directory_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  listing_url TEXT,
  found_name TEXT,
  found_address TEXT,
  found_phone TEXT,
  nap_match INTEGER,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(location_id, directory_id)
);
CREATE TABLE IF NOT EXISTS tracking_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  source TEXT NOT NULL,
  link_id TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gbp_metrics (
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY(location_id, date, metric)
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  action TEXT NOT NULL,
  location_id TEXT,
  ref_id TEXT,
  vendor_cost_usd REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  admin_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_due ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant ON credit_ledger(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_loc ON lead_events(location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scans_loc ON grid_scans(location_id, keyword, created_at);
`;

export function initDb() {
  if (!ready) {
    ready = (async () => {
      const url = config.db.url;
      if (url.startsWith('file:') && !url.includes(':memory:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
      client = createClient({ url, authToken: config.db.authToken || undefined });
      await client.executeMultiple(SCHEMA);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export const id = (prefix = '') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
const toObj = (cols, row) => Object.fromEntries(cols.map((c, i) => [c, row[i]]));

async function exec(sql, args) {
  await initDb();
  return client.execute({ sql, args: clean(args) });
}

export const q = {
  get: async (sql, ...p) => { const r = await exec(sql, p); return r.rows[0] ? toObj(r.columns, r.rows[0]) : undefined; },
  all: async (sql, ...p) => { const r = await exec(sql, p); return r.rows.map((row) => toObj(r.columns, row)); },
  run: async (sql, ...p) => { const r = await exec(sql, p); return { changes: r.rowsAffected }; },
  /** Run several statements atomically: [[sql, ...args], ...] */
  batch: async (stmts) => { await initDb(); return client.batch(stmts.map(([sql, ...a]) => ({ sql, args: clean(a) })), 'write'); },
};

const JSON_COLS = ['secondary_categories', 'service_areas', 'services', 'hours', 'attributes', 'autopilot', 'points', 'competitors', 'report', 'meta'];
export function hydrate(row) {
  if (!row) return row;
  const out = { ...row };
  for (const c of JSON_COLS) if (typeof out[c] === 'string') { try { out[c] = JSON.parse(out[c]); } catch { /* keep string */ } }
  return out;
}

export function logActivity(tenantId, locationId, kind, message) {
  return q.run('INSERT INTO activity_log (id, tenant_id, location_id, kind, message) VALUES (?,?,?,?,?)', id('act_'), tenantId, locationId || null, kind, message);
}

/** Child tables are deleted explicitly (FK cascades are not guaranteed over remote libSQL connections). */
const LOCATION_CHILDREN = ['keywords', 'posts', 'reviews', 'audits', 'grid_scans', 'citations', 'tracking_links', 'lead_events', 'gbp_metrics'];
export function deleteLocation(locationId) {
  return q.batch([...LOCATION_CHILDREN.map((t) => [`DELETE FROM ${t} WHERE location_id = ?`, locationId]), ['DELETE FROM locations WHERE id = ?', locationId]]);
}
export async function deleteTenant(tenantId) {
  const locs = await q.all('SELECT id FROM locations WHERE tenant_id = ?', tenantId);
  for (const l of locs) await deleteLocation(l.id);
  await q.batch(['credit_ledger', 'activity_log', 'google_connections', 'users'].map((t) => [`DELETE FROM ${t} WHERE tenant_id = ?`, tenantId]).concat([['DELETE FROM tenants WHERE id = ?', tenantId]]));
}
