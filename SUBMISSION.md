# Devpost submission text (https://paypalaihackathon.devpost.com/)

## Project title
PromisePay

## Short elevator pitch
When a shop says "deliver in two days or money back," PromisePay makes that promise real: it checks the facts and moves the PayPal refund itself.

## Full description (for Devpost "About the project")

See the live form; this is the source copy. No em dashes; written for judges who may not read code.

### Inspiration
Every small shop writes the same promise on its website: fast delivery, easy returns, money back if we miss the date. Buyers still do not trust it, because the words are not connected to anything. When something goes wrong, the customer has to complain, the merchant has to argue, and PayPal gets pulled into a dispute everyone could have avoided.

We built PromisePay so a promise is not just marketing. It is a simple contract the computer can actually run.

### What it does
Picture Maya, who runs a small online store. She types: **"Two day delivery or five dollars back."**

PromisePay does five clear steps:

1. **Understand the promise.** AI reads her sentence and turns it into exact rules: the deadline, what counts as proof, and how much to pay if she breaks the promise. If the sentence is too vague to run safely, PromisePay refuses to create the guarantee. No refund logic runs on a guess.
2. **Watch what happens in the real world.** Delivery updates and PayPal payment events show up on a timeline, like a case file.
3. **Decide fairly.** The system labels the case: breach, no breach, or **not enough information**. If there is not enough information, no money moves. That is on purpose.
4. **Pay through PayPal when the proof is there.** Only then does PromisePay call PayPal's Refund API, with checks so the amount, the payment, and the promise version all still match.
5. **Keep a record everyone can inspect.** Every "yes" and every "no" is saved. A buyer can see why a refund happened. A merchant can see why a risky refund was blocked.

### How we built it
- **PayPal:** sandbox checkout, capture, Refund API, verified webhooks.
- **AI:** Llama 3.3 70B on Cloudflare Workers AI for reading messy promises; deterministic fallback and rule based breach checks for safety.
- **Cloudflare Workers + Durable Objects** for one Durable Object that serializes every request, so racing refunds cannot double-pay.

### Measured results (12 Nov 2026)
- Parser eval: 23/24 on labelled promises; 11/11 unsafe promises refused; zero false guarantees.
- Live demo median ~801 ms end to end (see `eval/results.json`).
- Sandbox: $25 order, $5 refund on deployed worker with `paypal-sandbox` provenance.

### Links
- Live demo: https://promisepay.kiritokris.workers.dev
- Video: https://www.youtube.com/watch?v=Q96iujRDvLw
- GitHub: https://github.com/shahaman098/promisepay

## Additional info field answers

**Technology requirement:** PayPal Orders, capture, Refund API, webhooks; Llama 3.3 70B on Workers AI for promise parsing; code owns all money movement.

**Testing:** Open demo URL, click Reset demo data, run Merchant tab flow. No keys required.

**AI tools leveraged:** Llama 3.3 70B on Workers AI; Cursor/Claude for development; ElevenLabs for demo voiceover only.

**Project status:** New project built for this hackathon.

## Checklist
- [x] Public repo (MIT)
- [x] Hosted demo
- [x] Public YouTube video (2:37)
- [x] Devpost submitted (https://devpost.com/software/simpli)
