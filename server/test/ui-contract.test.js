// API contract tests: the routes the UI and the sandbox harness rely on,
// exercised through the real express app (no network).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.PROMISEPAY_MODE = "offline";
process.env.PROMISEPAY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pp-api-"));

const { buildApp } = await import("../src/app.js");
const store = await import("../src/store.js");
store.load();

const app = buildApp();
const KEY = "dev-key-change-me";
const H = { "x-api-key": KEY, "content-type": "application/json" };

// Drive the real express app over an ephemeral port.
import http from "node:http";
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, body) => {
  const res = await fetch(base + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test("health: /api/mode reports offline + fallback parser", async () => {
  const { status, body } = await call("GET", "/api/mode");
  assert.equal(status, 200);
  assert.equal(body.paypalMode, "offline");
  assert.equal(body.ai, "fallback-parser");
});

test("auth: routes reject a bad api key", async () => {
  const res = await fetch(base + "/api/guarantees", { headers: { "x-api-key": "wrong" } });
  assert.equal(res.status, 401);
});

test("parse preview: refusal shape for negated promise", async () => {
  const { status, body } = await call("POST", "/api/parse-preview", { promiseText: "No refunds on sale items" });
  assert.equal(status, 200);
  assert.equal(body.refusal?.refusal ?? body.refusal, "negated_promise");
});

test("create: 422 on unparseable promise, 200 + guarantee on executable prose", async () => {
  const bad = await call("POST", "/api/promises", { promiseText: "No refunds on sale items", orderId: "O-1" });
  assert.equal(bad.status, 422);
  const good = await call("POST", "/api/promises", { promiseText: "2-day delivery or $5 back", orderId: "OFFLINE-ORDER-X", captureId: "OFFLINE-CAPTURE-X" });
  assert.equal(good.status, 200);
  assert.equal(good.body.sla.kind, "delivery_by");
  assert.ok(good.body.id.startsWith("g_"));
});

test("list + evaluate + audit surface work end to end", async () => {
  const created = await call("POST", "/api/promises", { promiseText: "2-day delivery or $5 back", orderId: "OFFLINE-ORDER-Y", captureId: "OFFLINE-CAPTURE-Y" });
  const id = created.body.id;
  await call("POST", "/api/events", { guaranteeId: id, eventId: "ct_e1", type: "tracking.stalled", detail: "held" });
  const list = await call("GET", "/api/guarantees");
  assert.ok(list.body.some((g) => g.id === id));
  const ev = await call("GET", `/api/guarantees/${id}/evaluate`);
  assert.equal(ev.body.verdict.verdict, "breach");
  const ex = await call("POST", `/api/guarantees/${id}/execute-remedy`, { expectedVersion: 1, requestedBy: "contract-test" });
  assert.equal(ex.body.ok, true);
  const audit = await call("GET", "/api/audit");
  assert.ok(audit.body.some((a) => a.kind === "remedy_executed" && a.guaranteeId === id));
});

test("webhook endpoint: rejects unsigned payload in offline mode", async () => {
  const res = await fetch(base + "/webhooks/paypal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED" }) });
  assert.equal(res.status, 400);
});

import { after } from "node:test";
after(() => server.close());
