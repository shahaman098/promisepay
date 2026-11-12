# Devpost submission text — paste into https://paypalaihackathon.devpost.com/

## Project title
PromisePay — self-executing service guarantees on PayPal

## Short elevator pitch (one-liner fields)
Merchants sell promises ("2-day delivery or $5 back"). PromisePay's AI turns each promise into an executable SLA, verifies breaches against real evidence feeds, and moves the refund itself through PayPal — or refuses, with every failed proof obligation persisted on the record.

## Full description

> **8/8 attack vectors refused, 0 false refunds.** No evidence, overpay, forged transaction ID, unknown carrier status, stale promise version, double-execute, PayPal decline: each one is refused server-side with a persisted failed-obligation record. Only the genuinely evidenced breach moves money through the PayPal Refund API.

**The problem:** Small merchants lose money and trust in two directions at once. Buyers hesitate to purchase from stores they don't trust; merchants eat chargebacks, disputes, and manual refund choreography when things go wrong. "Guarantees" today are marketing copy — nothing enforces them.

**The build:** PromisePay turns a merchant's promise, written in plain prose, into an executable contract:

1. **Parse.** The AI promise parser (Llama 3.3 70B on Cloudflare Workers AI) converts arbitrary prose into a strict JSON SLA (window, evidence source, remedy). Prose it cannot execute — negated promises, discretionary remedies, missing timeframes — is **refused at creation** (HTTP 422). An unexecutable promise never moves money.
2. **Monitor.** Evidence events (carrier/status/price feeds, PayPal webhooks) flow into the guarantee's evidence timeline.
3. **Verify.** The evidence classifier returns breach / no-breach / **INCONCLUSIVE**. Inconclusive is fail-closed: absence of evidence never pays.
4. **Enforce.** The remedy executes through PayPal's Refund API — but only via one server-side endpoint that re-checks every proof obligation at transition time: amount ≤ captured, currency, transaction identity, evidence references, and promise version (optimistic concurrency). Stale versions and racing executes are rejected; exactly one refund lands.
5. **Prove.** Every refused transition persists a failed-obligation record. The **Enforcement record** view shows the audit trail — including the demo where the API refuses the very replay the UI just made.

**PayPal's role is the spine, not a garnish:** Orders v2 → capture → **Refund API** execution, sandbox-authenticated with per-call provenance (retrieval time + endpoint shown in the UI), webhook events recorded as evidence after signature verification, idempotent refunds keyed via PayPal-Request-Id. A one-command harness (`npm run verify:sandbox`) walks a real $25 sandbox order through the entire loop: create → approve → capture → guarantee → breach → refund.

**AI's role is indispensable, not decorative:** the product's input is unstructured prose (a structured form cannot read it), and its verification judgment handles ambiguity — where it refuses rather than guesses.

**Why it matters:** enforced promises convert. A store that displays "this promise is enforced by an AI escrow — verified, paid automatically" is making a verifiable claim, not an advertisement. Merchants get disputes that never happen; buyers get trust they can inspect.

**Honest scope:** this is a proof of concept on PayPal's sandbox with simulated carrier feeds (clearly labeled `fixture` vs `paypal-sandbox` provenance in the UI). We claim evidence-gated money movement that works end to end — not production settlement finality.

## Built With (check all that apply)
- paypal
- paypal-orders-api / paypal-refunds-api / paypal-webhooks
- cloudflare-workers-ai (Llama 3.3 70B)
- cloudflare-workers / durable-objects
- javascript / node.js

## Tools used (submission form: "which model or AI service and how")
- **LLM promise parser (live in the deployed demo):** Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) on Cloudflare Workers AI converts merchant prose → strict JSON SLA, or refuses (negated, discretionary, vague remedies). The model decides *what* was promised; code pins *which* evidence feed checks it, and validates every field before a guarantee exists. Each guarantee records the model that parsed it, and `/api/mode` reports it live. Any OpenAI-compatible endpoint also works via `OPENAI_API_KEY`.
- **Deterministic fallback parser:** the safety net if the model is unreachable or returns invalid output; converts the three canonical promise families and refuses the rest (negation, discretion, missing schedule/remedy). Covered by a held-out evaluation corpus in the test suite.
- **Rule-based evidence classifier:** weighs carrier/payment evidence into breach / no-breach / INCONCLUSIVE (fail-closed), with identity and amount sanity checks.

## Links
- Live demo: https://promisepay.kiritokris.workers.dev
- Video: <paste YouTube URL after upload>
- GitHub: https://github.com/shahaman098/promisepay

## Submission checklist (Devpost Stage One)
- [x] Public repo with MIT license visible in About
- [x] Hosted demo URL (judges can run it; run instructions also in README)
- [x] Tools list above
- [ ] Demo video <3 min, public YouTube ← record with video/SCRIPT.md
- [x] Text description (this file)
- [ ] Submit before the final deadline: Nov 12, 8pm GMT (the Nov 5 early check has passed)
