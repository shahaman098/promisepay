// JSON store: guarantees, evidence events, and the audit trail.
// Everything state-changing goes through here so the audit log is complete
// and the adversarial test matrix can assert on persisted obligation records.
//
// Two persistence backends:
//  - Node (default): JSON file at PROMISEPAY_DATA_DIR/state.json — used by the
//    express server, the sandbox harness, and the tests.
//  - Pluggable: setPersistFn(fn) + initState(s) + flush() let the Cloudflare
//    Worker bind persistence to Durable Object storage instead. All requests
//    serialize through the single DO, so in-memory state is consistent and
//    flush() awaits durability before a response is returned.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Node-only data dir. Computed lazily and guarded: in the Workers bundle
// import.meta.url is undefined, and the worker always uses the pluggable
// persistence path (Durable Object storage) instead of the filesystem.
function nodeDataDir() {
  try {
    const url = import.meta.url;
    if (!url || !url.startsWith("file:")) return null;
    return process.env.PROMISEPAY_DATA_DIR || path.join(path.dirname(fileURLToPath(url)), "..", "..", "data");
  } catch {
    return null;
  }
}

let state = { guarantees: {}, events: [], audit: [], sequences: { guarantee: 0 } };
let persistFn = null;
let pendingWrites = [];

export function getState() {
  return state;
}

export function setPersistFn(fn) {
  persistFn = fn;
}

export function initState(s) {
  if (s && typeof s === "object") state = s;
}

export function load() {
  const DATA_DIR = nodeDataDir();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = `${DATA_DIR}/state.json`;
  if (fs.existsSync(file)) {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } else {
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  }
  return state;
}

export function persist() {
  if (persistFn) {
    const p = Promise.resolve(persistFn(state)).catch(() => {});
    pendingWrites.push(p);
    return p;
  }
  const DATA_DIR = nodeDataDir();
  if (!DATA_DIR) return; // no filesystem in this runtime and no pluggable backend
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${DATA_DIR}/state.json`, JSON.stringify(state, null, 2));
}

export function flush() {
  const writes = pendingWrites;
  pendingWrites = [];
  return Promise.all(writes);
}

// ---- guarantees -------------------------------------------------------

export function nextGuaranteeId() {
  state.sequences.guarantee += 1;
  return `g_${String(state.sequences.guarantee).padStart(4, "0")}`;
}

export function putGuarantee(g) {
  state.guarantees[g.id] = g;
  persist();
}

export function getGuarantee(id) {
  return state.guarantees[id] || null;
}

// Optimistic-concurrency: any mutation must carry the version the caller saw.
export function compareAndSwapVersion(id, expectedVersion) {
  const g = state.guarantees[id];
  if (!g) return { ok: false, reason: "unknown_guarantee" };
  if (g.version !== expectedVersion) {
    return { ok: false, reason: "stale_version", currentVersion: g.version };
  }
  g.version += 1;
  return { ok: true, guarantee: g };
}

// ---- evidence events --------------------------------------------------

export function addEvent(evt) {
  const stamped = { ...evt, receivedAt: new Date().toISOString() };
  state.events.push(stamped);
  persist();
  return stamped;
}

export function eventsFor(guaranteeId, type) {
  return state.events.filter(
    (e) => e.guaranteeId === guaranteeId && (type ? e.type === type : true),
  );
}

// ---- audit ------------------------------------------------------------

export function audit(entry) {
  const stamped = { at: new Date().toISOString(), ...entry };
  state.audit.push(stamped);
  persist();
  return stamped;
}

export function auditFor(guaranteeId) {
  return state.audit.filter((a) => a.guaranteeId === guaranteeId);
}

export function allAudit() {
  return state.audit;
}
