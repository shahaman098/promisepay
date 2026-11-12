// Evidence classifier: given a guarantee's SLA and the collected evidence
// (carrier events, PayPal payment state), decide breach / no_breach / INCONCLUSIVE.
// INCONCLUSIVE is fail-closed: no refund, obligation logged for a human.
//
// This mirrors the engine's red-team demand: the classifier must handle omitted
// claims, unknown statuses, and ambiguity without ever paying on a guess.

// Resolve the payable remedy amount for an SLA. Full refunds resolve to the
// captured amount (previously they resolved to null and could never execute).
function payableOf(paymentState) {
  const n = Number(paymentState?.amount?.value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function remedyAmountFor(sla, paymentState, delta = null) {
  switch (sla.remedy?.type) {
    case "fixed_amount": return sla.remedy.amount;
    case "full_refund": return payableOf(paymentState);
    case "difference": return delta;
    default: return null;
  }
}

export function collectEvidence(guarantee, { trackingEvents, paymentState }) {
  const sla = guarantee.sla;
  const result = {
    evidenceRefs: [],
    checks: [],
    verdict: "INCONCLUSIVE",
    reason: null,
    remedyAmount: null,
  };

  const delivered = (trackingEvents || []).find((e) => e.type === "tracking.delivered");
  const stalled = (trackingEvents || []).find((e) => e.type === "tracking.exception" || e.type === "tracking.stalled");
  const resolved = (trackingEvents || []).find((e) => e.type === "status.resolved");

  if (sla.kind === "delivery_by") {
    if (delivered) {
      const promisedDays = sla.verification.withinDays;
      const orderedAt = new Date(guarantee.createdAt).getTime();
      const deliveredAt = new Date(delivered.at).getTime();
      const days = (deliveredAt - orderedAt) / 86_400_000;
      result.evidenceRefs.push(delivered.eventId);
      result.checks.push({ obligation: "delivered_within_window", observed: days.toFixed(2), required: promisedDays, pass: days <= promisedDays });
      if (days <= promisedDays) {
        result.verdict = "no_breach";
        result.reason = `delivered in ${days.toFixed(1)}d <= ${promisedDays}d`;
        return result;
      }
      result.verdict = "breach";
      result.reason = `delivered in ${days.toFixed(1)}d > ${promisedDays}d`;
      result.remedyAmount = remedyAmountFor(sla, paymentState);
      return result;
    }
    if (stalled) {
      result.evidenceRefs.push(stalled.eventId);
      result.checks.push({ obligation: "in_transit_or_better", observed: stalled.type, pass: false });
      result.verdict = "breach";
      result.reason = `carrier exception: ${stalled.detail || stalled.type}`;
      result.remedyAmount = remedyAmountFor(sla, paymentState);
      return result;
    }
    result.checks.push({ obligation: "any_tracking_evidence", observed: "none", pass: false });
    result.reason = "no carrier evidence available; refusing to pay on absence of evidence";
    return result; // INCONCLUSIVE, fail-closed
  }

  if (sla.kind === "resolution_within") {
    if (resolved) {
      result.evidenceRefs.push(resolved.eventId);
      const hours = (new Date(resolved.at).getTime() - new Date(guarantee.createdAt).getTime()) / 3_600_000;
      const required = sla.verification.withinHours;
      result.checks.push({ obligation: "resolved_within_window", observed: hours.toFixed(1), required, pass: hours <= required });
      result.verdict = hours <= required ? "no_breach" : "breach";
      result.reason = `resolved in ${hours.toFixed(1)}h vs ${required}h`;
      result.remedyAmount = remedyAmountFor(sla, paymentState);
      return result;
    }
    result.checks.push({ obligation: "any_resolution_evidence", observed: "none", pass: false });
    result.reason = "no resolution evidence; window still open or feed missing";
    return result; // INCONCLUSIVE until window elapses or evidence arrives
  }

  if (sla.kind === "price_match") {
    const observed = (trackingEvents || []).find((e) => e.type === "price.lower_elsewhere");
    if (observed) {
      result.evidenceRefs.push(observed.eventId);
      result.checks.push({ obligation: "lower_price_found", observed: observed.detail, pass: false });
      result.verdict = "breach";
      result.reason = "lower price found elsewhere";
      result.remedyAmount = remedyAmountFor(sla, paymentState, observed.amountDelta);
      return result;
    }
    result.checks.push({ obligation: "any_price_evidence", observed: "none", pass: false });
    result.reason = "no price evidence";
    return result;
  }

  result.reason = `unknown sla kind: ${sla.kind}`;
  return result;
}

// Sanity-check the payment state attached to the guarantee: identity must match.
// (Red-team: "wrong transaction identity" must fail the remedy, not refund it.)
export function paymentIdentityOk(guarantee, paymentState) {
  if (!paymentState) return { ok: false, obligation: "payment_state_present", observed: "missing" };
  if (paymentState.id !== guarantee.orderId) {
    return { ok: false, obligation: "payment_identity_match", observed: paymentState.id, required: guarantee.orderId };
  }
  return { ok: true };
}
