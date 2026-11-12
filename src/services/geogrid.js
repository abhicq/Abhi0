// Geo-grid rank tracking: checks Google Maps ranking for a keyword from an
// N×N grid of GPS points around the business, as a searcher standing there.
// Metrics:
//   ARP  = average rank where found in top 20
//   ATRP = average total rank (not-found counted as 21)
//   SoLV = share of local voice: % of points where business is in the 3-pack
import { config } from '../config.js';

const R = 6371; // km
export function offsetPoint(lat, lng, dNorthKm, dEastKm) {
  const nLat = lat + (dNorthKm / R) * (180 / Math.PI);
  const nLng = lng + (dEastKm / R) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
  return [Number(nLat.toFixed(6)), Number(nLng.toFixed(6))];
}
export function distanceKm(a, b) {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180, dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function buildGrid(lat, lng, size = 7, radiusKm = 5) {
  if (size % 2 === 0) size += 1;
  const half = (size - 1) / 2; const step = half ? radiusKm / half : 0; const pts = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const [plat, plng] = offsetPoint(lat, lng, (half - r) * step, (c - half) * step);
    pts.push({ row: r, col: c, lat: plat, lng: plng });
  }
  return pts;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function liveRank(loc, keyword, pt) {
  const auth = Buffer.from(`${config.dataforseo.login}:${config.dataforseo.password}`).toString('base64');
  const res = await fetch('https://api.dataforseo.com/v3/serp/google/maps/live/advanced', {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keyword, location_coordinate: `${pt.lat},${pt.lng},15z`, language_code: 'en', depth: 20 }]),
  });
  const json = await res.json();
  const items = (json?.tasks?.[0]?.result?.[0]?.items || []).filter((i) => i.type === 'maps_search');
  const idx = items.findIndex((i) => (loc.place_id && i.place_id === loc.place_id) || norm(i.title) === norm(loc.name));
  return { rank: idx >= 0 ? items[idx].rank_group : null, top: items.slice(0, 3).map((i) => ({ title: i.title, rating: i.rating?.value, reviews: i.rating?.votes_count, place_id: i.place_id })) };
}

const COMPETITOR_NAMES = ['Apex', 'Reliable', 'Metro', 'Precision', 'Elite', 'Hometown', 'Rapid', 'Summit', 'Allied', 'Prime'];
const hash = (str) => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** Demo competitors: each has a home position and strength, stable per keyword. */
function demoCompetitors(loc, keyword, radiusKm) {
  const cat = (loc.primary_category || 'Services').split(' ')[0];
  return COMPETITOR_NAMES.slice(0, 7).map((n, i) => {
    const h = hash(`${keyword}|${n}`);
    const ang = ((h % 360) * Math.PI) / 180, dist = (0.25 + ((h >> 9) % 100) / 100) * radiusKm;
    const [lat, lng] = offsetPoint(loc.lat, loc.lng, Math.cos(ang) * dist, Math.sin(ang) * dist);
    return { title: `${n} ${cat}${i % 2 ? ' Co.' : ''}`, lat, lng, power: 0.45 + ((h >> 3) % 50) / 100, rating: 4 + ((h >> 5) % 10) / 10, reviews: 30 + ((h >> 11) % 400) };
  });
}

/** Demo SERP model: distance-decayed prominence; profile strength widens your reach. */
function demoRank(loc, keyword, pt, strength, comps) {
  const noise = (hash(`${keyword}:${pt.row}:${pt.col}`) % 100) / 100;
  const selfScore = (0.35 + strength * 1.3) / (1 + distanceKm([loc.lat, loc.lng], [pt.lat, pt.lng]) * (0.9 - strength * 0.6)) + noise * 0.08;
  const field = comps.map((c) => ({ ...c, score: c.power / (1 + distanceKm([c.lat, c.lng], [pt.lat, pt.lng]) * 0.55) }));
  for (let i = 0; i < 14; i++) field.push({ title: null, score: 0.22 - i * 0.012 }); // long tail fills ranks 8-20
  const rank = field.filter((c) => c.score > selfScore).length + 1;
  const top = field.filter((c) => c.title).sort((a, b) => b.score - a.score).slice(0, 3).map(({ title, rating, reviews }) => ({ title, rating, reviews }));
  if (rank <= 3) top.splice(rank - 1, 0, { title: loc.name, self: true });
  return { rank: rank > 20 ? null : rank, top: top.slice(0, 3) };
}

/**
 * Run a scan. `strength` (0..1) only affects demo mode and is derived from the
 * profile audit score + automation activity so demo dashboards show realistic
 * improvement after optimizations.
 */
export async function runScan(loc, keyword, { size = 7, radiusKm = 5, strength = 0.4 } = {}) {
  if (loc.lat == null || loc.lng == null) throw Object.assign(new Error('Location has no coordinates; add lat/lng first'), { status: 400 });
  const grid = buildGrid(loc.lat, loc.lng, size, radiusKm);
  const live = config.dataforseo.enabled;
  const comps = live ? null : demoCompetitors(loc, keyword, radiusKm);
  const results = [];
  const BATCH = 8;
  for (let i = 0; i < grid.length; i += BATCH) {
    const chunk = grid.slice(i, i + BATCH);
    const r = await Promise.all(chunk.map(async (pt) => {
      try { return { ...pt, ...(live ? await liveRank(loc, keyword, pt) : demoRank(loc, keyword, pt, strength, comps)) }; }
      catch (e) { return { ...pt, rank: null, top: [], error: e.message }; }
    }));
    results.push(...r);
  }
  return { points: results, ...metrics(results, loc.name), mode: live ? 'live' : 'demo' };
}

export function metrics(points, selfName) {
  const found = points.filter((p) => p.rank);
  const arp = found.length ? found.reduce((a, p) => a + p.rank, 0) / found.length : null;
  const atrp = points.reduce((a, p) => a + (p.rank || 21), 0) / points.length;
  const solv = points.filter((p) => p.rank && p.rank <= 3).length / points.length;
  const comp = new Map();
  for (const p of points) for (const t of p.top || []) {
    if (t.self || norm(t.title) === norm(selfName)) continue;
    const c = comp.get(t.title) || { title: t.title, appearances: 0, rating: t.rating, reviews: t.reviews };
    c.appearances++; comp.set(t.title, c);
  }
  const competitors = [...comp.values()].sort((a, b) => b.appearances - a.appearances).slice(0, 5)
    .map((c) => ({ ...c, share_of_3pack: Math.round((c.appearances / points.length) * 100) }));
  return { arp: arp && Math.round(arp * 100) / 100, atrp: Math.round(atrp * 100) / 100, solv: Math.round(solv * 1000) / 10, competitors };
}
