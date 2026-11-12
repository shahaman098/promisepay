# PromisePay — self-executing service guarantees on PayPal

**Merchants sell promises ("2-day delivery or $5 back", "fixed in 48h or full refund", "best price or the difference"). The AI turns each promise into an executable SLA, verifies the breach against real evidence feeds, and the refund moves itself — or refuses, with every failed proof obligation persisted on the record.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com) (Nov 2026). PayPal is the execution spine: Orders v2 → capture → **Refund API**, driven by webhook/evidence events. AI (Llama 3.3 70B on Cloudflare Workers AI, live in the deployed demo) is indispensable where a form cannot be: parsing arbitrary promise prose into exact, validated SLAs, or refusing. The breach decision is rule-based on purpose (inconclusive ⇒ fail-closed, never pays on a guess).

## Try it in 60 seconds (judges)

- **Live demo:** https://promisepay.kiritokris.workers.dev (no login, no PayPal account, no keys needed; the UI ships with a demo API key)
  - **Buyer** tab: an enforced promise and its refund receipt. **Merchant** tab: write a promise, *Parse preview*, *Create guarantee*, add evidence, *Evaluate*, *Execute remedy*. **Record** tab: every refusal on the audit trail. *Reset demo data* restores the curated dataset.
  - Demo ids starting with `OFFLINE-` are labelled `fixture` records (simulated, no money moves). Real sandbox money is shown by `npm run verify:sandbox` below.
- **Demo video (under 3 min):** <YouTube link>
- **Architecture:** https://promisepay.kiritokris.workers.dev/architecture.html
- **License:** MIT (see [LICENSE](./LICENSE))

## Who it's for and why it matters

Small online merchants make promises ("2-day delivery or $5 back") to win buyers' trust, but nothing enforces them: buyers have to complain, merchants handle refunds by hand, and disputes follow. PromisePay makes the promise itself executable. The buyer gets the remedy without filing anything; the merchant gets fewer disputes and a guarantee they can prove they honour.

## How PayPal and AI are used

| | What | Where in the code |
|---|---|---|
| **PayPal** | Orders v2 (create, get, capture), Payments **Refund API** with `PayPal-Request-Id` idempotency, capture lookup for identity checks, webhook signature verification (`/v1/notifications/verify-webhook-signature`) | `server/src/paypal.js`, `server/src/enforce.js` |
| **AI** | **Llama 3.3 70B** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) on **Cloudflare Workers AI** turns promise prose into a strict JSON contract or refuses it. Deterministic guards run first; every model output is validated against the source text (stated amounts, full-refund wording) before a guarantee exists. Optional: any OpenAI-compatible endpoint via `OPENAI_API_KEY`. | `server/src/ai/parser.js`, `worker/entry.js` |
| **Evidence verifier** | Rule-based (not AI): breach / no-breach / INCONCLUSIVE, fail-closed | `server/src/ai/verify.js` |

## Measured parser quality

On a labelled set of 24 promises (13 executable, 11 that must be refused), the live parser (Llama 3.3 70B on Workers AI, plus deterministic guards and validation) got **23/24 right and refused 11/11 unsafe promises: zero false guarantees**. The one miss was a refusal, never a wrong payout. Median end-to-end response 801 ms (LLM-answered cases: median 908 ms, p90 1.5 s), sequential requests, 12 Nov 2026. Reproduce: `npm run eval:parser -- <url>`.

Architecture diagram: [`web/architecture.html`](./web/architecture.html) (served at `/architecture.html`).

## Design invariants (what makes this hard to fake)

1. **Server-side, fail-closed enforcement.** Money moves only via `POST /api/guarantees/:id/execute-remedy`, which re-checks every proof obligation *at transition time*: amount, currency, transaction identity, evidence references, promise version.
2. **Absence of evidence never pays.** Unknown/inconclusive status ⇒ refused with a persisted `failed_obligations` audit record.
3. **Optimistic concurrency.** Stale promise versions and racing executes are rejected (compare-and-swap); exactly one refund lands.
4. **Provenance discipline.** Every payment record carries its provenance (`paypal-sandbox` + retrieval time, or `fixture`) — we never claim sandbox data where there is none.
5. **Idempotent refunds.** PayPal-Request-Id keyed per transition.

## Run it (offline mode — no PayPal account needed)

