import { q, id } from './db.js';
import { CREDIT_ACTIONS } from './pricing.js';

export class InsufficientCreditsError extends Error {
  constructor(needed, balance) {
    super(`Insufficient credits: need ${needed}, have ${balance}`);
    this.status = 402; this.needed = needed; this.balance = balance;
  }
}

export async function balance(tenantId) {
  return (await q.get('SELECT credits_balance FROM tenants WHERE id = ?', tenantId))?.credits_balance ?? 0;
}

export function quote(action, qty = 1) {
  const a = CREDIT_ACTIONS[action];
  if (!a) throw new Error(`Unknown credit action ${action}`);
  return { credits: a.credits * qty, vendorCostUsd: a.vendorCostUsd * qty };
}

/**
 * Debit credits for an action. The conditional UPDATE ... RETURNING is atomic,
 * so concurrent serverless invocations can never overdraw a balance.
 */
export async function charge(tenantId, action, { qty = 1, locationId = null, refId = null, note = null } = {}) {
  const { credits, vendorCostUsd } = quote(action, qty);
  if (credits === 0) return { credits: 0, balance: await balance(tenantId) };
  const row = await q.get('UPDATE tenants SET credits_balance = credits_balance - ? WHERE id = ? AND credits_balance >= ? RETURNING credits_balance', credits, tenantId, credits);
  if (!row) throw new InsufficientCreditsError(credits, await balance(tenantId));
  await q.run(`INSERT INTO credit_ledger (id, tenant_id, delta, balance_after, action, location_id, ref_id, vendor_cost_usd, note)
               VALUES (?,?,?,?,?,?,?,?,?)`, id('led_'), tenantId, -credits, row.credits_balance, action, locationId, refId, vendorCostUsd, note);
  return { credits, balance: row.credits_balance };
}

/** Refund a previous charge (e.g. external API failed after debit). */
export async function refund(tenantId, action, credits, { locationId = null, refId = null, note = 'refund' } = {}) {
  if (!credits) return;
  await grant(tenantId, credits, `refund:${action}`, { locationId, refId, note });
}

export async function grant(tenantId, credits, action, { locationId = null, refId = null, note = null } = {}) {
  const row = await q.get('UPDATE tenants SET credits_balance = credits_balance + ? WHERE id = ? RETURNING credits_balance', credits, tenantId);
  const after = row?.credits_balance ?? 0;
  await q.run(`INSERT INTO credit_ledger (id, tenant_id, delta, balance_after, action, location_id, ref_id, note)
               VALUES (?,?,?,?,?,?,?,?)`, id('led_'), tenantId, credits, after, action, locationId, refId, note);
  return after;
}

/** Usage analytics: credits & vendor cost by action over N days. */
export async function usageSummary(tenantId, days = 30) {
  const rows = await q.all(`SELECT action, COUNT(*) AS events, -SUM(delta) AS credits, SUM(vendor_cost_usd) AS vendor_cost
                      FROM credit_ledger WHERE tenant_id = ? AND delta < 0 AND created_at >= datetime('now', ?)
                      GROUP BY action ORDER BY credits DESC`, tenantId, `-${days} days`);
  return rows.map((r) => ({ ...r, label: CREDIT_ACTIONS[r.action]?.label || r.action }));
}
