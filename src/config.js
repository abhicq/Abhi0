// Central configuration. Every external integration is optional: when its key
// is missing the platform runs that module in DEMO mode (deterministic mock data)
// so the full product can be evaluated end-to-end without vendor accounts.
import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency).
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;

/** Values saved in the admin panel (filled by settings.js). They take precedence over env vars. */
export const overrides = {};
const val = (k) => overrides[k] || env[k] || '';

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL
    || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : env.VERCEL_URL ? `https://${env.VERCEL_URL}` : `http://localhost:${env.PORT || 3000}`),
  isVercel: Boolean(env.VERCEL),
  cronSecret: env.CRON_SECRET || '',
  db: {
    url: env.TURSO_DATABASE_URL || env.DATABASE_URL
      || (env.VERCEL ? 'file:/tmp/rankpilot.db' : `file:${env.DB_PATH || path.resolve(process.cwd(), 'data', 'rankpilot.db')}`),
    authToken: env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN || '',
    // On Vercel without a hosted DB, data lives in /tmp and resets on cold start.
    get ephemeral() { return Boolean(env.VERCEL) && !(env.TURSO_DATABASE_URL || env.DATABASE_URL); },
  },
  jwtSecret: env.JWT_SECRET || 'dev-insecure-secret-change-me',
  encryptionKey: env.ENCRYPTION_KEY || 'dev-insecure-encryption-key-change-me', // for OAuth tokens at rest
  schedulerIntervalMs: Number(env.SCHEDULER_INTERVAL_MS || 60_000),

  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),

  google: {
    get clientId() { return val('GOOGLE_CLIENT_ID'); },
    get clientSecret() { return val('GOOGLE_CLIENT_SECRET'); },
    get redirectUri() { return env.GOOGLE_REDIRECT_URI || `${config.baseUrl}/api/google/callback`; },
    get enabled() { return Boolean(this.clientId && this.clientSecret); },
  },
  anthropic: {
    get apiKey() { return val('ANTHROPIC_API_KEY'); },
    // The SDK also resolves ANTHROPIC_AUTH_TOKEN / `ant auth login` profiles.
    get enabled() { return Boolean(this.apiKey || env.ANTHROPIC_AUTH_TOKEN); },
    get model() { return val('ANTHROPIC_MODEL') || 'claude-opus-5-5'; },
  },
  dataforseo: {
    get login() { return val('DATAFORSEO_LOGIN'); },
    get password() { return val('DATAFORSEO_PASSWORD'); },
    get enabled() { return Boolean(this.login && this.password); },
  },
  stripe: {
    get secretKey() { return val('STRIPE_SECRET_KEY'); },
    get webhookSecret() { return val('STRIPE_WEBHOOK_SECRET'); },
    get enabled() { return Boolean(this.secretKey); },
  },
};

export function integrationStatus() {
  return {
    database: config.db.ephemeral ? 'ephemeral' : config.db.url.startsWith('file:') ? 'local' : 'live',
    google_business_profile: config.google.enabled ? 'live' : 'demo',
    ai_content: config.anthropic.enabled ? 'live' : 'demo',
    rank_tracking_serp: config.dataforseo.enabled ? 'live' : 'demo',
    billing_stripe: config.stripe.enabled ? 'live' : 'demo',
  };
}
