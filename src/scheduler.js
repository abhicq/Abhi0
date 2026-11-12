// Scheduler: publishes due posts and runs per-location autopilot.
//  - Long-running server: startScheduler() calls tick() every SCHEDULER_INTERVAL_MS.
//  - Serverless (Vercel): Cron / GitHub Actions call GET /api/cron/tick, which runs
//    one tick within a time budget; unfinished locations are picked up next tick.
import { q, logActivity } from './db.js';
import { config } from './config.js';
import { publishPostNow, runAutopilot } from './services/automation.js';
import { InsufficientCreditsError } from './credits.js';
import { PLANS } from './pricing.js';
import { grant } from './credits.js';

const AUTOPILOT_EVERY_HOURS = Number(process.env.AUTOPILOT_EVERY_HOURS || 6);
let running = false;

export async function tick({ budgetMs = Number(process.env.TICK_BUDGET_MS || 240_000) } = {}) {
  if (running) return { skipped: 'already running' }; running = true;
  const deadline = Date.now() + budgetMs;
  const summary = { published: 0, failed: 0, autopilot: 0, renewed: 0, deferred: 0 };
  try {
    // 1) Publish due posts
    const due = await q.all("SELECT p.id, p.tenant_id FROM posts p JOIN tenants t ON t.id = p.tenant_id WHERE p.status = 'scheduled' AND p.scheduled_at <= datetime('now') AND t.plan_status = 'active' LIMIT 100");
    for (const p of due) {
      try { await publishPostNow(p.tenant_id, p.id); summary.published++; }
      catch (e) { summary.failed++; if (e instanceof InsufficientCreditsError) await logActivity(p.tenant_id, null, 'billing', 'Post publishing paused: out of credits'); }
    }
    // 2) Autopilot per location
    const locs = await q.all(`SELECT l.id, l.tenant_id FROM locations l JOIN tenants t ON t.id = l.tenant_id
                        WHERE t.plan_status = 'active' AND (l.last_autopilot_at IS NULL OR l.last_autopilot_at <= datetime('now', ?)) LIMIT 50`, `-${AUTOPILOT_EVERY_HOURS} hours`);
    for (const l of locs) {
      if (Date.now() > deadline) { summary.deferred++; continue; }
      await q.run("UPDATE locations SET last_autopilot_at = datetime('now') WHERE id = ?", l.id);
      try { await runAutopilot(l.tenant_id, l.id); summary.autopilot++; }
      catch (e) {
        if (e instanceof InsufficientCreditsError) await logActivity(l.tenant_id, l.id, 'billing', `Autopilot paused: ${e.message}. Top up credits to resume.`);
        else { console.error('[scheduler] autopilot error', l.id, e.message); await logActivity(l.tenant_id, l.id, 'error', `Autopilot error: ${e.message}`); }
      }
    }
    // 3) Monthly credit renewal for non-Stripe (demo/manual) subscriptions
    const renew = await q.all("SELECT id, plan FROM tenants WHERE plan != 'trial' AND stripe_subscription_id IS NULL AND plan_renews_at <= datetime('now')");
    for (const t of renew) {
      await grant(t.id, PLANS[t.plan]?.credits || 0, 'plan_renewal', { note: t.plan });
      await q.run("UPDATE tenants SET plan_renews_at = datetime('now', '+1 month') WHERE id = ?", t.id); summary.renewed++;
    }
  } finally { running = false; }
  return summary;
}

export function startScheduler() {
  const h = setInterval(() => tick().catch((e) => console.error('[scheduler]', e)), config.schedulerIntervalMs);
  h.unref();
  return h;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`[scheduler] worker started, interval ${config.schedulerIntervalMs}ms`);
  tick(); setInterval(() => tick().catch(console.error), config.schedulerIntervalMs);
}
