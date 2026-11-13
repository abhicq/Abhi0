// AI content engine. Uses Claude (Anthropic SDK) with structured JSON outputs
// when credentials exist; otherwise deterministic, keyword-aware templates so
// automation keeps working in demo mode.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { getIndustry } from './industries.js';

let client, clientKey;
/** Recreated when the API key is changed in the admin panel. */
function getClient() {
  const key = config.anthropic.apiKey || undefined;
  if (!client || clientKey !== key) { client = new Anthropic(key ? { apiKey: key } : {}); clientKey = key; }
  return client;
}

const SYSTEM = `You are a senior local-SEO strategist and copywriter for Google Business Profiles.
Rules you always follow:
- Write naturally for humans first; weave the target keyword and city in once or twice, never stuffed.
- Follow Google Business Profile content policies: no phone numbers or URLs inside post text, no ALL CAPS, no misleading claims, no prohibited content.
- Use only facts given about the business. Never invent awards, prices, years in business or guarantees.
- Keep tone confident, local and helpful. Plain text, no markdown, no hashtags.`;

class AiRefusal extends Error {}

async function structured(prompt, schema, { effort = 'low', maxTokens = 4000 } = {}) {
  const res = await getClient().beta.messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  });
  if (res.stop_reason === 'refusal') throw new AiRefusal('AI declined this request');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { data: JSON.parse(text), usage: res.usage };
}

const facts = (loc) => JSON.stringify({
  name: loc.name, category: loc.primary_category, city: loc.city, region: loc.region,
  services: (loc.services || []).map((s) => s.name || s), service_areas: loc.service_areas,
  existing_description: loc.description || null, attributes: loc.attributes,
});

// ── Posts ───────────────────────────────────────────────────────────────────
const POST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'cta_type', 'image_prompt'],
  properties: {
    summary: { type: 'string', description: '700-1200 characters, GBP post body' },
    cta_type: { type: 'string', enum: ['CALL', 'BOOK', 'LEARN_MORE', 'ORDER', 'SIGN_UP', 'GET_OFFER'] },
    image_prompt: { type: 'string', description: 'Short description of an authentic photo to attach' },
  },
};

export async function generatePost(loc, { keyword, theme, topicType = 'STANDARD', offer } = {}) {
  const ind = getIndustry(loc.industry);
  theme ||= ind.postThemes[Math.floor(Math.random() * ind.postThemes.length)];
  if (config.anthropic.enabled) {
    try {
      const { data } = await structured(
        `Business facts: ${facts(loc)}\nWrite one Google Business Profile ${topicType} post.\nTarget keyword: "${keyword}".\nTheme: ${theme}.${offer ? `\nOffer details: ${offer}` : ''}\nEnd with a clear call to action to call, text or message on WhatsApp.`,
        POST_SCHEMA);
      return { ...data, theme, mode: 'live' };
    } catch (e) { if (!(e instanceof AiRefusal)) console.error('[ai] post generation failed, using template:', e.message); }
  }
  return { ...templatePost(loc, keyword, theme, offer), theme, mode: 'demo' };
}

function templatePost(loc, keyword, theme, offer) {
  const city = loc.city || 'your area';
  const all = [...(loc.services || []).map((s) => s.name || s), ...getIndustry(loc.industry).services];
  const svc = all.find((s) => (keyword || '').toLowerCase().includes(s.toLowerCase())) || all[Math.floor(Math.random() * Math.max(1, all.length))] || 'our services';
  const kw = keyword || `${loc.primary_category || 'service'} ${city}`;
  const openers = [
    `Looking for ${kw}? ${loc.name} is your local team in ${city}.`,
    `${city} neighbours trust ${loc.name} when they need ${kw}.`,
    `Quick ${theme} update from ${loc.name}, your go-to for ${kw}.`,
  ];
  const opener = openers[Math.floor(Math.random() * openers.length)];
  const body = `${opener} Our specialists handle ${svc.toLowerCase()} and more, with clear upfront advice and friendly, on-time service. ${offer ? `This month: ${offer}. ` : ''}Every job is done right the first time so you can get on with your day.`;
  const close = ` Tap Call now, send us a text or message us on WhatsApp and we will get back to you fast.`;
  return { summary: (body + close).slice(0, 1450), cta_type: offer ? 'GET_OFFER' : 'CALL', image_prompt: `Real photo of the ${loc.name} team working on ${svc.toLowerCase()} in ${city}` };
}

// ── Review replies ──────────────────────────────────────────────────────────
const REPLY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'sentiment', 'needs_human'],
  properties: {
    reply: { type: 'string', description: '40-110 words' },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    needs_human: { type: 'boolean', description: 'true if complaint, legal/medical risk, or factual dispute' },
  },
};

