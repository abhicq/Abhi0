import Stripe from 'stripe';
import { config } from './config.js';
import { q } from './db.js';
import { PLANS, TOPUPS } from './pricing.js';
import { grant } from './credits.js';

const stripe = config.stripe.enabled ? new Stripe(config.stripe.secretKey) : null;

export function activatePlan(tenantId, planKey, { subscriptionId = null, customerId = null } = {}) {
  const plan = PLANS[planKey];
  if (!plan) throw Object.assign(new Error('Unknown plan'), { status: 400 });
  q.run(`UPDATE tenants SET plan = ?, plan_status = 'active', plan_renews_at = datetime('now', '+1 month'),
         stripe_subscription_id = COALESCE(?, stripe_subscription_id), stripe_customer_id = COALESCE(?, stripe_customer_id) WHERE id = ?`,
  planKey, subscriptionId, customerId, tenantId);
  grant(tenantId, plan.credits, 'plan_credits', { note: planKey });
}

/** Returns a checkout URL (Stripe) or activates immediately in demo mode. */
export async function checkout(tenant, { plan, topup, interval = 'month' }) {
  if (plan && !PLANS[plan]?.priceMonthly) throw Object.assign(new Error('Unknown plan'), { status: 400 });
  const pack = topup && TOPUPS.find((t) => t.id === topup);
  if (topup && !pack) throw Object.assign(new Error('Unknown top-up'), { status: 400 });
  if (!stripe) {
    if (plan) activatePlan(tenant.id, plan);
    if (pack) grant(tenant.id, pack.credits, 'topup', { note: `${pack.id} (demo)` });
    return { mode: 'demo', activated: plan || pack.id };
  }
  const p = PLANS[plan];
  const session = await stripe.checkout.sessions.create({
    mode: plan ? 'subscription' : 'payment',
    customer: tenant.stripe_customer_id || undefined,
    client_reference_id: tenant.id,
    metadata: { tenant_id: tenant.id, plan: plan || '', topup: topup || '' },
    line_items: [plan
      ? { quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round((interval === 'year' ? p.priceAnnual : p.priceMonthly) * 100), recurring: { interval }, product_data: { name: `RankPilot ${p.name}` } } }
      : { quantity: 1, price_data: { currency: 'usd', unit_amount: pack.priceUsd * 100, product_data: { name: `${pack.credits.toLocaleString()} credits` } } }],
    success_url: `${config.baseUrl}/#billing?ok=1`, cancel_url: `${config.baseUrl}/#billing`,
  });
  return { mode: 'live', url: session.url };
}

export function handleWebhook(rawBody, signature) {
  if (!stripe) throw Object.assign(new Error('Stripe not configured'), { status: 400 });
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  const o = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const tenantId = o.metadata?.tenant_id;
    if (o.metadata?.plan) activatePlan(tenantId, o.metadata.plan, { subscriptionId: o.subscription, customerId: o.customer });
    if (o.metadata?.topup) { const pack = TOPUPS.find((t) => t.id === o.metadata.topup); if (pack) grant(tenantId, pack.credits, 'topup', { refId: o.id }); }
  } else if (event.type === 'invoice.paid' && o.billing_reason === 'subscription_cycle') {
    const t = q.get('SELECT id, plan FROM tenants WHERE stripe_subscription_id = ?', o.subscription);
    if (t) grant(t.id, PLANS[t.plan]?.credits || 0, 'plan_renewal', { refId: o.id });
  } else if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    q.run("UPDATE tenants SET plan_status = 'past_due' WHERE stripe_subscription_id = ?", o.subscription || o.id);
  }
  return { received: true, type: event.type };
}
