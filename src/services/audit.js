// Profile audit: scores the GBP against the three local ranking pillars
// (Relevance, Prominence, Proximity-proxy via grid visibility) plus Conversion.
import { getIndustry } from './industries.js';
import { keywordCoverage } from './keywords.js';

const daysAgo = (iso) => (iso ? (Date.now() - new Date(iso + (iso.endsWith('Z') || iso.includes('+') ? '' : 'Z')).getTime()) / 864e5 : Infinity);

export function auditLocation(loc, { keywords = [], reviews = [], posts = [], citations = [], lastScan = null, trackingLinks = [] } = {}) {
  const ind = getIndustry(loc.industry);
  const checks = [];
  const add = (pillar, key, label, weight, pass, detail, fix = null) => checks.push({ pillar, key, label, weight, score: Math.max(0, Math.min(1, Number(pass))), detail, fix });

  // RELEVANCE
  add('relevance', 'primary_category', 'Primary category set correctly', 10, loc.primary_category ? 1 : 0,
    loc.primary_category ? `Primary: ${loc.primary_category}` : 'No primary category', loc.primary_category ? null : { action: 'optimize', auto: true });
  const sec = loc.secondary_categories || [];
  add('relevance', 'secondary_categories', 'Secondary categories (3-5 recommended)', 5, Math.min(1, sec.length / 3),
    `${sec.length} secondary categories. Suggested: ${ind.secondaryCategories.slice(0, 4).join(', ') || 'n/a'}`, sec.length >= 3 ? null : { action: 'optimize', auto: true });
  const desc = loc.description || '';
  const descHasCity = loc.city && desc.toLowerCase().includes(loc.city.toLowerCase());
  add('relevance', 'description', 'Keyword-rich description (600-750 chars, service + city early)', 8,
    (Math.min(1, desc.length / 600) * 0.6) + (descHasCity ? 0.4 : 0), `${desc.length} chars${descHasCity ? ', mentions city' : ', city missing'}`, desc.length >= 600 && descHasCity ? null : { action: 'optimize', auto: true });
  const svcCount = (loc.services || []).length;
  add('relevance', 'services', 'Services listed with descriptions (8+)', 8, Math.min(1, svcCount / 8), `${svcCount} services listed`, svcCount >= 8 ? null : { action: 'optimize', auto: true });
  if (keywords.length) {
    const cov = keywordCoverage(loc, keywords.filter((k) => k.priority === 1), posts.map((p) => p.summary).join(' '));
    const ratio = cov.length ? cov.filter((c) => c.covered).length / cov.length : 0;
    add('relevance', 'keyword_coverage', 'Priority keywords covered in profile & posts', 8, ratio,
      `${Math.round(ratio * 100)}% of P1 keywords covered. Missing: ${cov.filter((c) => !c.covered).slice(0, 4).map((c) => c.keyword).join('; ') || 'none'}`, ratio >= 0.8 ? null : { action: 'autopilot_posts', auto: true });
  } else add('relevance', 'keyword_coverage', 'Keyword strategy defined', 8, 0, 'No keywords yet', { action: 'generate_keywords', auto: true });
  add('relevance', 'attributes', 'Relevant attributes set', 3, Math.min(1, (loc.attributes || []).length / 3), `Suggested: ${ind.attributes.join(', ') || 'n/a'}`);

  // PROMINENCE
  const rated = reviews.filter((r) => r.rating);
  const avg = rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : 0;
  add('prominence', 'rating', 'Average rating 4.5+', 8, avg >= 4.5 ? 1 : avg >= 4.0 ? 0.6 : avg ? 0.3 : 0, rated.length ? `${avg.toFixed(2)}★ from ${rated.length} reviews` : 'No reviews');
  const recent = reviews.filter((r) => daysAgo(r.review_time) <= 30).length;
  add('prominence', 'review_velocity', 'Review velocity (4+/month)', 7, Math.min(1, recent / 4), `${recent} reviews in last 30 days`, recent >= 4 ? null : { action: 'review_request_links', auto: false });
  const replied = reviews.filter((r) => r.reply).length;
  const rr = reviews.length ? replied / reviews.length : 1;
  add('prominence', 'review_responses', 'Respond to 100% of reviews', 7, rr, `${Math.round(rr * 100)}% response rate`, rr >= 0.95 ? null : { action: 'reply_reviews', auto: true });
  const publishedRecent = posts.filter((p) => p.status === 'published' && daysAgo(p.published_at) <= 7).length;
  const scheduled = posts.filter((p) => p.status === 'scheduled').length;
  add('prominence', 'posting', 'Posting 2-3×/week', 7, Math.min(1, (publishedRecent + Math.min(scheduled, 2) * 0.5) / 2), `${publishedRecent} posts in last 7 days, ${scheduled} scheduled`, publishedRecent >= 2 ? null : { action: 'autopilot_posts', auto: true });
  add('prominence', 'photos', 'Fresh photos (25+, weekly uploads)', 5, Math.min(1, (loc.photos_count || 0) / 25), `${loc.photos_count || 0} photos`);
  const live = citations.filter((c) => c.status === 'live');
  add('prominence', 'citations', 'Citations on core + niche directories (30+)', 7, Math.min(1, live.length / 30), `${live.length} live citations`, live.length >= 30 ? null : { action: 'build_citations', auto: false });
  const mism = live.filter((c) => c.nap_match === 0).length;
  add('prominence', 'nap', 'NAP consistent everywhere', 5, live.length ? 1 - mism / live.length : 0.5, mism ? `${mism} listings with NAP mismatch` : 'No mismatches detected');

  // VISIBILITY (proximity proxy)
  if (lastScan) {
    add('visibility', 'solv', 'Share of local voice (3-pack coverage) 50%+', 10, Math.min(1, (lastScan.solv || 0) / 50), `SoLV ${lastScan.solv}% · ATRP ${lastScan.atrp} for "${lastScan.keyword}"`, { action: 'target_weak_zones', auto: true });
  } else add('visibility', 'solv', 'Geo-grid visibility measured', 10, 0, 'No geo-grid scan yet', { action: 'run_scan', auto: true });

  // CONVERSION
  add('conversion', 'phone', 'Phone number present', 4, loc.phone ? 1 : 0, loc.phone || 'Missing');
  add('conversion', 'website', 'Website / landing page linked', 3, loc.website ? 1 : 0, loc.website || 'Missing');
  const hasHours = loc.hours && (loc.hours.periods?.length || Object.keys(loc.hours).length > 1);
  add('conversion', 'hours', 'Business hours complete', 3, hasHours ? 1 : 0, hasHours ? 'Set' : 'Missing hours');
  const channels = new Set(trackingLinks.map((t) => t.channel));
  add('conversion', 'lead_channels', 'Call + SMS + WhatsApp tracked lead channels', 5, channels.size / 3, `Tracked channels: ${[...channels].join(', ') || 'none'}`, channels.size >= 3 ? null : { action: 'create_tracking_links', auto: true });

  const totalW = checks.reduce((a, c) => a + c.weight, 0);
  const score = Math.round(checks.reduce((a, c) => a + c.weight * c.score, 0) / totalW * 100);
  const pillars = {};
  for (const c of checks) { pillars[c.pillar] ??= { w: 0, s: 0 }; pillars[c.pillar].w += c.weight; pillars[c.pillar].s += c.weight * c.score; }
  const pillarScores = Object.fromEntries(Object.entries(pillars).map(([k, v]) => [k, Math.round((v.s / v.w) * 100)]));
  const priorities = checks.filter((c) => c.score < 0.9).sort((a, b) => b.weight * (1 - b.score) - a.weight * (1 - a.score))
    .map((c) => ({ key: c.key, label: c.label, detail: c.detail, potential_points: Math.round((c.weight * (1 - c.score)) / totalW * 100), fix: c.fix }));
  return { score, pillars: pillarScores, checks, priorities };
}