export async function generateReviewReply(loc, review, keywords = []) {
  if (config.anthropic.enabled) {
    try {
      const { data } = await structured(
        `Business facts: ${facts(loc)}\nReview (${review.rating}/5) by ${review.reviewer || 'a customer'}: """${review.comment || '(no text)'}"""\nWrite the owner's reply. Thank them by first name, reference what they mentioned, and naturally mention the service and ${loc.city || 'the city'} once if it fits (useful keywords: ${keywords.slice(0, 3).join(', ')}). For negative reviews: apologise, no excuses, invite them to contact the office offline.`,
        REPLY_SCHEMA);
      return { ...data, mode: 'live' };
    } catch (e) { if (!(e instanceof AiRefusal)) console.error('[ai] review reply failed, using template:', e.message); }
  }
  const first = (review.reviewer || 'there').split(' ')[0];
  const svc = (loc.services?.[0]?.name || loc.services?.[0] || loc.primary_category || 'service').toLowerCase();
  if ((review.rating || 5) >= 4) {
    return { reply: `Thank you so much, ${first}! We're thrilled you were happy with our ${svc}. Serving ${loc.city || 'our community'} is what we love to do, and reviews like yours mean a lot to the whole ${loc.name} team. We're here whenever you need us again!`, sentiment: 'positive', needs_human: false, mode: 'demo' };
  }
  if (review.rating === 3) {
    return { reply: `Thanks for the honest feedback, ${first}. We're glad we could help, and we'd love to hear how we can make your next ${svc} experience a 5-star one. Please reach out to our office anytime.`, sentiment: 'neutral', needs_human: false, mode: 'demo' };
  }
  return { reply: `${first}, we're sorry your experience didn't meet the standard we hold ourselves to. We'd like to make this right — please contact our office directly so a manager can look into it personally.`, sentiment: 'negative', needs_human: true, mode: 'demo' };
}

// ── Profile optimization ────────────────────────────────────────────────────
const OPT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['description', 'services', 'secondary_categories', 'faqs', 'photo_ideas'],
  properties: {
    description: { type: 'string', description: '600-740 characters' },
    services: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: { type: 'string' }, description: { type: 'string' } } } },
    secondary_categories: { type: 'array', items: { type: 'string' } },
    faqs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'answer'], properties: { question: { type: 'string' }, answer: { type: 'string' } } } },
    photo_ideas: { type: 'array', items: { type: 'string' } },
  },
};

export async function optimizeProfile(loc, keywords = []) {
  const ind = getIndustry(loc.industry);
  const kws = keywords.slice(0, 12).map((k) => k.keyword || k);
  if (config.anthropic.enabled) {
    try {
      const { data } = await structured(
        `Business facts: ${facts(loc)}\nIndustry playbook categories: ${ind.secondaryCategories.join(', ')}\nPriority keywords to rank for: ${kws.join('; ')}\nProduce: (1) a GBP description (first 250 chars must contain the primary service + city), (2) 8-12 services with 1-sentence keyword-rich descriptions under 300 chars, (3) up to 4 secondary categories valid in Google's category list, (4) 6 FAQs customers search for (for the website FAQ page and posts), (5) 8 photo ideas that prove real local work.`,
        OPT_SCHEMA, { effort: 'medium', maxTokens: 8000 });
      return { ...data, mode: 'live' };
    } catch (e) { if (!(e instanceof AiRefusal)) console.error('[ai] optimization failed, using template:', e.message); }
  }
  const city = loc.city || 'your area';
  const seen = new Set();
  const services = [...(loc.services || []).map((s) => s.name || s), ...ind.services].filter((s) => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase())).slice(0, 10);
  const cat = loc.primary_category || ind.primaryCategory || 'local business';
  const description = `${loc.name} is a trusted ${cat.toLowerCase()} in ${city}, offering ${services.slice(0, 3).join(', ').toLowerCase()} and more. ` +
    `Our local team serves ${[city, ...(loc.service_areas || []).slice(0, 3)].join(', ')} with honest advice, clear pricing and fast response times. ` +
    `From ${services[3]?.toLowerCase() || 'routine work'} and ${services[4]?.toLowerCase() || 'repairs'} to ${services[5]?.toLowerCase() || 'urgent jobs'}, every job is handled by trained, insured professionals who explain your options before work begins and clean up when they finish. ` +
    `We treat every customer like a neighbour. Call, text or message us on WhatsApp to book.`;
  return {
    description: description.slice(0, 750),
    services: services.map((s) => ({ name: s, description: `Professional ${s.toLowerCase()} in ${city} by the experienced ${loc.name} team.` })),
    secondary_categories: ind.secondaryCategories.slice(0, 4),
    faqs: services.slice(0, 6).map((s) => ({ question: `Do you offer ${s.toLowerCase()} in ${city}?`, answer: `Yes — ${loc.name} provides ${s.toLowerCase()} across ${city} and nearby areas. Contact us for availability.` })),
    photo_ideas: ['Team photo in front of branded vehicle/storefront', ...services.slice(0, 5).map((s) => `Before/after of a real ${s.toLowerCase()} job in ${city}`), 'Interior/workspace photo', 'Owner portrait with customer (with consent)'],
    mode: 'demo',
  };
}
