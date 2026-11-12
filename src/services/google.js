// Google Business Profile integration.
// APIs used (enable in Google Cloud + request GBP API access):
//   - My Business Account Management v1   (accounts)
//   - My Business Business Information v1 (locations read/patch)
//   - Google My Business v4               (localPosts, reviews, media)
//   - Business Profile Performance v1     (calls, website clicks, directions, messages)
// Scope: https://www.googleapis.com/auth/business.manage
import crypto from 'node:crypto';
import { config } from '../config.js';
import { q, id } from '../db.js';
import { encrypt, decrypt } from '../auth.js';

const SCOPE = 'https://www.googleapis.com/auth/business.manage openid email';
const READ_MASK = 'name,title,storefrontAddress,phoneNumbers,categories,websiteUri,regularHours,profile,serviceArea,latlng,metadata,serviceItems';

// ── OAuth ───────────────────────────────────────────────────────────────────
const pendingStates = new Map(); // state -> { tenantId, at }

export function authUrl(tenantId) {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { tenantId, at: Date.now() });
  const p = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: config.google.redirectUri, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function handleCallback(code, state) {
  const s = pendingStates.get(state);
  pendingStates.delete(state);
  if (!s || Date.now() - s.at > 15 * 60_000) throw new Error('Invalid or expired OAuth state');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: config.google.redirectUri, grant_type: 'authorization_code' }),
  });
  const tok = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${tok.error_description || tok.error}`);
  let email = null;
  if (tok.id_token) { try { email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url')).email; } catch { /* ignore */ } }
  const connId = id('gc_');
  q.run(`INSERT INTO google_connections (id, tenant_id, google_email, access_token_enc, refresh_token_enc, expires_at, mode) VALUES (?,?,?,?,?,?, 'live')`,
    connId, s.tenantId, email, encrypt(tok.access_token), encrypt(tok.refresh_token), Date.now() + tok.expires_in * 1000);
  return { tenantId: s.tenantId, connectionId: connId };
}

async function accessToken(conn) {
  if (conn.expires_at > Date.now() + 60_000) return decrypt(conn.access_token_enc);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: decrypt(conn.refresh_token_enc), grant_type: 'refresh_token' }),
  });
  const tok = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${tok.error}`);
  q.run('UPDATE google_connections SET access_token_enc = ?, expires_at = ? WHERE id = ?', encrypt(tok.access_token), Date.now() + tok.expires_in * 1000, conn.id);
  return tok.access_token;
}

async function gfetch(conn, url, opts = {}) {
  const token = await accessToken(conn);
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`GBP API ${res.status}: ${json.error?.message || text.slice(0, 200)}`);
  return json;
}

// ── Adapter: live vs demo ───────────────────────────────────────────────────
const getConn = (loc) => loc.connection_id ? q.get('SELECT * FROM google_connections WHERE id = ?', loc.connection_id) : null;
export const isLive = (loc) => getConn(loc)?.mode === 'live';

export function createDemoConnection(tenantId) {
  const connId = id('gc_');
  q.run(`INSERT INTO google_connections (id, tenant_id, google_email, mode) VALUES (?,?,?, 'demo')`, connId, tenantId, 'demo@example.com');
  return connId;
}

