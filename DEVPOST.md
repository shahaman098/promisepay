# PromisePay: store guarantees that refund themselves through PayPal

**Short pitch:** PromisePay helps small online merchants keep promises like "2-day delivery or $5 back" by turning the promise into a contract that checks the evidence and refunds through PayPal automatically, without a complaint or a dispute.

**Demo video:** https://www.youtube.com/watch?v=Q96iujRDvLw
**Live application:** https://promisepay.kiritokris.workers.dev (no login, no keys)
**GitHub:** https://github.com/shahaman098/promisepay
**Prize focus:** Best Use of PayPal + AI

## Inspiration

Maya runs a small candle shop online. Her promise, "2-day delivery or $5 back", wins buyers' trust, but nothing enforces it. When a parcel is late, the buyer has to notice and complain, Maya checks tracking and refunds by hand, and the cases she misses turn into PayPal disputes.

Refund tooling already exists, including PayPal's Refund API and dispute flows. What's missing is the link between **what the merchant promised**, **what actually happened** and **the money**. We wanted a merchant's own words to be enough to make a guarantee enforce itself, safely.

## What it does

PromisePay turns a written promise into a guarantee that executes itself:

1. **Read.** The merchant types the promise in plain English. Llama 3.3 70B on Cloudflare Workers AI turns it into a strict contract: deadline, evidence source and remedy. Prose it can't execute safely, such as "we'll credit you something nice", is refused, and no guarantee is created.
2. **Watch.** Carrier and status events attach to the guarantee as a timeline.
3. **Decide.** A rule-based verifier returns breach, no breach, or INCONCLUSIVE. Inconclusive never pays.
4. **Pay.** One server-side gate re-checks every condition at the moment of the transition, then calls PayPal's Refund API with an idempotency key.
5. **Record.** Every refund and every refusal is saved with the reason, so the buyer and the merchant can both see why.

**What makes it different:** the model decides **what was promised**; code decides **whether money moves**. Most AI-payment projects let a model trigger a payment. PromisePay treats model output as untrusted. Deterministic guards run before the model, every output is checked against the source text (a dollar amount must actually be written there), and the payout gate never consults the model.

## How we built it

- **Frontend:** zero-build HTML/JS in a PayPal-style theme, served as Workers Static Assets. It has a buyer receipt, a merchant console and an enforcement record.
- **Backend:** one route table that runs on a Cloudflare Worker with a single Durable Object in production and on Express locally, so tests and the live site share one code path.
- **AI:** Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) through the Workers AI binding at temperature 0. If the model's output fails validation, a strict deterministic parser decides, and it refuses anything without an explicit window and amount.
- **PayPal (sandbox):**
  - Orders v2, plus capture lookup to confirm the capture belongs to the order.
  - Refund API with `PayPal-Request-Id` idempotency.
  - Webhook signature verification.
  - Every record carries a provenance label: `paypal-sandbox` with its retrieval time, or `fixture` for demo data.
  - Code: `server/src/paypal.js` and `server/src/enforce.js`.

Our most important engineering decision was the **single Durable Object**. Every request passes through one instance, so the promise-version compare-and-swap and the `executing` lock are genuinely atomic. Two racing "execute" calls produce exactly one refund. The trade-off is throughput, which is fine at merchant scale.

## Validation and results

- **Real PayPal money movement:** a $25 sandbox order (`120684403P8280439`) was paid with PayPal's sandbox test card, and PromisePay refunded $5 through the Refund API on the live deployment. The refund (`8A9655367P504605D`) completed with provenance `paypal-sandbox`, and PayPal's refund webhook passed signature verification.
- **Parser accuracy:** 23/24 correct on labelled promises (13 executable, 11 unsafe). All 11 unsafe promises were refused, so zero false guarantees. The one miss was a refusal, not a wrong payout.
- **Latency:** median 801 ms overall, and 908 ms when the model answered (requests sent one at a time).
- **Tests:** 20/20 pass, including an 8-attack matrix: no evidence, overpaying, a corrupted capture reference, unknown carrier status, a stale version, a double execute, and a PayPal decline.

The main limitation is that carrier events are simulated in the demo. There is no live carrier integration yet.

## Challenges we ran into

The hardest problem was making sure **a model can never move money on a guess**. At first we sent the model's JSON straight through, and it sometimes promoted a "$5 back" to a full refund or invented a delivery window. We fixed this by:
- adding guards before the model;
- validating its output against the source text;
- pinning the evidence feed by contract type in code;
- falling back to a strict parser whenever validation fails.

The second challenge was **double refunds under retries**. We solved it with the version compare-and-swap, an execute lock, and idempotency keys unique to each guarantee, capture and transition.

## Accomplishments that we're proud of

- A real PayPal sandbox refund triggered automatically by evidence on a live deployment.
- A fail-closed design where every refusal is persisted with the exact check that failed.
- An honest demo: real sandbox data and simulated fixtures are always labelled differently.

## What we learned

Using AI well in payments means being specific about which part it controls. A language model is excellent at reading messy human promises and should never be the last word on moving money. We also learned that an idempotency key is only as good as its scope: keyed per guarantee alone, a legitimate later refund would have been silently blocked.

## What's next

1. Real carrier tracking webhooks as the evidence feed.
2. Merchant onboarding with per-merchant PayPal credentials and a buyer-facing "guaranteed" badge at checkout.
3. Retry and dispute hand-off for declined refunds, plus webhook de-duplication.

## Built with and credits

**Technologies:** PayPal Orders v2, PayPal Payments Refund API, PayPal Webhooks, Cloudflare Workers, Durable Objects, Workers AI, Llama 3.3 70B, Node.js, Express, JavaScript, HTML/CSS.

**Team:** Aman Kumar Sah: product, engineering and demo.

**AI assistance and assets:**
- Llama 3.3 70B parses promises at runtime.
- AI coding assistants were used during development.
- The video voiceover is ElevenLabs text-to-speech over a real screen recording of the live site.

## Why this fits Best Use of PayPal + AI

- **Technological implementation:** a real Refund API call, gated by verified evidence, on a live deployment; 20 tests, including the 8-attack matrix.
- **Design:** buyer receipt, merchant console and enforcement record, all live with no login.
- **Potential impact:** fewer disputes, no manual refunds, and guarantees a merchant can prove.
- **Innovation:** the merchant's own words become an executable, auditable PayPal refund.
- **Presentation:** a 2:37 video showing the full flow and a real sandbox refund.
