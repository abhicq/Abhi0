// ─────────────────────────────────────────────────────────────────────────────
// PRICING & 360° VALUE MAP
// Every billable action is priced in credits from its *real vendor cost* plus a
// margin, then mapped to the ranking/lead outcome it drives. Vendor costs are
// list-price estimates (Nov 2026) — keep them current in one place, here.
//
// Credit economics: 1 credit retails at $0.0099–$0.0064 depending on plan.
// Target blended gross margin >= 75% after vendor + infra cost.
// ─────────────────────────────────────────────────────────────────────────────

export const CREDIT_ACTIONS = {
  // key: { credits, vendorCostUsd, vendor, unit, impact (1-5), drives, notes }
  ai_post: {
    label: 'AI-written GBP post (keyword-targeted)', credits: 4, vendorCostUsd: 0.012, vendor: 'Claude Opus 5.5 (~1.2k in / 400 out tokens, low effort)',
    unit: 'post', impact: 4, drives: ['Freshness signal', 'Keyword relevance', 'Post CTA clicks → calls/WhatsApp'],
  },
  publish_post: {
    label: 'Publish/schedule post to Google', credits: 1, vendorCostUsd: 0.0005, vendor: 'Google Business Profile API (free) + infra',
    unit: 'post', impact: 3, drives: ['Activity signal', 'Profile engagement'],
  },
  ai_review_reply: {
    label: 'AI review reply (keyword-aware, on-brand)', credits: 2, vendorCostUsd: 0.006, vendor: 'Claude Opus 5.5 (~600 in / 200 out tokens)',
    unit: 'reply', impact: 4, drives: ['Prominence (response rate)', 'Conversion trust', 'Keyword mentions in replies'],
  },
  ai_profile_optimize: {
    label: 'AI profile optimization (description, services, categories, FAQs)', credits: 25, vendorCostUsd: 0.08, vendor: 'Claude Opus 5.5 (~4k in / 3k out tokens, medium effort)',
    unit: 'run', impact: 5, drives: ['Relevance (category + description + services)', 'Conversion rate'],
  },
  keyword_research: {
    label: 'Keyword research with Google search volume + CPC', credits: 20, vendorCostUsd: 0.075, vendor: 'DataForSEO Keywords Data (Google Ads) per task',
    unit: 'run (up to 700 kw)', impact: 4, drives: ['Picks the money keywords to rank for'],
  },
  grid_point: {
    label: 'Geo-grid rank check (per grid point, per keyword)', credits: 1, vendorCostUsd: 0.0006, vendor: 'DataForSEO Google Maps SERP (standard queue); live ~$0.002',
    unit: 'point', impact: 3, drives: ['Visibility measurement (ARP/ATRP/SoLV)', 'Finds weak zones to target'],
  },
  competitor_analysis: {
    label: 'Competitor gap analysis (top 3-pack)', credits: 12, vendorCostUsd: 0.03, vendor: 'DataForSEO Maps SERP + Claude summary',
    unit: 'run', impact: 4, drives: ['Category / review / post-frequency gaps'],
  },
  citation_standard: {
    label: 'Citation build — standard directory', credits: 200, vendorCostUsd: 0.55, vendor: 'Fulfilment team / submission API (avg 6 min labour)',
    unit: 'citation', impact: 3, drives: ['Prominence', 'NAP consistency', 'Referral traffic'],
  },
  citation_premium: {
    label: 'Citation build — premium/niche directory (BBB, Angi, Healthgrades…)', credits: 400, vendorCostUsd: 1.2, vendor: 'Fulfilment team (verification calls, docs)',
    unit: 'citation', impact: 4, drives: ['High-authority prominence', 'Industry relevance'],
  },
  citation_aggregator: {
    label: 'Data aggregator push (Data Axle / Foursquare / Neustar)', credits: 1500, vendorCostUsd: 4.5, vendor: 'Aggregator reseller fee (annual)',
    unit: 'aggregator/yr', impact: 4, drives: ['Feeds 100s of downstream directories', 'Apple/Bing/Alexa data'],
  },
  nap_scan: {
    label: 'NAP consistency scan (per directory)', credits: 1, vendorCostUsd: 0.002, vendor: 'SERP lookup',
    unit: 'directory', impact: 2, drives: ['Finds inconsistent/duplicate listings'],
  },
  tracking_number: {
    label: 'Call-tracking number (monthly)', credits: 250, vendorCostUsd: 1.15, vendor: 'Twilio local number',
    unit: 'number/month', impact: 3, drives: ['Attributes every phone lead to GBP'],
  },
  tracked_call_minute: {
    label: 'Tracked call minute (forwarded)', credits: 4, vendorCostUsd: 0.0085 + 0.014, vendor: 'Twilio inbound + forward',
    unit: 'minute', impact: 2, drives: ['Lead attribution, recordings'],
  },
  audit: {
    label: 'Profile audit & score', credits: 0, vendorCostUsd: 0, vendor: 'Internal', unit: 'run', impact: 3, drives: ['Prioritised fix list'],
  },
  sync_profile: {
    label: 'GBP sync (profile, reviews, insights)', credits: 0, vendorCostUsd: 0, vendor: 'Google APIs (free quota)', unit: 'run', impact: 2, drives: ['Fresh data for automation'],
  },
};

