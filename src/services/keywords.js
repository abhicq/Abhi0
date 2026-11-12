import { getIndustry } from './industries.js';
import { config } from '../config.js';

const uniq = (a) => [...new Set(a.map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean))];

/**
 * Generate the keyword universe a local business must rank for:
 *  P1 money keywords   = "<category> <city>", "<category> near me", "<top service> <city>"
 *  P2 service keywords = "<service> <city|near me>", "<modifier> <category> <city>"
 *  P3 long tail        = "<service> <neighbourhood>", "<modifier> <service> near me"
 */
export function generateKeywords(loc, { max = 60 } = {}) {
  const ind = getIndustry(loc.industry);
  const category = (loc.primary_category || ind.primaryCategory || loc.name).toLowerCase();
  const services = [...new Set([...(loc.services || []).map((s) => (s.name || s).toLowerCase()), ...ind.services.map((s) => s.toLowerCase())])].slice(0, 10);
  const city = (loc.city || '').toLowerCase();
  const areas = (loc.service_areas || []).map((a) => String(a).toLowerCase()).slice(0, 6);
  const mods = ind.modifiers;

  const out = [];
  const push = (keyword, priority, intent) => out.push({ keyword: keyword.toLowerCase(), priority, intent });

  if (city) push(`${category} ${city}`, 1, 'commercial');
  push(`${category} near me`, 1, 'commercial');
  if (city) push(`best ${category} in ${city}`, 1, 'commercial');
  for (const s of services.slice(0, 3)) { if (city) push(`${s} ${city}`, 1, 'transactional'); push(`${s} near me`, 1, 'transactional'); }
  for (const m of mods.slice(0, 4)) if (city) push(`${m} ${category} ${city}`, 2, 'commercial');
  for (const s of services.slice(3)) { if (city) push(`${s} ${city}`, 2, 'transactional'); push(`${s} near me`, 2, 'transactional'); }
  for (const a of areas) { push(`${category} ${a}`, 2, 'commercial'); for (const s of services.slice(0, 2)) push(`${s} ${a}`, 3, 'transactional'); }
  for (const m of mods.slice(0, 3)) for (const s of services.slice(0, 3)) push(`${m} ${s} near me`, 3, 'transactional');
  for (const sc of ind.secondaryCategories.slice(0, 3)) if (city) push(`${sc} ${city}`, 3, 'commercial');

  const seen = new Set();
  return out.filter((k) => { k.keyword = k.keyword.replace(/\s+/g, ' ').trim(); if (seen.has(k.keyword)) return false; seen.add(k.keyword); return true; }).slice(0, max);
}

/** Optional live enrichment: Google Ads search volume + CPC via DataForSEO. */
export async function enrichVolumes(keywords, { country = 'US' } = {}) {
  if (!config.dataforseo.enabled) {
    // Demo: plausible volumes from keyword shape so prioritisation still works.
    return keywords.map((k) => {
      const base = k.keyword.includes('near me') ? 2400 : k.priority === 1 ? 880 : k.priority === 2 ? 260 : 70;
      const h = [...k.keyword].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);
      return { ...k, search_volume: Math.round(base * (0.6 + (h % 80) / 100)), cpc: Math.round((2 + (h % 40) / 4) * 100) / 100 };
    });
  }
  const locCode = { US: 2840, GB: 2826, UK: 2826, CA: 2124, AU: 2036, IN: 2356 }[country] || 2840;
  const auth = Buffer.from(`${config.dataforseo.login}:${config.dataforseo.password}`).toString('base64');
  const res = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keywords: keywords.map((k) => k.keyword).slice(0, 700), location_code: locCode, language_code: 'en' }]),
  });
  const json = await res.json();
  const items = json?.tasks?.[0]?.result || [];
  const map = new Map(items.map((i) => [i.keyword, i]));
  return keywords.map((k) => ({ ...k, search_volume: map.get(k.keyword)?.search_volume ?? null, cpc: map.get(k.keyword)?.cpc ?? null }));
}

/** Keyword coverage inside the profile text (description + services + posts). */
export function keywordCoverage(loc, keywords, postsText = '') {
  const hay = [loc.description, (loc.services || []).map((s) => s.name || s).join(' '), postsText].join(' ').toLowerCase();
  const strip = (k) => k.replace(/\b(near me|best|in)\b/g, '').replace(new RegExp(`\\b${(loc.city || '###').toLowerCase()}\\b`, 'g'), '').trim();
  return keywords.map((k) => {
    const core = strip(k.keyword.toLowerCase());
    const terms = core.split(' ').filter((t) => t.length > 2);
    const hit = terms.length ? terms.filter((t) => hay.includes(t)).length / terms.length : 0;
    return { keyword: k.keyword, covered: hit >= 0.99, partial: hit > 0 && hit < 0.99 };
  });
}

export { uniq };
