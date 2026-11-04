# PromisePay — demo video script (target: 2:15, hard cap 3:00)

**How to record (10 min total):** QuickTime Player → File → New Screen Recording → record the whole screen. Open `https://promisepay.kiritokris.workers.dev` in a full-width browser window. Read the narration (or generate an AI voiceover from it — organizers explicitly allow AI voiceover). Then trim with QuickTime/ffmpeg. Upload to YouTube as public, unlisted-after-judging is NOT allowed — keep it **public**.

**Before recording, seed fresh state (30s):** restart is unnecessary — the app is live. Just have the buyer tab open on the hero view.

---

## Shot list + narration

### Scene 1 — The promise (0:00–0:20) — Buyer tab
**On screen:** hero card: *"2-day delivery or $5 back."*
**Say:** "Merchants sell promises. But who enforces them? Meet PromisePay — self-executing service guarantees, built on PayPal."
**Action:** none. Let the hero card breathe.

### Scene 2 — Check an enforced promise (0:20–0:45) — Buyer tab
**Action:** click **Check** (g_0001 prefilled — shows the refunded receipt).
**Say:** "This order had a two-day delivery promise. The carrier feed says it was breached. Nobody filed anything — the refund already moved. Here's the receipt: five dollars, refund id, provenance."
**Point at:** status badge `refunded`, the Refunded line, the evidence timeline.

### Scene 3 — Promises are sold in prose (0:45–1:10) — Merchant tab
**Action:** in "Sell a promise", type `No refunds on sale items` → click **Parse preview**.
**Say:** "The merchant writes the promise in plain prose. Watch the AI refuse the ones it cannot execute — a promise that negates itself never becomes a guarantee."
**Point at:** the REFUSED JSON (`negated_promise`).

### Scene 4 — From prose to executable SLA (1:10–1:30)
**Action:** replace text with `2-day delivery or $5 back` → **Parse preview** → **Create guarantee**.
**Say:** "An executable promise becomes a structured SLA — window, evidence source, remedy — and a live guarantee with a version number."
**Point at:** the SLA JSON (`delivery_by`, `withinDays: 2`, `fixed_amount: 5`), then the new row in Guarantees.

### Scene 5 — Evidence, verdict, refund (1:30–1:55)
**Action:** click **＋ carrier exception** on the new guarantee → **Evaluate** → **Execute remedy**.
**Say:** "Evidence arrives from the carrier feed. The verifier weighs it: breach. The remedy executes through PayPal's Refund API — five dollars move, with an idempotency key."
**Point at:** the verdict JSON (`breach`), then `ok: true` with the refund id and `provenance`.

### Scene 6 — The refusal on the record (1:55–2:10)
**Action:** click **Execute remedy** again → refusal. Then open the **Enforcement record** tab.
**Say:** "And when anything tries to move money that shouldn't move — a replay, a double payout — it is refused, and the refusal is persisted. That's the audit trail."
**Point at:** the `transition_not_permitted` refusal, then the enforcement record rows.

### Scene 7 — Close (2:10–2:15)
**On screen:** buyer receipt.
**Say:** "PromisePay. A promise was made. The world failed it. The money moved itself."

---

## Notes
- Judges aren't required to run the project; this video is the submission's spine. Do two takes.
- Upload **early** — YouTube processing can take hours.
- If you set PayPal sandbox keys before recording, redo Scene 2 after `npm run verify:sandbox` and say "this is a real PayPal sandbox refund" — that one line is worth a lot.