/** List all GBP locations available on a connection. */
export async function listRemoteLocations(conn) {
  if (conn.mode === 'demo') return DEMO_LOCATIONS.map((l) => ({ ...l }));
  const accounts = (await gfetch(conn, 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts')).accounts || [];
  const out = [];
  for (const acc of accounts) {
    let pageToken = '';
    do {
      const r = await gfetch(conn, `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=${READ_MASK}&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
      for (const l of r.locations || []) out.push(fromGbp(acc.name, l));
      pageToken = r.nextPageToken || '';
    } while (pageToken);
  }
  return out;
}

function fromGbp(account, l) {
  const a = l.storefrontAddress || {};
  return {
    gbp_account: account, gbp_location: l.name, place_id: l.metadata?.placeId || null, name: l.title,
    primary_category: l.categories?.primaryCategory?.displayName || null,
    secondary_categories: (l.categories?.additionalCategories || []).map((c) => c.displayName),
    description: l.profile?.description || '', phone: l.phoneNumbers?.primaryPhone || null, website: l.websiteUri || null,
    address: (a.addressLines || []).join(', '), city: a.locality || '', region: a.administrativeArea || '', postal_code: a.postalCode || '', country: a.regionCode || 'US',
    lat: l.latlng?.latitude ?? null, lng: l.latlng?.longitude ?? null,
    service_areas: (l.serviceArea?.places?.placeInfos || []).map((p) => p.placeName),
    services: (l.serviceItems || []).map((s) => ({ name: s.freeFormServiceItem?.label?.displayName || s.structuredServiceItem?.serviceTypeId, description: s.freeFormServiceItem?.label?.description || '' })).filter((s) => s.name),
    hours: l.regularHours || {},
  };
}

/** Push optimized fields to Google. */
export async function updateProfile(loc, fields) {
  const conn = getConn(loc);
  if (!conn || conn.mode === 'demo') return { mode: 'demo', updated: Object.keys(fields) };
  const body = {}; const mask = [];
  if (fields.description != null) { body.profile = { description: fields.description }; mask.push('profile.description'); }
  if (fields.services) {
    body.serviceItems = fields.services.map((s) => ({ freeFormServiceItem: { category: loc.gbp_primary_category_id || undefined, label: { displayName: s.name, description: s.description || '', languageCode: 'en' } } }));
    mask.push('serviceItems');
  }
  if (fields.websiteUri) { body.websiteUri = fields.websiteUri; mask.push('websiteUri'); }
  if (!mask.length) return { mode: 'live', updated: [] };
  await gfetch(conn, `https://mybusinessbusinessinformation.googleapis.com/v1/${loc.gbp_location}?updateMask=${mask.join(',')}`, { method: 'PATCH', body: JSON.stringify(body) });
  return { mode: 'live', updated: mask };
}

const v4Parent = (loc) => `${loc.gbp_account}/${loc.gbp_location}`; // accounts/x/locations/y

export async function publishPost(loc, post) {
  const conn = getConn(loc);
  if (!conn || conn.mode === 'demo') return { name: `${loc.gbp_location || 'locations/demo'}/localPosts/${id()}`, mode: 'demo' };
  const body = { languageCode: 'en', summary: post.summary, topicType: post.topic_type || 'STANDARD' };
  if (post.cta_type) body.callToAction = post.cta_type === 'CALL' ? { actionType: 'CALL' } : { actionType: post.cta_type, url: post.cta_url || loc.website };
  if (post.image_url) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: post.image_url }];
  if (post.topic_type === 'OFFER' || post.topic_type === 'EVENT') {
    const s = new Date(); const e = new Date(Date.now() + 14 * 864e5);
    const d = (x) => ({ year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() });
    body.event = { title: (post.offer || post.keyword || 'Special offer').slice(0, 58), schedule: { startDate: d(s), endDate: d(e) } };
    if (post.topic_type === 'OFFER') body.offer = { termsConditions: 'See store for details.' };
  }
  const r = await gfetch(conn, `https://mybusiness.googleapis.com/v4/${v4Parent(loc)}/localPosts`, { method: 'POST', body: JSON.stringify(body) });
  return { name: r.name, mode: 'live' };
}

export async function fetchReviews(loc) {
  const conn = getConn(loc);
  if (!conn || conn.mode === 'demo') return demoReviews(loc);
  const out = []; let pageToken = '';
  do {
    const r = await gfetch(conn, `https://mybusiness.googleapis.com/v4/${v4Parent(loc)}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`);
    const stars = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    for (const rv of r.reviews || []) out.push({ gbp_review_name: rv.name, reviewer: rv.reviewer?.displayName, rating: stars[rv.starRating] || null, comment: rv.comment || '', review_time: rv.createTime, reply: rv.reviewReply?.comment || null });
    pageToken = r.nextPageToken || '';
  } while (pageToken && out.length < 500);
  return out;
}

export async function replyToReview(loc, reviewName, comment) {
  const conn = getConn(loc);
  if (!conn || conn.mode === 'demo') return { mode: 'demo' };
  await gfetch(conn, `https://mybusiness.googleapis.com/v4/${reviewName}/reply`, { method: 'PUT', body: JSON.stringify({ comment }) });
  return { mode: 'live' };
}

export const PERF_METRICS = ['CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_CONVERSATIONS', 'BUSINESS_BOOKINGS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'];

/** Daily performance metrics (Google reports with ~3 day lag). */
export async function fetchPerformance(loc, days = 30) {
  const conn = getConn(loc);
  if (!conn || conn.mode === 'demo') return demoPerformance(loc, days);
  const end = new Date(Date.now() - 3 * 864e5); const start = new Date(end.getTime() - days * 864e5);
  const p = new URLSearchParams();
  PERF_METRICS.forEach((m) => p.append('dailyMetrics', m));
  p.set('dailyRange.start_date.year', start.getUTCFullYear()); p.set('dailyRange.start_date.month', start.getUTCMonth() + 1); p.set('dailyRange.start_date.day', start.getUTCDate());
  p.set('dailyRange.end_date.year', end.getUTCFullYear()); p.set('dailyRange.end_date.month', end.getUTCMonth() + 1); p.set('dailyRange.end_date.day', end.getUTCDate());
  const locId = loc.gbp_location.split('/').pop();
  const r = await gfetch(conn, `https://businessprofileperformance.googleapis.com/v1/locations/${locId}:fetchMultiDailyMetricsTimeSeries?${p}`);
  const rows = [];
  for (const series of r.multiDailyMetricTimeSeries || []) for (const s of series.dailyMetricTimeSeries || []) {
    for (const dv of s.timeSeries?.datedValues || []) {
      const d = dv.date; rows.push({ date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`, metric: s.dailyMetric, value: Number(dv.value || 0) });
    }
  }
  return rows;
}

// ── Demo data ───────────────────────────────────────────────────────────────
const DEMO_LOCATIONS = [
  { gbp_account: 'accounts/demo', gbp_location: 'locations/1001', place_id: 'demo_place_1001', name: 'BluePeak Plumbing & Drains', industry: 'plumber', primary_category: 'Plumber', secondary_categories: [], description: 'We fix pipes.', phone: '+1 512-555-0142', website: 'https://bluepeakplumbing.example', address: '1200 Congress Ave', city: 'Austin', region: 'TX', postal_code: '78701', country: 'US', lat: 30.2747, lng: -97.7404, service_areas: ['Round Rock', 'Cedar Park', 'Pflugerville'], services: [{ name: 'Drain cleaning' }, { name: 'Water heater repair' }], hours: { periods: [] } },
  { gbp_account: 'accounts/demo', gbp_location: 'locations/1002', place_id: 'demo_place_1002', name: 'SmileCraft Dental Studio', industry: 'dentist', primary_category: 'Dentist', secondary_categories: ['Cosmetic dentist'], description: '', phone: '+1 305-555-0199', website: 'https://smilecraft.example', address: '88 Brickell Ave', city: 'Miami', region: 'FL', postal_code: '33131', country: 'US', lat: 25.7663, lng: -80.1917, service_areas: [], services: [], hours: {} },
];

const seeded = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); };

function demoReviews(loc) {
  const r = seeded(loc.id || loc.name);
  const names = ['Maria Gonzalez', 'James Carter', 'Priya Shah', 'Tom Becker', 'Aisha Khan', 'Luis Romero', 'Emily Chen', 'Robert King', 'Sofia Rossi', 'David Park'];
  const texts = { 5: ['Fast, friendly and fixed it the same day. Highly recommend!', 'Super professional team, fair price and clean work.', 'Showed up on time and explained everything clearly.'], 4: ['Good service, slightly late but great work.', 'Solid job overall, would use again.'], 3: ['It was okay. Took longer than expected.'], 2: ['Pricey and had to call twice for follow-up.'], 1: ['Never showed up for the appointment. Very disappointed.'] };
  return names.map((n, i) => {
    const x = r(); const rating = x > 0.25 ? 5 : x > 0.12 ? 4 : x > 0.06 ? 3 : x > 0.03 ? 2 : 1;
    const t = texts[rating][Math.floor(r() * texts[rating].length)];
    return { gbp_review_name: `${loc.gbp_location || 'locations/demo'}/reviews/r${i}`, reviewer: n, rating, comment: t, review_time: new Date(Date.now() - i * 4 * 864e5).toISOString(), reply: i > 6 ? 'Thanks for choosing us!' : null };
  });
}

function demoPerformance(loc, days) {
  const r = seeded(`${loc.id}perf`); const rows = [];
  // Simulate growth as automation runs: later days trend higher.
  for (let i = days; i >= 1; i--) {
    const date = new Date(Date.now() - (i + 3) * 864e5).toISOString().slice(0, 10);
    const growth = 1 + (days - i) / days * 0.4;
    const base = { CALL_CLICKS: 1.4, WEBSITE_CLICKS: 2.5, BUSINESS_DIRECTION_REQUESTS: 1, BUSINESS_CONVERSATIONS: 0.5, BUSINESS_BOOKINGS: 0.3, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 90, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 60, BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 25, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 30 };
    for (const [m, v] of Object.entries(base)) rows.push({ date, metric: m, value: Math.max(0, Math.round(v * growth * (0.6 + r() * 0.8))) });
  }
  return rows;
}
