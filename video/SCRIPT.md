# PromisePay — demo video script (target 2:50, hard cap 3:00 — PayPal hackathon rule: under 3 minutes)

Formula: **Problem → Working product → Technical proof → Measured evidence → Memorable close.**
Record in your own voice (safest for the rules). 1080p, 30 fps, captions on, no keys/passwords on screen. Public YouTube, no copyrighted music, no third-party logos.

**Setup (5 min):** open `https://promisepay.kiritokris.workers.dev` full-width. Open a second window with a terminal in `promisepay/server` (font size large) and a third tab with the architecture diagram (README "Layout" or a one-slide sketch: Prose → LLM parser → SLA validator → evidence feed → enforcement spine → PayPal Orders/Refund API → audit record). Click **Reset demo data** first so the state is clean. Confirm the header chip shows the model name (`llama-3.3-70b-instruct-fp8-fast`) — judges must see the AI is live.

---

## 0:00–0:10 — Hook
**On screen:** buyer receipt for g_0001: status `refunded`, $5 refund id.
**Say:** "Nobody filed a claim. The package was late, and this refund already moved through PayPal."

## 0:10–0:25 — Problem + solution
**On screen:** buyer hero card *"2-day delivery or $5 back."*
**Say:** "Store guarantees are marketing copy; nothing enforces them. PromisePay turns a merchant's written promise into a contract that executes itself: AI reads it, evidence checks it, PayPal pays it."

## 0:25–2:00 — Working demo (Merchant tab)
1. **(0:25–0:50) Prose in, refusal out.** Type `All sales final, no refunds` → **Parse preview**. Point at the model name and the REFUSED JSON. *"The model reads plain prose. A promise it can't execute is refused, so nothing ever moves money on a guess."*
2. **(0:50–1:10) Prose → executable SLA.** Type `2-day delivery or $5 back` → **Parse preview** → **Create guarantee**. Point at `delivery_by · withinDays 2 · fixed_amount 5` and "parsed by llama-3.3-70b". *"Window, evidence source, remedy — structured, versioned, live."*
3. **(1:10–1:35) Evidence → verdict.** Click **＋ exception** (carrier exception) → **Evaluate**. Point at verdict `breach`. *"The carrier feed reports a failure. The verifier returns breach, no-breach, or inconclusive — and inconclusive never pays."*
4. **(1:35–2:00) Refund.** **Execute remedy**. Point at refund id + `provenance`. *"The refund goes through PayPal's Refund API with an idempotency key. The provenance label says exactly where this data came from."* (If sandbox keys are set, say: "this is a real PayPal sandbox refund." If not, say: "offline fixture mode, labeled as such.")

## 2:00–2:30 — Engineering
**On screen:** architecture diagram, then Record tab.
**Say:** "One technical decision matters most: the model decides *what was promised*; code decides *whether money moves*. Every model output is validated and the evidence feed is pinned by code. Money moves through one server endpoint that re-checks amount, currency, transaction identity, evidence and promise version at transition time, inside a single Cloudflare Durable Object so racing requests can't double-refund."
**Action:** click **Execute remedy** again → refusal; open **Record** tab, point at persisted refusals.

## 2:30–2:50 — Evidence (real numbers only)
**On screen:** terminal running `npm test`.
**Say:** "Twenty tests pass, including an eight-attack matrix: no evidence, overpaying, forged transaction identity, unknown carrier status, stale version, double-execute, PayPal decline. Each is refused with a persisted failed-obligation record; only the genuinely evidenced breach pays."
(Do not quote accuracy/latency figures you haven't measured.)

## 2:50–3:00 — Close
**On screen:** live URL + GitHub URL (`github.com/shahaman098/promisepay`).
**Say:** "A promise was made. The world failed it. The money moved itself. PromisePay — live now."

---

## Checklist before upload
- [ ] Model name visible on screen at least once; PayPal Refund API + provenance visible
- [ ] Under 3:00, captions checked, nothing sensitive visible
- [ ] Public YouTube link plays logged-out; paste into SUBMISSION.md and Devpost
- [ ] Upload early — YouTube processing can take a while
