# RankPilot Local

Multi-tenant SaaS that gets local businesses into the Google Maps 3-pack and
turns that visibility into **calls, texts and WhatsApp leads**, mostly on
autopilot. Customers connect a Google Business Profile (GBP), and the platform:

| Module | What it does |
|---|---|
| **GBP connect & sync** | Google OAuth (`business.manage`), imports locations, syncs reviews and daily performance insights (calls, website clicks, directions, messages, bookings, impressions). |
| **Keyword engine** | Builds the keyword universe from the *nature of business* (11 industry playbooks), services, city and service areas: P1 money keywords, P2 service keywords, P3 long tail. Optionally pulls Google Ads volume + CPC. |
| **Audit & optimization** | Scores the profile on Relevance, Prominence, Visibility and Conversion, with a prioritised fix list. AI rewrites the description, services, secondary categories, FAQs and photo plan, then pushes them to Google. |
| **Automated posting** | Fills a weekly queue of keyword-rotated GBP posts (updates and offers). The CTA is a tracked WhatsApp/SMS/call link. Optional approval workflow. The scheduler publishes them. |
| **Review management** | AI replies that work in keywords. Positive reviews are auto-published; negative or risky ones are held for a human. |
| **Rank Map 360°** | Geo-grid rank tracking (3×3 to 15×15) with ARP, ATRP and Share of Local Voice, plus the competitors that own the 3-pack in each zone. Runs weekly on autopilot. |
| **Citation builder** | Directory catalog per country (US/UK/IN/CA/AU) plus industry niche sites and data aggregators. Each citation is paid in credits. Includes a fulfilment queue for operators and NAP-consistency checks. |
| **Lead tracking & ROI** | Tracked `call` / `sms` / `whatsapp` links (`/t/:code` → logs → `tel:` / `sms:` / `wa.me`), combined with Google-reported actions and valued as lead value × close rate. |
| **Credits & billing** | Credit ledger with atomic debits and automatic refunds when a vendor call fails. 4 plans plus top-ups via Stripe. A **360° value map** shows the vendor cost, price, margin and ranking impact of every action. See [`docs/PRICING.md`](docs/PRICING.md). |

## Quick start

```bash
npm install
npm run seed      # demo workspace: demo@rankpilot.local / demo12345
npm start         # http://localhost:3000
npm test          # 15 end-to-end API tests
```