export const PLANS = {
  trial: {
    name: 'Free Trial', priceMonthly: 0, credits: 300, locations: 1, trialDays: 14,
    features: ['1 location', '300 credits', 'Audit + AI optimization', 'Geo-grid 5×5', 'Lead tracking links'],
  },
  starter: {
    name: 'Starter', priceMonthly: 39, priceAnnual: 390, credits: 4000, locations: 1, maxGrid: 7, seats: 1,
    features: ['1 location', '4,000 credits/mo', 'Autopilot posting (3/wk)', 'AI review replies', 'Weekly 7×7 geo-grid on 5 keywords', 'Call / SMS / WhatsApp tracking links', 'Email support'],
  },
  growth: {
    name: 'Growth', priceMonthly: 99, priceAnnual: 990, credits: 12000, locations: 3, maxGrid: 9, seats: 3, popular: true,
    features: ['3 locations', '12,000 credits/mo', 'Everything in Starter', '9×9 geo-grid, 10 keywords', 'Competitor gap analysis', 'Citation builder', 'Monthly ROI report'],
  },
  pro: {
    name: 'Pro', priceMonthly: 229, priceAnnual: 2290, credits: 32000, locations: 10, maxGrid: 13, seats: 10,
    features: ['10 locations', '32,000 credits/mo', 'Everything in Growth', '13×13 geo-grid', 'Data aggregator pushes', 'Approval workflows', 'Priority support'],
  },
  agency: {
    name: 'Agency', priceMonthly: 499, priceAnnual: 4990, credits: 70000, locations: 40, maxGrid: 15, seats: 25, whiteLabel: true,
    features: ['40 locations (+$9/loc after)', '70,000 credits/mo', 'White-label dashboard & reports', 'Client sub-accounts', 'API access', 'Dedicated success manager'],
  },
};

export const TOPUPS = [
  { id: 'topup_s', credits: 3000, priceUsd: 29 },
  { id: 'topup_m', credits: 12000, priceUsd: 99 },
  { id: 'topup_l', credits: 40000, priceUsd: 279 },
];

const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** Retail value of one credit for a plan (subscription price / included credits). */
export function creditRetailUsd(planKey = 'starter') {
  const p = PLANS[planKey]?.priceMonthly ? PLANS[planKey]
    : Object.values(PLANS).filter((x) => x.priceMonthly && x.credits).sort((a, b) => a.priceMonthly - b.priceMonthly)[0];
  return p ? p.priceMonthly / p.credits : 0.01;
}

