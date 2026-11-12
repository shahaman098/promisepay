# PromisePay — demo video script (target 2:50, hard cap 3:00 — PayPal hackathon rule: under 3 minutes)

**Rendered video:** `video/promisepay-demo.mp4` (2:40, 1080p, ElevenLabs voiceover). Its exact narration is in `video/promisepay-demo.srt` (upload it to YouTube as captions); the lines below are the recording guide.

Formula: **Problem → Working product → Technical proof → Measured evidence → Memorable close.**
Record in your own voice (safest for the rules). 1080p, 30 fps, captions on, no keys/passwords on screen. Public YouTube, no copyrighted music, no third-party logos.

**Setup (5 min):** open `https://promisepay.kiritokris.workers.dev` full-width. Open a second window with a terminal in `promisepay/server` (font size large) and a third tab on `https://promisepay.kiritokris.workers.dev/architecture.html` (the architecture diagram). In the terminal, have `cat eval/results.json | head -30` ready (or rerun `npm run eval:parser -- https://promisepay.kiritokris.workers.dev` after deploy). Click **Reset demo data** first so the state is clean. Confirm the header chip shows the model name (`llama-3.3-70b-instruct-fp8-fast`) — judges must see the AI is live.

---

## 0:00–0:10 — Hook
**On screen:** buyer receipt for g_0001: status `refunded`, $5 refund id.
**Say:** "Nobody filed a claim. The package was late, and this refund already moved through PayPal."

## 0:10–0:25 — Problem + solution
**On screen:** buyer hero card *"2-day delivery or $5 back."*
**Say:** "Store guarantees are marketing copy; nothing enforces them. PromisePay turns a merchant's written promise into a contract that executes itself: AI reads it, evidence checks it, PayPal pays it."

## 0:25–2:00 — Working demo (Merchant tab)
1. **(0:25–0:50) Prose in, refusal out.** Type `If your order arrives after Friday we'll credit you something nice` → **Parse preview**. Point at `source: llm`, the model name and the REFUSED JSON. *"The model reads plain prose. A promise it can't execute is refused, so nothing ever moves money on a guess."* (Optional engineering aside: obvious negations like "no refunds" are refused by deterministic guards before the model is even asked.)
2. **(0:50–1:10) Prose → executable SLA.** Type `2-day delivery or $5 back` → **Parse preview** → **Create guarantee**. Point at `delivery_by · withinDays 2 · fixed_amount 5` and "parsed by llama-3.3-70b". *"Window, evidence source, remedy — structured, versioned, live."*
3. **(1:10–1:35) Evidence → verdict.** Click **＋ exception** (carrier exception) → **Evaluate**. Point at verdict `breach`. *"The carrier feed reports a failure. The verifier returns breach, no-breach, or inconclusive — and inconclusive never pays."*
4. **(1:35–2:00) Refund.** **Execute remedy**. Point at refund id + `provenance`. *"The refund goes through PayPal's Refund API with an idempotency key. The provenance label says exactly where this data came from."* (Say exactly what the provenance label on screen says: the seeded demo uses labeled `fixture` records, not real sandbox money. Only claim a real sandbox refund if you ran `npm run verify:sandbox` and show its output.)

## 2:00–2:30 — Engineering
**On screen:** `/architecture.html`, then Record tab.
**Say:** "One technical decision matters most: the model decides *what was promised*; code decides *whether money moves*. Deterministic guards run before the model, and every model output is checked against the source text: a dollar amount must actually be written there, and the evidence feed is chosen by code. Money then passes one gate that re-checks evidence, amount, the capture's order and the promise version at the moment of the transition, inside a single Cloudflare Durable Object, so racing requests can't double-refund."
**Action:** click **Execute remedy** again → refusal; open **Record** tab, point at persisted refusals.

## 2:30–2:50 — Evidence (real numbers only)
**On screen:** terminal: `eval/results.json` summary, then `npm test` passing.
**Say:** "We measured the live parser on 24 labelled promises, one request at a time. It got 23 right. All 11 unsafe promises were refused, so zero false guarantees. The one miss was a refusal, not a wrong payout. Median response was under a second. And 20 tests pass, including an eight-attack matrix: no evidence, overpaying, a corrupted capture reference, unknown carrier status, stale version, double-execute, PayPal decline. Every attack is refused and recorded."
(These are the 12 Nov local measurements: 23/24, 11/11 refused, median 801 ms, LLM median 908 ms, Llama 3.3 70B via Workers AI. If you rerun against the live URL after deploy, say the new numbers instead.)

## 2:50–3:00 — Close
**On screen:** live URL + GitHub URL (`github.com/shahaman098/promisepay`).
**Say:** "A promise was made. The world failed it. The money moved itself. PromisePay — live now."

---

## Checklist before upload
- [ ] Value clear by 0:15, product working by 0:30
- [ ] Model name visible on screen at least once; PayPal Refund API + provenance visible
- [ ] Every number said aloud matches `eval/results.json` or the `npm test` output on screen
- [ ] Under 3:00, captions checked, nothing sensitive visible
- [ ] Public YouTube link plays logged-out; paste into SUBMISSION.md and Devpost
- [ ] Upload early — YouTube processing can take a while
