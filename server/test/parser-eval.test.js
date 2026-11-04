// Parser evaluation harness — a held-out corpus of promise prose with
// expected outcomes. This is the red-team demand: "evaluate extraction on
// held-out notes containing promises, negation, ambiguity, and multiple
// remedies." The fallback parser must pass ALL of these deterministically;
// when an LLM key is configured, run `npm run eval:llm` to compare.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFallback } from "../src/ai/parser.js";

const CORPUS = [
  // [text, expectation]
  ["2-day delivery or $5 back", { kind: "delivery_by", remedyType: "fixed_amount", amount: 5 }],
  ["Delivery in 5 days or $10 back. That's a promise.", { kind: "delivery_by", remedyType: "fixed_amount", amount: 10 }],
  ["We ship within 48 hours or you get $3 back", { kind: "delivery_by", remedyType: "fixed_amount", amount: 3 }],
  ["Delivered on time or your money back", { kind: "delivery_by", remedyType: "full_refund" }],
  ["We will fix it within 24 hours or full refund", { kind: "resolution_within", withinHours: 24, remedyType: "full_refund" }],
  ["Repairs completed in 2 days or $25 back", { kind: "resolution_within", withinHours: 48, remedyType: "fixed_amount", amount: 25 }],
  ["Best price this week or the difference back", { kind: "price_match", remedyType: "difference" }],
  // Refusals — the fail-closed surface:
  ["No refunds on sale items", { refusal: "negated_promise" }],
  ["This product is non-refundable", { refusal: "negated_promise" }],
  ["We don't guarantee delivery times during holidays", { refusal: "negated_promise" }],
  ["Refunds at our discretion if something goes wrong", { refusal: "contingent_promise" }],
  ["We may compensate affected customers", { refusal: "contingent_promise" }],
  ["Great service, shop with us today", { refusal: null, noSla: true }], // no schedule, no remedy
  ["We fix things fast", { refusal: "no_remedy" }], // repair + remedy-word? "fix" family requires remedy word
  ["Delivery within 2 days for all orders", { refusal: "no_remedy" }], // schedule but no remedy
  ["hi", { refusal: "too_short" }],
];

test("parser fallback: held-out corpus", () => {
  for (const [text, expected] of CORPUS) {
    const out = parseFallback(text);
    if (expected.refusal === "negated_promise" || expected.refusal === "contingent_promise" || expected.refusal === "no_remedy" || expected.refusal === "too_short" || expected.refusal === "no_schedule") {
      assert.ok(out.refusal, `expected refusal for "${text}", got ${JSON.stringify(out)}`);
      assert.equal(out.refusal, expected.refusal, `wrong refusal tag for "${text}"`);
      continue;
    }
    if (expected.noSla) {
      assert.ok(out.refusal, `expected some refusal for "${text}" (no schedule, no remedy)`);
      continue;
    }
    assert.ok(!out.refusal, `expected SLA for "${text}", got refusal ${JSON.stringify(out)}`);
    assert.equal(out.kind, expected.kind, `wrong kind for "${text}"`);
    if (expected.remedyType) assert.equal(out.remedy.type, expected.remedyType, `wrong remedy for "${text}"`);
    if (expected.amount != null) assert.equal(out.remedy.amount, expected.amount, `wrong amount for "${text}"`);
    if (expected.withinHours != null) assert.equal(out.verification.withinHours, expected.withinHours, `wrong window for "${text}"`);
  }
});

test("parser: every refusal carries a human-readable reason", () => {
  for (const [text] of CORPUS) {
    const out = parseFallback(text);
    if (out.refusal) assert.ok(out.reason && out.reason.length > 10, `refusal for "${text}" lacks a reason`);
  }
});
