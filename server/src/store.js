// JSON-file store: guarantees, evidence events, and the audit trail.
// Everything state-changing goes through here so the audit log is complete
// and the adversarial test matrix can assert on persisted obligation records.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.PROMISEPAY_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

let state = { guarantees: {}, events: [], audit: [], sequences: { guarantee: 0 } };

export function getState() {
  return state;
}

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, "state.json");
  if (fs.existsSync(file)) {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } else {
    persist();
  }
  return state;
}

export function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "state.json"), JSON.stringify(state, null, 2));
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
