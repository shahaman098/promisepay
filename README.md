# PromisePay — self-executing service guarantees on PayPal

**Merchants sell promises ("2-day delivery or $5 back", "fixed in 48h or full refund", "best price or the difference"). The AI turns each promise into an executable SLA, verifies the breach against real evidence feeds, and the refund moves itself — or refuses, with every failed proof obligation persisted on the record.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com) (Nov 2026). PayPal is the execution spine: Orders v2 → capture → **Refund API**, driven by webhook/evidence events. AI is indispensable where a form cannot be: parsing arbitrary promise prose into SLAs and classifying ambiguous evidence (inconclusive ⇒ fail-closed, never pays on a guess).

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
npm test        # 17 tests: the adversarial matrix + parser eval corpus + API contract suite
```

## Deploy (Render, one click)

```bash
git push && render blueprint launch   # or: Render → New → Blueprint → pick the repo
```

`render.yaml` provisions the web service with `healthCheckPath: /api/mode`; fill `PROMISEPAY_MODE=sandbox` + PayPal keys in the dashboard. See `credits.md` in the hackathon workspace for the Render credit claim link ($50, code on the hackathon resources page).

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

## The 3-minute video storyboard

1. **0:00–0:25** — a merchant types a promise in prose: *"2-day delivery or $5 back."* The AI parses it into an SLA (show the JSON, parsed-by label).
2. **0:25–1:00** — the order happens; the carrier feed stalls past the window (show the event arriving).
3. **1:00–1:30** — evaluation: evidence checks tick red; **the refund lands in PayPal** (show the refund record + provenance + retrieval time).
4. **1:30–2:10** — the attacks: a crafted request tries to pay on no evidence, overpay, stale-version replay, double-execute — every refusal flashes with its persisted failed-obligation record.
5. **2:10–2:45** — the merchant console (AG Studio) and the buyer's trust badge; close on: *"A promise was made. The world failed it. The money moved itself."*

## Honest scope statement (per rules: documented, no overclaims)

Fixture-level enforcement in offline mode; sandbox-real refunds in sandbox mode; carrier feeds are simulated events. We claim a working proof of concept of evidence-gated money movement — not production settlement finality, not dispute resolution.

## Layout

```
server/   express API + enforcement spine + PayPal layer + AI parser/verifier + tests
web/      zero-build demo UI (consumer badge + merchant console)
data/     JSON store + audit trail (gitignored)
```
