# Pricing, credits & 360° value map

Everything billable is priced in **credits**, derived bottom-up from the real
vendor cost of each API call or fulfilment task, then mapped to the ranking
signal it moves. Single source of truth: `src/pricing.js` (`CREDIT_ACTIONS`,
`PLANS`, `TOPUPS`). The Billing page and `GET /api/pricing` render the same data.

> Vendor costs are list-price estimates as of Nov 2026. Re-check DataForSEO,
> Anthropic, Twilio and your citation fulfilment cost before launch and edit
> `vendorCostUsd` — margins and plan-fit maths recompute automatically.

## 1. Cost per action (what the APIs actually cost us)

| Action | Credits | Vendor cost | Vendor | Ranking impact |
|---|---:|---:|---|---|
| AI-written GBP post | 4 | $0.012 | Claude Opus 5.5 (~1.2k in / 400 out, low effort) | ●●●●○ freshness, keyword relevance, CTA clicks |
| Publish post to Google | 1 | ~$0.0005 | GBP API (free) + infra | ●●●○○ activity |
| AI review reply | 2 | $0.006 | Claude Opus 5.5 | ●●●●○ response rate, trust |
| AI profile optimization | 25 | $0.08 | Claude Opus 5.5 (medium effort) | ●●●●● relevance |
| Keyword research (volume + CPC) | 15 | $0.075 | DataForSEO Keywords Data | ●●●●○ targeting |
| Geo-grid point | 1 | $0.0006 | DataForSEO Maps SERP (std queue; live ≈ $0.002) | ●●●○○ measurement |
| Citation — standard | 200 | ~$0.55 | Fulfilment labour (~6 min) | ●●●○○ prominence, NAP |
| Citation — premium/niche | 400 | ~$1.20 | Fulfilment + verification | ●●●●○ authority |
| Data aggregator push | 1,500 | ~$4.50 | Aggregator reseller fee / yr | ●●●●○ downstream coverage |
| Audit, GBP sync | 0 | $0 | internal / free quota | Free, so customers engage |

**Why these numbers:**
- AI and SERP calls cost fractions of a cent, so they're priced as cheap,
  high-frequency actions. Grid points at 1 credit (≈ $0.007–0.010) are
  competitive with the usual geo-grid tools.
- Citations are ~85% of real cost (it's human labour), so they're the only
  action priced near cost × 3. At ≈ $1.30–1.95 each they still undercut the
  common ~$2–3/citation market rate.
- Audit and sync are free. They show customers the gaps that the paid
  actions then close.

## 2. Reference "rank-to-top" workload (1 location / month)

| Line | Qty | Credits | Vendor $ |
|---|---:|---:|---:|
| AI posts (3/week) | 13 | 52 | 0.16 |
| Publish posts | 13 | 13 | 0.01 |
| AI review replies | 12 | 24 | 0.07 |
| Geo-grid 7×7 × 5 keywords × 4 weekly scans | 980 | 980 | 0.59 |
| Standard citations | 10 | 2,000 | 5.50 |
| Profile optimization | 1 | 25 | 0.08 |
| Competitor analysis | 1 | 12 | 0.03 |
| Keyword research | 1 | 15 | 0.08 |
| **Total** | | **3,121** | **$6.51** |

After the first ~3 months citations taper off, and a location in
"maintenance mode" uses about 1,100 credits/month.

## 3. Plans & unit economics

| Plan | Price | Credits | Locations | $/1k credits | Full-workload locs covered | Vendor cost @100% use | Gross margin @100% use |
|---|---:|---:|---:|---:|---:|---:|---:|
| Starter | $39 | 4,000 | 1 | $9.75 | 1.2 | $8.34 | 70% |
| Growth | $99 | 12,000 | 3 | $8.25 | 3.8 | $25.03 | 68% |
| Pro | $229 | 32,000 | 10 | $7.16 | 10.2 | $66.75 | 65% |
| Agency | $499 | 70,000 | 40 | $7.13 | 22.4 | $146.01 | 63% |

Margins already include infra (hosting, DB, email, about $0.60 per location)
and Stripe fees, and assume **every** credit gets spent on the most
labour-heavy mix. Typical SaaS utilisation is 55–75%, so the real blended
margin is about 75–80%. A test (`pricing economics keep healthy margins`)
fails if any plan drops below 60% at full use.

Top-ups: 3,000 / $29, 12,000 / $99, 40,000 / $279. Annual billing = 2 months free.
The trial gives 300 credits for 14 days: enough for an audit, one AI
optimization, a 5×5 scan and a few posts, which is the "aha" moment.

## 4. Customer ROI

A plumber with a $150 average job, 30% close rate and 20 GBP leads/month
who gets a 35% visibility lift: +7 leads → +$315/month on the $39 Starter
plan ≈ **8× ROI**, paid back after one closed lead. The in-app ROI
calculator (`POST /api/billing/estimate`) runs this for any inputs and
recommends the cheapest plan plus top-ups for the workload.
