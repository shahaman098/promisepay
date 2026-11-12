// Regression tests for defects found in the project audit (12 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PROMISEPAY_MODE = "offline";
process.env.PROMISEPAY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pp-reg-"));

const store = await import("../src/store.js");
const { parsePromise, parseFallback } = await import("../src/ai/parser.js");
const { executeRemedy } = await import("../src/enforce.js");
store.load();

async function mk(promiseText, events, captureId = "OFFLINE-CAPTURE-R") {
  const parsed = await parsePromise(promiseText);
  const id = store.nextGuaranteeId();
  store.putGuarantee({ id, version: 1, status: "monitored", promiseText, sla: parsed.sla, aiSource: "fallback", orderId: "OFFLINE-ORDER-R", payment: { captureId }, createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString() });
  for (const e of events) store.addEvent({ guaranteeId: id, eventId: `r_${Math.random()}`, at: new Date().toISOString(), ...e });
  return id;
}

test("full_refund promises can actually execute (resolve to captured amount)", async () => {
  const id = await mk("Delivered on time or your money back", [{ type: "tracking.exception", detail: "lost" }]);
  const out = await executeRemedy(id, { expectedVersion: 1, requestedBy: "reg" });
  assert.equal(out.ok, true);
  assert.equal(out.refund.amount, 100); // offline fixture capture is $100.00
});

test("parser never invents a dollar amount", () => {
  const out = parseFallback("2-day delivery or we'll credit your account");
  assert.equal(out.refusal, "no_remedy_amount");
});

test("a second execute during an in-flight transition is refused, not paid twice", async () => {
  const id = await mk("2-day delivery or $5 back", [{ type: "tracking.exception", detail: "lost" }]);
  const first = executeRemedy(id, { expectedVersion: 1, requestedBy: "a" });
  // Racing caller that already saw the bumped version (2).
  const second = executeRemedy(id, { expectedVersion: 2, requestedBy: "b" });
  const [a, b] = await Promise.all([first, second]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
});
