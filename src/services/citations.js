// Citation directory catalog + NAP consistency engine.
// tier: core (everyone needs), standard, premium (niche/high-authority), aggregator.
export const DIRECTORIES = [
  // Core / global
  { id: 'google', name: 'Google Business Profile', da: 100, tier: 'core', countries: ['*'], method: 'api', managed: true },
  { id: 'bing', name: 'Bing Places', da: 93, tier: 'standard', countries: ['*'], method: 'import' },
  { id: 'apple', name: 'Apple Business Connect', da: 100, tier: 'standard', countries: ['*'], method: 'manual' },
  { id: 'facebook', name: 'Facebook Page', da: 96, tier: 'standard', countries: ['*'], method: 'manual' },
  { id: 'yelp', name: 'Yelp', da: 93, tier: 'standard', countries: ['US', 'CA', 'GB', 'AU'], method: 'manual' },
  { id: 'foursquare', name: 'Foursquare', da: 92, tier: 'standard', countries: ['*'], method: 'manual' },
  { id: 'instagram', name: 'Instagram Business', da: 99, tier: 'standard', countries: ['*'], method: 'manual' },
  { id: 'linkedin', name: 'LinkedIn Company Page', da: 98, tier: 'standard', countries: ['*'], method: 'manual' },
  { id: 'nextdoor', name: 'Nextdoor Business', da: 86, tier: 'standard', countries: ['US', 'GB', 'CA', 'AU'], method: 'manual' },
  { id: 'hotfrog', name: 'Hotfrog', da: 60, tier: 'standard', countries: ['*'], method: 'manual' },
  { id: 'cylex', name: 'Cylex', da: 55, tier: 'standard', countries: ['*'], method: 'manual' },
  { id: 'brownbook', name: 'Brownbook', da: 52, tier: 'standard', countries: ['*'], method: 'manual' },
  // US
  { id: 'bbb', name: 'Better Business Bureau', da: 92, tier: 'premium', countries: ['US', 'CA'], method: 'manual' },
  { id: 'yellowpages', name: 'YellowPages', da: 85, tier: 'standard', countries: ['US'], method: 'manual' },
  { id: 'manta', name: 'Manta', da: 74, tier: 'standard', countries: ['US'], method: 'manual' },
  { id: 'superpages', name: 'Superpages', da: 70, tier: 'standard', countries: ['US'], method: 'manual' },
  { id: 'citysearch', name: 'Citysearch', da: 72, tier: 'standard', countries: ['US'], method: 'manual' },
  { id: 'chamberofcommerce', name: 'ChamberofCommerce.com', da: 70, tier: 'standard', countries: ['US'], method: 'manual' },
  { id: 'mapquest', name: 'MapQuest', da: 86, tier: 'standard', countries: ['US'], method: 'aggregator-fed' },
  { id: 'merchantcircle', name: 'MerchantCircle', da: 68, tier: 'standard', countries: ['US'], method: 'manual' },
  { id: 'ezlocal', name: 'EZlocal', da: 50, tier: 'standard', countries: ['US'], method: 'manual' },
  { id: 'showmelocal', name: 'ShowMeLocal', da: 52, tier: 'standard', countries: ['US'], method: 'manual' },
  // UK
  { id: 'yell', name: 'Yell', da: 80, tier: 'standard', countries: ['GB'], method: 'manual' },
  { id: 'thomson', name: 'Thomson Local', da: 62, tier: 'standard', countries: ['GB'], method: 'manual' },
  { id: 'scoot', name: 'Scoot', da: 58, tier: 'standard', countries: ['GB'], method: 'manual' },
  { id: 'freeindex', name: 'FreeIndex', da: 60, tier: 'standard', countries: ['GB'], method: 'manual' },
  { id: 'checkatrade', name: 'Checkatrade', da: 70, tier: 'premium', countries: ['GB'], method: 'manual' },
  // India
  { id: 'justdial', name: 'Justdial', da: 82, tier: 'standard', countries: ['IN'], method: 'manual' },
  { id: 'sulekha', name: 'Sulekha', da: 78, tier: 'standard', countries: ['IN'], method: 'manual' },
  { id: 'indiamart', name: 'IndiaMART', da: 84, tier: 'standard', countries: ['IN'], method: 'manual' },
  { id: 'tradeindia', name: 'TradeIndia', da: 74, tier: 'standard', countries: ['IN'], method: 'manual' },
  { id: 'asklaila', name: 'AskLaila', da: 55, tier: 'standard', countries: ['IN'], method: 'manual' },
  // CA / AU
  { id: 'yellowpages_ca', name: 'YellowPages.ca', da: 75, tier: 'standard', countries: ['CA'], method: 'manual' },
  { id: 'truelocal', name: 'True Local', da: 62, tier: 'standard', countries: ['AU'], method: 'manual' },
  { id: 'yellow_au', name: 'Yellow Pages AU', da: 72, tier: 'standard', countries: ['AU'], method: 'manual' },
  // Niche (industry)
  { id: 'angi', name: 'Angi', da: 88, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'homeadvisor', name: 'HomeAdvisor', da: 86, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'houzz', name: 'Houzz', da: 92, tier: 'premium', countries: ['*'], method: 'manual', niche: true },
  { id: 'thumbtack', name: 'Thumbtack', da: 82, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'porch', name: 'Porch', da: 70, tier: 'standard', countries: ['US'], method: 'manual', niche: true },
  { id: 'healthgrades', name: 'Healthgrades', da: 88, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'zocdoc', name: 'Zocdoc', da: 82, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'vitals', name: 'Vitals', da: 78, tier: 'standard', countries: ['US'], method: 'manual', niche: true },
  { id: 'webmd', name: 'WebMD Care', da: 93, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'avvo', name: 'Avvo', da: 80, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'justia', name: 'Justia', da: 88, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'findlaw', name: 'FindLaw', da: 86, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'lawyers_com', name: 'Lawyers.com', da: 76, tier: 'standard', countries: ['US'], method: 'manual', niche: true },
  { id: 'martindale', name: 'Martindale-Hubbell', da: 78, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'tripadvisor', name: 'Tripadvisor', da: 93, tier: 'premium', countries: ['*'], method: 'manual', niche: true },
  { id: 'opentable', name: 'OpenTable', da: 88, tier: 'premium', countries: ['*'], method: 'manual', niche: true },
  { id: 'zomato', name: 'Zomato', da: 85, tier: 'standard', countries: ['IN', 'AU'], method: 'manual', niche: true },
  { id: 'booksy', name: 'Booksy', da: 70, tier: 'standard', countries: ['*'], method: 'manual', niche: true },
  { id: 'fresha', name: 'Fresha', da: 72, tier: 'standard', countries: ['*'], method: 'manual', niche: true },
  { id: 'styleseat', name: 'StyleSeat', da: 68, tier: 'standard', countries: ['US'], method: 'manual', niche: true },
  { id: 'zillow', name: 'Zillow Agent Profile', da: 91, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'realtor_com', name: 'Realtor.com', da: 90, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'homes_com', name: 'Homes.com', da: 82, tier: 'standard', countries: ['US'], method: 'manual', niche: true },
  { id: 'carfax', name: 'CARFAX Service Shops', da: 82, tier: 'premium', countries: ['US', 'CA'], method: 'manual', niche: true },
  { id: 'repairpal', name: 'RepairPal', da: 70, tier: 'premium', countries: ['US'], method: 'manual', niche: true },
  { id: 'mechanicadvisor', name: 'MechanicAdvisor', da: 50, tier: 'standard', countries: ['US'], method: 'manual', niche: true },
  // Aggregators
  { id: 'data_axle', name: 'Data Axle (Infogroup)', da: 0, tier: 'aggregator', countries: ['US', 'CA'], method: 'aggregator' },
  { id: 'foursquare_agg', name: 'Foursquare Data (Factual)', da: 0, tier: 'aggregator', countries: ['*'], method: 'aggregator' },
  { id: 'localeze', name: 'Neustar Localeze', da: 0, tier: 'aggregator', countries: ['US'], method: 'aggregator' },
];

