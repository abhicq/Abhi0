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

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
  dbPath: env.DB_PATH || path.resolve(process.cwd(), 'data', 'rankpilot.db'),
  jwtSecret: env.JWT_SECRET || 'dev-insecure-secret-change-me',
  encryptionKey: env.ENCRYPTION_KEY || 'dev-insecure-encryption-key-change-me', // for OAuth tokens at rest
  schedulerIntervalMs: Number(env.SCHEDULER_INTERVAL_MS || 60_000),

  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || `${env.BASE_URL || `http://localhost:${env.PORT || 3000}`}/api/google/callback`,
    get enabled() { return Boolean(this.clientId && this.clientSecret); },
  },
  anthropic: {
    // The SDK also resolves ANTHROPIC_AUTH_TOKEN / `ant auth login` profiles.
    enabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  },
  dataforseo: {
    login: env.DATAFORSEO_LOGIN || '',
    password: env.DATAFORSEO_PASSWORD || '',
    get enabled() { return Boolean(this.login && this.password); },
  },
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    get enabled() { return Boolean(this.secretKey); },
  },
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    get enabled() { return Boolean(this.accountSid && this.authToken); },
  },
};

export function integrationStatus() {
  return {
    google_business_profile: config.google.enabled ? 'live' : 'demo',
    ai_content: config.anthropic.enabled ? 'live' : 'demo',
    rank_tracking_serp: config.dataforseo.enabled ? 'live' : 'demo',
    billing_stripe: config.stripe.enabled ? 'live' : 'demo',
  };
}
