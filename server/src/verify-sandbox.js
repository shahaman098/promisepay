// Sandbox verification harness — proves the "meaningful PayPal integration"
// claim end to end with REAL sandbox money movement:
//   1. create a $25 sandbox order (Orders v2)
//   2. print the buyer approval link → approve it in the browser (one click,
//      logged in as the sandbox personal account)
//   3. capture the approved order
//   4. create a guarantee from promise prose, link it to the capture
//   5. ingest a carrier-exception event, evaluate, execute the remedy
//   6. re-read the capture from the sandbox and show the refund on it
//
// Run:  PROMISEPAY_MODE=sandbox npm run verify:sandbox
// Requires PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env (see .env.example).

import * as store from "./store.js";
import * as paypal from "./paypal.js";
import { parsePromise } from "./ai/parser.js";
import { evaluateGuarantee, executeRemedy } from "./enforce.js";

store.load();

const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
if (!id || !secret || (process.env.PROMISEPAY_MODE || "").toLowerCase() !== "sandbox") {
  console.error("✗ Set PROMISEPAY_MODE=sandbox and PAYPAL_CLIENT_ID/SECRET in .env first (see .env.example).");
  process.exit(1);
}

const pretty = (label, obj) => console.log(`\n=== ${label} ===\n${JSON.stringify(obj, null, 2).slice(0, 1200)}`);

// 1. Create the order
const order = await paypal.createOrder({ amount: "25.00", currency: "USD", reference: "promisepay-verify" });
pretty("1. order created (sandbox)", { id: order.id, status: order.status });
if (order.provenance === "fixture") {
  console.error("✗ paypal.js returned a fixture — PROMISEPAY_MODE is not 'sandbox'.");
  process.exit(1);
}

// 2. Approval link
const approveLink = order.links?.find((l) => l.rel === "approve")?.href;
console.log("\n=== 2. APPROVE THE ORDER ===");
console.log(`Open this link in a browser, log in as the SANDBOX PERSONAL account, and approve:\n  ${approveLink}`);
console.log("Waiting for approval (polling every 5s, up to 25 min)...");

let approved = null;
for (let i = 0; i < 300; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  try { approved = await paypal.getOrder(order.id); } catch (e) { process.stdout.write("!"); continue; } // tolerate transient sandbox errors
  if (approved.status === "APPROVED" || approved.status === "COMPLETED" || approved.status === "VOIDED") break;
  process.stdout.write(".");
}
if (!approved || approved.status !== "APPROVED") {
  console.error("\n✗ Order was not approved in time; nothing was charged.");
  process.exit(1);
}
pretty("order approved", { id: approved.id, status: approved.status, provenance: approved.provenance });

// 3. Capture
const capture = await paypal.captureOrder(order.id);
const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id;
const captureAmount = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
if (!captureId) {
  console.error("✗ capture returned no capture id:", JSON.stringify(capture).slice(0, 500));
  process.exit(1);
}
pretty("3. capture completed", { captureId, amount: captureAmount, status: capture.status, provenance: capture.provenance });

// 4. Guarantee from promise prose, linked to the real capture
const promiseText = "2-day delivery or $5 back";
const parsed = await parsePromise(promiseText);
if (parsed.refusal) {
  console.error(`✗ parser refused: ${parsed.refusal.reason}`);
  process.exit(1);
}
const gid = store.nextGuaranteeId();
store.putGuarantee({
  id: gid, version: 1, status: "monitored", promiseText, sla: parsed.sla, aiSource: parsed.source,
  orderId: order.id, payment: { captureId }, createdAt: new Date().toISOString(),
});
console.log(`\n=== 4. guarantee ${gid} created (parsed by ${parsed.source}) ===`);
console.log(JSON.stringify(parsed.sla, null, 2));

// 5. Evidence + evaluate + execute
store.addEvent({ guaranteeId: gid, eventId: "vs_e1", type: "tracking.exception", at: new Date().toISOString(), detail: "sandbox harness: package lost in transit (simulated carrier event)" });
const evaluation = await evaluateGuarantee(gid);
pretty("5a. evaluation", { verdict: evaluation.verdict.verdict, reason: evaluation.verdict.reason, checks: evaluation.verdict.checks, paymentProvenance: evaluation.paymentState.raw?.provenance });
const execution = await executeRemedy(gid, { expectedVersion: 1, requestedBy: "verify-sandbox" });
pretty("5b. remedy execution", execution);

// 6. Show the refund on the live capture
const after = await paypal.getCapture(captureId);
const refundedAmount = after.amount?.value;
pretty("6. capture re-read from sandbox after remedy", { captureId, status: after.status, amount: after.amount, refunds_recorded: execution.refund?.id });

const ok = execution.ok === true && execution.refund?.status === "COMPLETED";
console.log(`\n${ok ? "✓ SANDBOX VERIFICATION PASSED" : "✗ SANDBOX VERIFICATION FAILED"} — real sandbox refund ${execution.refund?.id ?? "n/a"}`);
process.exit(ok ? 0 : 1);