export const creditActionForTier = (tier) => ({ aggregator: 'citation_aggregator', premium: 'citation_premium' }[tier] || 'citation_standard');

/** Directories recommended for a location: country + industry niche, ranked by authority. */
export function recommendedDirectories(loc, industry) {
  const country = (loc.country || 'US').toUpperCase().replace('UK', 'GB');
  return DIRECTORIES.filter((d) => d.countries.includes('*') || d.countries.includes(country))
    .filter((d) => !d.niche || (industry.niche || []).includes(d.id))
    .map((d) => ({ ...d, credit_action: creditActionForTier(d.tier), relevance: d.niche ? 'industry' : d.tier === 'aggregator' ? 'aggregator' : 'core' }))
    .sort((a, b) => (b.niche ? 1 : 0) - (a.niche ? 1 : 0) || b.da - a.da);
}

// NAP normalisation for consistency checks.
const ABBR = { street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr', suite: 'ste', lane: 'ln', court: 'ct', place: 'pl', highway: 'hwy', north: 'n', south: 's', east: 'e', west: 'w' };
export const normName = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(llc|inc|ltd|co|corp|pvt)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
export const normPhone = (s) => String(s || '').replace(/\D/g, '').slice(-10);
export const normAddr = (s) => String(s || '').toLowerCase().replace(/[.,#]/g, ' ').split(/\s+/).map((w) => ABBR[w] || w).join('').replace(/[^a-z0-9]/g, '');

export function napMatch(loc, found) {
  const issues = [];
  if (found.name && normName(found.name) !== normName(loc.name)) issues.push('name');
  if (found.phone && normPhone(found.phone) !== normPhone(loc.phone)) issues.push('phone');
  if (found.address && !normAddr(found.address).startsWith(normAddr(loc.address).slice(0, 12))) issues.push('address');
  return { match: issues.length === 0, issues };
}
