import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, integrationStatus } from './config.js';
import { getDb } from './db.js';
import { api, trackingRedirect } from './routes.js';
import { startScheduler } from './scheduler.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  getDb();
  const app = express();
  app.disable('x-powered-by');
  // Stripe webhook needs the raw body, so JSON parsing skips that path.
  app.use((req, res, next) => (req.path === '/api/billing/webhook' ? next() : express.json({ limit: '1mb' })(req, res, next)));
  app.use('/api', api);
  app.get('/t/:code', trackingRedirect);
  app.use(express.static(path.join(here, '..', 'public')));
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
