import { q, id, tx } from './db.js';
import { CREDIT_ACTIONS } from './pricing.js';

export class InsufficientCreditsError extends Error {
  constructor(needed, balance) {
    super(`Insufficient credits: need ${needed}, have ${balance}`);
    this.status = 402; this.needed = needed; this.balance = balance;
  }
}

export function balance(tenantId) {
  return q.get('SELECT credits_balance FROM tenants WHERE id = ?', tenantId)?.credits_balance ?? 0;
}

export function quote(action, qty = 1) {
  const a = CREDIT_ACTIONS[action];
  if (!a) throw new Error(`Unknown credit action ${action}`);
  return { credits: a.credits * qty, vendorCostUsd: a.vendorCostUsd * qty };
}

/** Atomically debit credits for an action. Throws InsufficientCreditsError. */
export function charge(tenantId, action, { qty = 1, locationId = null, refId = null, note = null } = {}) {
  const { credits, vendorCostUsd } = quote(action, qty);
  if (credits === 0) return { credits: 0, balance: balance(tenantId) };
  return tx(() => {
    const t = q.get('SELECT credits_balance FROM tenants WHERE id = ?', tenantId);
    if (!t || t.credits_balance < credits) throw new InsufficientCreditsError(credits, t?.credits_balance ?? 0);
    const after = t.credits_balance - credits;
    q.run('UPDATE tenants SET credits_balance = ? WHERE id = ?', after, tenantId);
    q.run(`INSERT INTO credit_ledger (id, tenant_id, delta, balance_after, action, location_id, ref_id, vendor_cost_usd, note)
           VALUES (?,?,?,?,?,?,?,?,?)`, id('led_'), tenantId, -credits, after, action, locationId, refId, vendorCostUsd, note);
    return { credits, balance: after };
  });
}

/** Refund a previous charge (e.g. external API failed after debit). */
export function refund(tenantId, action, credits, { locationId = null, refId = null, note = 'refund' } = {}) {
  if (!credits) return;
  grant(tenantId, credits, `refund:${action}`, { locationId, refId, note });
}

export function grant(tenantId, credits, action, { locationId = null, refId = null, note = null } = {}) {
  return tx(() => {
    const t = q.get('SELECT credits_balance FROM tenants WHERE id = ?', tenantId);
    const after = (t?.credits_balance ?? 0) + credits;
    q.run('UPDATE tenants SET credits_balance = ? WHERE id = ?', after, tenantId);
    q.run(`INSERT INTO credit_ledger (id, tenant_id, delta, balance_after, action, location_id, ref_id, note)
           VALUES (?,?,?,?,?,?,?,?)`, id('led_'), tenantId, credits, after, action, locationId, refId, note);
    return after;
  });
}

/** Usage analytics: credits & vendor cost by action over N days. */
export function usageSummary(tenantId, days = 30) {
  const rows = q.all(`SELECT action, COUNT(*) AS events, -SUM(delta) AS credits, SUM(vendor_cost_usd) AS vendor_cost
                      FROM credit_ledger WHERE tenant_id = ? AND delta < 0 AND created_at >= datetime('now', ?)
                      GROUP BY action ORDER BY credits DESC`, tenantId, `-${days} days`);
  return rows.map((r) => ({ ...r, label: CREDIT_ACTIONS[r.action]?.label || r.action }));
}
