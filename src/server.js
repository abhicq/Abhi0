import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, integrationStatus } from './config.js';
import { initDb, q } from './db.js';
import { api, trackingRedirect } from './routes.js';
import { startScheduler } from './scheduler.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let booted;
/** Create schema; on Vercel without a hosted DB, seed the demo workspace into /tmp. */
export function ensureReady() {
  booted ??= (async () => {
    await initDb();
    if (config.db.ephemeral && !(await q.get('SELECT id FROM users LIMIT 1'))) {
      const { seedDemo } = await import('./seed.js');
      await seedDemo();
    }
  })().catch((e) => { booted = null; throw e; });
  return booted;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(async (req, res, next) => { try { await ensureReady(); next(); } catch (e) { next(e); } });
  // Stripe webhook needs the raw body, so JSON parsing skips that path.
  app.use((req, res, next) => (req.path === '/api/billing/webhook' ? next() : express.json({ limit: '1mb' })(req, res, next)));
  app.use('/api', api);
  app.get('/t/:code', trackingRedirect);
  app.use(express.static(path.join(here, '..', 'public'))); // local dev; Vercel serves public/ from its CDN
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message, ...(err.needed ? { needed: err.needed, balance: err.balance } : {}) });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`RankPilot Local running on ${config.baseUrl}`);
    console.log('Integrations:', integrationStatus());
  });
  if (process.env.DISABLE_SCHEDULER !== '1') startScheduler();
}
