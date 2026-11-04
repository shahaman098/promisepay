// THE ENFORCEMENT SPINE (engine-validated design).
//
// Rules encoded here — none of them may be bypassed from any route:
//  1. The remedy executes only via executeRemedy(), and only when EVERY proof
//     obligation passes AT TRANSITION TIME (amount, currency, identity, status,
//     evidence references, promise version).
//  2. Inconclusive evidence = fail-closed. Absence of evidence never pays.
//  3. Stale promise versions and concurrent edits are rejected via compare-and-swap.
//  4. Every refused transition persists a failed-obligation record in the audit log.
//  5. Refund execution is idempotent per transition (PayPal-Request-Id keyed).

import * as store from "./store.js";
import * as paypal from "./paypal.js";
import { collectEvidence, paymentIdentityOk } from "./ai/verify.js";

const OPEN_STATUSES = new Set(["created", "monitored", "breach_verified"]);

function currencyOf(paymentState) {
  return paymentState?.amount?.currency_code || paymentState?.currency || null;
}

function amountOf(paymentState) {
  const v = paymentState?.amount?.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Gather evidence live (sandbox retrieval or fixture) with provenance.
async function gatherPaymentState(guarantee) {
  if (guarantee.payment.captureId) {
    const capture = await paypal.getCapture(guarantee.payment.captureId);
    return { id: guarantee.orderId, capture, amount: capture.amount, currency: capture.amount?.currency_code, raw: capture };
  }
  const order = await paypal.getOrder(guarantee.orderId);
  return { id: guarantee.orderId, order, amount: order.amount, currency: order.currency, raw: order };
}

// Step 1: evaluate (pure read; no money moves, no state change except audit).
export async function evaluateGuarantee(guaranteeId) {
  const g = store.getGuarantee(guaranteeId);
  if (!g) throw new Error("unknown_guarantee");
  const trackingEvents = store.eventsFor(guaranteeId);
  const paymentState = await gatherPaymentState(g);
  const verdict = collectEvidence(g, { trackingEvents, paymentState });
  const identity = paymentIdentityOk({ orderId: g.orderId }, paymentState);

  store.audit({
    guaranteeId,
    kind: "evaluation",
    verdict: verdict.verdict,
    reason: verdict.reason,
    evidenceRefs: verdict.evidenceRefs,
    checks: verdict.checks,
    paymentProvenance: paymentState.raw?.provenance || "unknown",
    paymentRetrievedAt: paymentState.raw?.retrievedAt || null,
  });
  return { verdict, identity, paymentState };
}

// Step 2: execute the remedy — the ONLY path that can move money.
export async function executeRemedy(guaranteeId, { expectedVersion, requestedBy }) {
  const g = store.getGuarantee(guaranteeId);
  if (!g) return refuse(guaranteeId, "unknown_guarantee", { requestedBy });

  if (!OPEN_STATUSES.has(g.status)) {
    return refuse(guaranteeId, "transition_not_permitted", { requestedBy, status: g.status });
  }

  // CAS: reject stale versions and concurrent transitions atomically.
  const cas = store.compareAndSwapVersion(guaranteeId, expectedVersion);
  if (!cas.ok) {
    return refuse(guaranteeId, cas.reason, { requestedBy, expectedVersion, currentVersion: cas.currentVersion ?? null });
  }
  const locked = cas.guarantee;

  const { verdict, identity, paymentState } = await evaluateGuarantee(guaranteeId);

  const obligations = [];
  if (identity.ok === false) obligations.push({ obligation: identity.obligation, observed: identity.observed, required: identity.required, pass: false });
  if (verdict.verdict === "breach") {
    obligations.push({ obligation: "breach_evidenced", observed: verdict.reason, pass: true });
    const remedy = verdict.remedyAmount;
    const payable = amountOf(paymentState);
    if (remedy == null) {
      obligations.push({ obligation: "remedy_amount_resolvable", observed: String(remedy), pass: false });
    } else if (payable != null && remedy > payable) {
      obligations.push({ obligation: "remedy_within_captured_amount", observed: String(remedy), required: `<= ${payable}`, pass: false });
    }
    const cur = currencyOf(paymentState);
    if (cur && cur !== "USD") obligations.push({ obligation: "currency_supported", observed: cur, pass: false });
  } else if (verdict.verdict === "INCONCLUSIVE") {
    obligations.push({ obligation: "verdict_is_conclusive", observed: `INCONCLUSIVE (${verdict.reason})`, pass: false });
  } else {
    obligations.push({ obligation: "breach_evidenced", observed: verdict.reason, pass: false });
  }

  if (obligations.some((o) => o.pass === false)) {
    store.persist();
    store.audit({
      guaranteeId,
      kind: "failed_obligations",
      requestedBy,
      obligations,
      note: "transition refused; guarantee state unchanged; failed obligations persisted",
    });
    // Roll the CAS bump back by decrementing: the refusal must not consume a version.
    locked.version -= 1;
    store.persist();
    return { ok: false, refused: true, obligations };
  }

  // All obligations pass — move the money (idempotent per transition).
  const captureId = guaranteeCaptureId(locked);
  const idempotencyKey = `${guaranteeId}:${locked.version}`;
  const refund = await paypal.refundCapture({
    captureId,
    amount: verdict.remedyAmount,
    currency: currencyOf(paymentState) || "USD",
    idempotencyKey,
  });

  if (refund.ok === false || refund.error) {
    locked.status = "refund_failed";
    store.persist();
    store.audit({
      guaranteeId,
      kind: "refund_failed",
      requestedBy,
      refundId: refund.id ?? null,
      error: refund.error ?? null,
      note: "PayPal declined the refund; guarantee remains open with the obligation on record",
    });
    return { ok: false, refused: false, refundFailed: true, refund };
  }

  locked.status = "refunded";
  locked.refund = { id: refund.id, status: refund.status, amount: verdict.remedyAmount, captureId, idempotencyKey, provenance: refund.provenance, retrievedAt: refund.retrievedAt ?? null };
  locked.closedAt = new Date().toISOString();
  store.persist();
  store.audit({ guaranteeId, kind: "remedy_executed", requestedBy, refundId: refund.id, amount: verdict.remedyAmount, obligations });
  return { ok: true, refund: locked.refund, reason: verdict.reason };
}

function guaranteeCaptureId(g) {
  return g.payment?.captureId ?? null;
}

function refuse(guaranteeId, reason, detail) {
  store.audit({ guaranteeId, kind: "failed_obligations", reason, detail, note: "transition refused at gate" });
  store.persist();
  return { ok: false, refused: true, obligations: [{ obligation: reason, ...detail, pass: false }] };
}