```bash
# requires Node 22+
npm install
npm run seed    # two demo guarantees: one breached → refund; one inconclusive → refused
npm start       # http://localhost:8787 — buyer view + merchant console served from the API itself
npm test        # 20 tests: adversarial matrix + parser eval corpus + API contract + audit regressions
```

## Deploy (Cloudflare Workers — live demo)

Deployed with `npx wrangler deploy` → **https://promisepay.kiritokris.workers.dev**

- The API runs inside a single **Durable Object** (`PromisePayDO`): every request serializes through it, state persists in DO storage, and the enforcement CAS is honored across the fleet of one.
- The demo UI ships via **Workers Static Assets**; `/api/*` and `/webhooks/*` are routed to the worker first (`run_worker_first`).
- Without PayPal secrets the worker runs in offline (fixture) mode with honest provenance labels. To flip it to real sandbox money:
  ```bash
  npx wrangler secret put PAYPAL_CLIENT_ID
  npx wrangler secret put PAYPAL_CLIENT_SECRET
  npx wrangler secret put PAYPAL_WEBHOOK_ID
  ```
- Demo build note: the API-key gate exists but ships with the demo default key so judges can run the UI; rotate `PROMISEPAY_API_KEY` for any real deployment.

## Go-live checklist (flip the deployed demo to real sandbox money)

1. `npx wrangler secret put PAYPAL_CLIENT_ID` — then `PAYPAL_CLIENT_SECRET`, then `PAYPAL_WEBHOOK_ID` (from developer.paypal.com → Apps & Credentials → Sandbox; webhook id appears after creating a webhook)
2. Create a webhook in the PayPal developer dashboard pointing to `https://promisepay.kiritokris.workers.dev/webhooks/paypal`, subscribed to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.DECLINED`
3. Redeploy (`npx wrangler deploy`) — `/api/mode` now reports `paypalMode: sandbox`
4. Run `npm run verify:sandbox` locally with the same keys to prove the loop before judging
5. Record the demo video with [`video/SCRIPT.md`](./video/SCRIPT.md); paste the YouTube URL into [`SUBMISSION.md`](./SUBMISSION.md) and submit on Devpost

## Run it against the real sandbox

```bash
cp .env.example .env   # fill PAYPAL_CLIENT_ID / SECRET from developer.paypal.com, set PROMISEPAY_MODE=sandbox
npm run verify:sandbox
```

The harness walks a **real** sandbox dollar end to end: creates a $25 order (Orders v2) → prints the buyer approval link (approve as the sandbox personal account) → captures → creates a guarantee from promise prose → ingests a carrier exception → evaluates → executes the remedy → re-reads the capture from the sandbox and shows the refund on it. Every step prints its provenance (`paypal-sandbox` + retrieval time).

Webhook events: `POST /webhooks/paypal` verifies signatures via `/v1/notifications/verify-webhook-signature` in sandbox mode. Decline simulation: `PayPal-Mock-Response: INSTRUMENT_DECLINED` (offline sentinel: capture id `OFFLINE-DECLINE`).

## The adversarial matrix (tests = red-team checklist)

| # | Attack | Behavior |
|---|--------|----------|
| T1 | No breach evidence at all | refused · `verdict_is_conclusive` persisted |
| T2 | Promise exceeds captured amount | refused · `remedy_within_captured_amount` |
| T3 | Corrupted capture reference | refused · status never becomes `refunded` |
| T4 | Unknown carrier status | INCONCLUSIVE ⇒ fail-closed |
| T5 | Stale promise version (concurrent edit) | refused · `stale_version` |
| T6 | Two racing executes | exactly one refund (CAS) |
| T7 | Genuine evidenced breach | refund executes · `refunded` |
| T8 | PayPal declines the refund | `refund_failed` + obligation on record, state stays open |

## Demo video

Shot list and narration: [`video/SCRIPT.md`](./video/SCRIPT.md).

## Honest scope statement (per rules: documented, no overclaims)

Fixture-level enforcement in offline mode; sandbox-real refunds in sandbox mode; carrier feeds are simulated events. We claim a working proof of concept of evidence-gated money movement — not production settlement finality, not dispute resolution.

## Layout

```
server/   express API + enforcement spine + PayPal layer + AI parser/verifier + tests
web/      zero-build demo UI (consumer badge + merchant console)
data/     JSON store + audit trail (gitignored)
```
