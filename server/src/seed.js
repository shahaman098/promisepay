// Seed the demo: two guarantees that tell the whole story in <3 minutes.
//  g_0001: delivery promise breached → refund executes (the hero path)
//  g_0002: resolution promise, inconclusive evidence → refused (fail-closed)
// Run: npm run seed   (safe to re-run; wipes data/)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";
import { parsePromise } from "./ai/parser.js";

const dataDir = process.env.PROMISEPAY_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
fs.rmSync(dataDir, { recursive: true, force: true });
store.load();

const now = Date.now();

// Hero guarantee: "2-day delivery or $5 back" — delivered late, carrier exception.
const hero = await parsePromise("2-day delivery or $5 back");
store.nextGuaranteeId();
const g1 = {
  id: "g_0001",
  version: 1,
  status: "monitored",
  promiseText: "2-day delivery or $5 back",
  sla: hero.sla,
  aiSource: hero.source,
  orderId: "OFFLINE-ORDER-1",
  payment: { captureId: "OFFLINE-CAPTURE-1" },
  createdAt: new Date(now - 4 * 86_400_000).toISOString(), // ordered 4 days ago
};
store.putGuarantee(g1);
store.addEvent({ guaranteeId: "g_0001", type: "tracking.stalled", at: new Date(now - 1 * 86_400_000).toISOString(), detail: "package held at regional facility beyond promised window", eventId: "e_1" });

// Fail-closed guarantee: "fixed in 48h or full refund" — no resolution evidence yet.
const g2p = await parsePromise("fixed within 48 hours or full refund");
store.nextGuaranteeId();
const g2 = {
  id: "g_0002",
  version: 1,
  status: "monitored",
  promiseText: "fixed within 48 hours or full refund",
  sla: g2p.sla,
  aiSource: g2p.source,
  orderId: "OFFLINE-ORDER-2",
  payment: { captureId: "OFFLINE-CAPTURE-2" },
  createdAt: new Date(now - 10 * 3_600_000).toISOString(), // opened 10h ago
};
store.putGuarantee(g2);

console.log("Seeded g_0001 (breach → refund) and g_0002 (inconclusive → fail-closed).");
console.log("Start the server: npm start  — then GET /api/guarantees/g_0001");