/** 360° value map: cost → credits → revenue per action → margin → outcome. */
export function valueMap(planKey = 'starter') {
  const cr = creditRetailUsd(planKey);
  return Object.entries(CREDIT_ACTIONS).map(([key, a]) => {
    const revenue = a.credits * cr;
    const margin = revenue > 0 ? (revenue - a.vendorCostUsd) / revenue : null;
    return {
      key, label: a.label, unit: a.unit, credits: a.credits, vendor: a.vendor,
      vendor_cost_usd: round(a.vendorCostUsd), revenue_usd: round(revenue), gross_margin: margin == null ? null : round(margin, 3),
      impact: a.impact, drives: a.drives,
      value_per_credit: a.credits ? round(a.impact / a.credits, 3) : null,
    };
  });
}

/** A typical "rank-to-top" monthly workload for ONE location, used to size plans. */
export function monthlyWorkload({ postsPerWeek = 3, reviewsPerMonth = 12, keywords = 5, gridSize = 7, scansPerMonth = 4, citationsPerMonth = 10, optimizeRuns = 1, competitorRuns = 1 } = {}) {
  const items = [
    ['ai_post', Math.round(postsPerWeek * 4.33)],
    ['publish_post', Math.round(postsPerWeek * 4.33)],
    ['ai_review_reply', reviewsPerMonth],
    ['grid_point', gridSize * gridSize * keywords * scansPerMonth],
    ['citation_standard', citationsPerMonth],
    ['ai_profile_optimize', optimizeRuns],
    ['competitor_analysis', competitorRuns],
    ['keyword_research', 1],
  ];
  let credits = 0, vendor = 0;
  const lines = items.map(([k, qty]) => {
    const a = CREDIT_ACTIONS[k];
    credits += a.credits * qty; vendor += a.vendorCostUsd * qty;
    return { action: k, label: a.label, qty, credits: a.credits * qty, vendor_cost_usd: round(a.vendorCostUsd * qty, 3) };
  });
  return { lines, total_credits: credits, total_vendor_cost_usd: round(vendor, 2) };
}

/** Plan economics: how many full "rank-to-top" months each plan covers and its margin. */
export function planEconomics() {
  const w = monthlyWorkload();
  return Object.entries(PLANS).filter(([, p]) => p.priceMonthly).map(([key, p]) => {
    const locationsCovered = Math.floor(p.credits / w.total_credits * 10) / 10;
    // Vendor cost if credits fully consumed in the reference mix:
    const vendorAtFullUse = (p.credits / w.total_credits) * w.total_vendor_cost_usd;
    const infra = 1.5 + 0.6 * p.locations; // hosting, DB, email, support tooling
    const stripeFee = p.priceMonthly * 0.029 + 0.3;
    const grossMargin = (p.priceMonthly - vendorAtFullUse - infra - stripeFee) / p.priceMonthly;
    return {
      plan: key, name: p.name, price_monthly: p.priceMonthly, credits: p.credits, locations: p.locations,
      usd_per_credit: round(p.priceMonthly / p.credits, 5),
      full_workload_locations_covered: locationsCovered,
      vendor_cost_at_full_use: round(vendorAtFullUse, 2), infra_cost: round(infra, 2), payment_fee: round(stripeFee, 2),
      gross_margin_at_full_use: round(grossMargin, 3),
    };
  });
}

/** Customer ROI projection for a location given lead value assumptions. */
export function roiProjection({ planKey = 'starter', avgLeadValue = 150, closeRate = 0.3, baselineLeads = 20, liftPct = 0.35 }) {
  const plan = PLANS[planKey] || Object.values(PLANS).find((p) => p.priceMonthly) || { priceMonthly: 0 };
  const extraLeads = baselineLeads * liftPct;
  const extraRevenue = extraLeads * closeRate * avgLeadValue;
  return {
    plan: planKey, monthly_cost: plan.priceMonthly, extra_leads: round(extraLeads, 1), extra_revenue: round(extraRevenue, 0),
    roi_multiple: plan.priceMonthly ? round(extraRevenue / plan.priceMonthly, 1) : null,
    payback_leads: plan.priceMonthly ? Math.ceil(plan.priceMonthly / (closeRate * avgLeadValue)) : 0,
  };
}
