# PromisePay — self-executing service guarantees on PayPal

**Merchants sell promises ("2-day delivery or $5 back", "fixed in 48h or full refund", "best price or the difference"). The AI turns each promise into an executable SLA, verifies the breach against real evidence feeds, and the refund moves itself — or refuses, with every failed proof obligation persisted on the record.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com) (Nov 2026). PayPal is the execution spine: Orders v2 → capture → **Refund API**, driven by webhook/evidence events. AI (Llama 3.3 70B on Cloudflare Workers AI, live in the deployed demo) is indispensable where a form cannot be: parsing arbitrary promise prose into SLAs and classifying ambiguous evidence (inconclusive ⇒ fail-closed, never pays on a guess).

## Design invariants (what makes this hard to fake)

1. **Server-side, fail-closed enforcement.** Money moves only via `POST /api/guarantees/:id/execute-remedy`, which re-checks every proof obligation *at transition time*: amount, currency, transaction identity, evidence references, promise version.
2. **Absence of evidence never pays.** Unknown/inconclusive status ⇒ refused with a persisted `failed_obligations` audit record.
3. **Optimistic concurrency.** Stale promise versions and racing executes are rejected (compare-and-swap); exactly one refund lands.
4. **Provenance discipline.** Every payment record carries its provenance (`paypal-sandbox` + retrieval time, or `fixture`) — we never claim sandbox data where there is none.
5. **Idempotent refunds.** PayPal-Request-Id keyed per transition.

## Run it (offline mode — no PayPal account needed)

```bash
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
5. Record the demo video with [`video/SCRIPT.md`](./video/SCRIPT.md); paste the YouTube URL into [`SUBMISSION.md`](./SUBMISSION.md) and submit on Devpost (early check: Nov 5; deadline: Nov 12, 8pm GMT)

## Run it against the real sandbox

```bash
cp .env.example .env   # fill PAYPAL_CLIENT_ID / SECRET from developer.paypal.com
npm run verify:sandbox
```

The harness walks a **real** sandbox dollar end to end: creates a $25 order (Orders v2) → prints the buyer approval link (approve as the sandbox personal account) → captures → creates a guarantee from promise prose → ingests a carrier exception → evaluates → executes the remedy → re-reads the capture from the sandbox and shows the refund on it. Every step prints its provenance (`paypal-sandbox` + retrieval time).

Webhook events: `POST /webhooks/paypal` verifies signatures via `/v1/notifications/verify-webhook-signature` in sandbox mode. Decline simulation: `PayPal-Mock-Response: INSTRUMENT_DECLINED` (offline sentinel: capture id `OFFLINE-DECLINE`).

## The adversarial matrix (tests = red-team checklist)

| # | Attack | Behavior |
|---|--------|----------|
| T1 | No breach evidence at all | refused · `verdict_is_conclusive` persisted |
| T2 | Promise exceeds captured amount | refused · `remedy_within_captured_amount` |
| T3 | Corrupted transaction identity | refused · status never becomes `refunded` |
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