Requires Node 22. Storage is libSQL (SQLite-compatible): a local file in
development, and [Turso](https://turso.tech) in production.

## Deploy to Vercel

The repo is already configured: `vercel.json`, the serverless entry in
`api/index.js`, and static files served from `public/`.

1. **Import the repo:** in Vercel, choose **Add New → Project**, pick this
   GitHub repo, and keep the defaults. Leave the Framework Preset on
   **Other**; `vercel.json` sets the rest.
2. **Deploy.** With no environment variables the app still runs: it uses
   an ephemeral demo database in `/tmp`, auto-seeded with the demo login,
   and the top bar shows a red "data resets" badge. This is fine for a
   preview, not for real customers.
3. **Add a persistent database:** in the project, open **Storage → Marketplace**
   and add **Turso**, which sets `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
   for you. Alternatively, create a DB at turso.tech and add the two
   variables yourself. The schema is created automatically on first request.
4. **Set environment variables** (Settings → Environment Variables):
   `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` (long random strings), plus
   whichever integration keys you have (`ANTHROPIC_API_KEY`,
   `DATAFORSEO_*`, `GOOGLE_*`, `STRIPE_*`). `BASE_URL` is optional; it's
   auto-detected from the Vercel production domain. Set it if you use a
   custom domain. Redeploy afterwards.
5. **Google OAuth:** add `https://<your-domain>/api/google/callback` as an
   authorized redirect URI in Google Cloud.
6. **Stripe:** point a webhook at `https://<your-domain>/api/billing/webhook`
   for `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed` and `customer.subscription.deleted`.
7. **Scheduler:** `vercel.json` registers a Vercel Cron job on
   `/api/cron/tick`. On the Hobby plan crons run **once a day**, which is
   too slow for timed posting, so pick one of:
   - **Vercel Pro:** change the schedule in `vercel.json` to `*/10 * * * *`.
   - **Free:** the included GitHub Actions workflow
     (`.github/workflows/scheduler.yml`) calls the endpoint every 15
     minutes. Add the repo secrets `APP_URL` and `CRON_SECRET`.

Each tick has a 240-second time budget (functions are allowed 300s).
Locations that don't fit are picked up on the next tick.

### Demo mode vs live mode

Every integration is optional. With no keys set, each module runs on
deterministic demo data, so the whole product can be clicked through end to
end. Add keys to `.env` (see `.env.example`) to switch modules to live:

| Integration | Env vars | Used for |
|---|---|---|
| Google Business Profile APIs | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | connect, sync, update profile, posts, review replies, insights |
| Claude (Anthropic) | `ANTHROPIC_API_KEY` | posts, review replies, profile optimization (structured JSON outputs) |
| DataForSEO | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | Maps SERP for geo-grid, keyword volume/CPC |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | subscriptions, top-ups, renewals (`/api/billing/webhook`) |

The top bar shows a "Demo integrations active" badge whenever any module is
still in demo mode.

**Google access note:** the Business Profile APIs need an approved access
request from Google (via the GBP API contact form) before OAuth calls
succeed. Request it early.

## Architecture

```
api/index.js         Vercel serverless entry (exports the Express app)
vercel.json          rewrites, function duration, cron
src/
  server.js          Express app (API + static SPA + /t/:code tracking redirect)
  routes.js          REST API (all tenant-scoped)
  scheduler.js       tick(): publishes due posts, runs autopilot, renews credits
  db.js              libSQL client (Turso / local file), schema, helpers
  auth.js            JWT (HS256), scrypt passwords, AES-256-GCM token encryption
  credits.js         atomic charge / refund / grant ledger
  pricing.js         credit catalog, plans, value map, plan economics, ROI model
  billing.js         Stripe checkout + webhooks (demo activation without keys)
  seed.js            demo workspace
  services/
    automation.js    every high-level operation (shared by API + scheduler)
    google.js        GBP OAuth + API client + demo adapter
    ai.js            Claude content engine + template fallback
    keywords.js      keyword generation, coverage, volume enrichment
    industries.js    business-nature playbooks (categories, services, themes, niche sites)
    audit.js         ranking-factor scoring
    geogrid.js       grid builder, SERP rank checks, ARP/ATRP/SoLV, competitors
    citations.js     directory catalog, NAP normalisation & matching
    leads.js         tracking links, lead events, lead summary
public/              SPA dashboard (vanilla JS, no build step)
docs/PRICING.md      unit economics & pricing rationale
test/e2e.test.js     end-to-end tests over HTTP
```

**Autopilot loop** (per location, every `AUTOPILOT_EVERY_HOURS`): sync profile,
reviews and insights → make sure keywords exist → fill the posting queue →
auto-reply to reviews → weekly geo-grid scans of the top keywords → re-audit.
If credits run out it pauses the location and logs why.

**Multi-tenancy:** every row carries `tenant_id`, and every route resolves
resources through it (covered by the tenant-isolation test). OAuth tokens are
encrypted at rest.

**Credits under concurrency:** debits use a single conditional
`UPDATE … WHERE credits_balance >= ? RETURNING`, so parallel serverless
invocations can't overdraw a balance.

**Scaling path:** move scan fan-out to a queue (DataForSEO standard-queue
postbacks are about 3× cheaper than live calls). On a non-serverless host,
run `node src/scheduler.js` as a worker and set `DISABLE_SCHEDULER=1` on the
web nodes.

## Not built yet

- Twilio call-tracking number provisioning and call recording. It's priced in
  the credit catalog, but no Twilio code exists yet. For now,
  `POST /api/locations/:id/leads` accepts lead webhooks from any call tracker.
- Standalone competitor gap report (geo-grid scans already show which
  competitors own each zone).
- Photo upload to GBP media and geo-tagging.
- White-label theming and client sub-accounts for the Agency plan (listed as
  plan features).
- Google retired the GBP Q&A API, so FAQs are generated for the website and
  for posts instead.
