// Shared route table — one definition of the API, two runtimes:
//  - server/src/app.js binds it to express (local Node, tests, sandbox harness)
//  - worker/entry.js binds it to a Cloudflare Durable Object (deployed demo)
//
// Handler contract: ctx = { params, body, headers, rawBody } → { status, body }.

import * as store from "./store.js";
import * as paypal from "./paypal.js";
import { parsePromise } from "./ai/parser.js";
import { evaluateGuarantee, executeRemedy } from "./enforce.js";

// Header getter that works for both plain objects (express req.headers)
// and Workers Headers instances.
export function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()];
}

export function apiKeyOk(headers, env = process.env) {
  const key = getHeader(headers, "x-api-key");
  return key === (env.PROMISEPAY_API_KEY || "dev-key-change-me");
}

const ok = (body, status = 200) => ({ status, body });

export const routes = [
  // --- Merchant: create a guarantee from promise prose --------------------
  {
    method: "POST",
    path: "/api/promises",
    auth: true,
    handler: async (ctx) => {
      const { promiseText, orderId, captureId } = ctx.body || {};
      if (!promiseText || !orderId) return ok({ error: "promiseText and orderId required" }, 400);
      const parsed = await parsePromise(promiseText);
      // Fail-closed at parse time: prose we cannot turn into an executable,
      // evidence-checkable SLA never becomes a guarantee.
      if (parsed.refusal || !parsed.sla) {
        return ok({ refusal: parsed.refusal?.refusal ?? "unparseable", reason: parsed.refusal?.reason ?? "parser produced no SLA", source: parsed.source }, 422);
      }
      const id = store.nextGuaranteeId();
      const g = {
        id,
        version: 1,
        status: "monitored",
        promiseText,
        sla: parsed.sla,
        aiSource: parsed.source,
        orderId,
        payment: { captureId: captureId ?? null },
        createdAt: new Date().toISOString(),
      };
      store.putGuarantee(g);
      store.audit({ guaranteeId: id, kind: "created", aiSource: parsed.source, sla: parsed.sla });
      return ok(g);
    },
  },

  // --- Event ingestion (carrier feed / status feed) ------------------------
  {
    method: "POST",
    path: "/api/events",
    auth: true,
    handler: (ctx) => {
      const { guaranteeId, type, at, detail, amountDelta } = ctx.body || {};
      if (!guaranteeId || !type) return ok({ error: "guaranteeId and type required" }, 400);
      const evt = store.addEvent({ guaranteeId, type, at: at || new Date().toISOString(), detail, amountDelta, eventId: `e_${store.getState().events.length + 1}` });
      return ok(evt);
    },
  },

  // --- Evaluation (read-only) ---------------------------------------------
  {
    method: "GET",
    path: "/api/guarantees/:id/evaluate",
    auth: true,
    handler: async (ctx) => {
      const out = await evaluateGuarantee(ctx.params.id);
      return ok(out);
    },
  },

  // --- THE enforcement endpoint -------------------------------------------
  {
    method: "POST",
    path: "/api/guarantees/:id/execute-remedy",
    auth: true,
    handler: async (ctx) => {
      const { expectedVersion, requestedBy } = ctx.body || {};
      if (!Number.isInteger(expectedVersion)) return ok({ error: "expectedVersion required" }, 400);
      const out = await executeRemedy(ctx.params.id, { expectedVersion, requestedBy: requestedBy || "api" });
      return ok(out);
    },
  },

  // --- Reads ---------------------------------------------------------------
  {
    method: "GET",
    path: "/api/guarantees",
    auth: true,
    handler: () => ok(Object.values(store.getState().guarantees).map((g) => ({ ...g, auditCount: store.auditFor(g.id).length, eventCount: store.eventsFor(g.id).length }))),
  },

  {
    method: "GET",
    path: "/api/guarantees/:id",
    auth: true,
    handler: (ctx) => {
      const g = store.getGuarantee(ctx.params.id);
      if (!g) return ok({ error: "not_found" }, 404);
      return ok({ ...g, audit: store.auditFor(g.id), events: store.eventsFor(g.id) });
    },
  },

  // Parse preview: what WOULD the parser do with this prose? No state changes.
  {
    method: "POST",
    path: "/api/parse-preview",
    auth: true,
    handler: async (ctx) => {
      const { promiseText } = ctx.body || {};
      if (!promiseText) return ok({ error: "promiseText required" }, 400);
      return ok(await parsePromise(promiseText));
    },
  },

  {
    method: "GET",
    path: "/api/mode",
    auth: false,
    handler: (ctx) => ok({ paypalMode: paypal.mode(), ai: ctx.env?.OPENAI_API_KEY ? "llm" : "fallback-parser" }),
  },

  {
    method: "GET",
    path: "/api/audit",
    auth: true,
    handler: () => ok(store.allAudit()),
  },

  // --- Demo reset: curated dataset showing every behavior of the product ---
  // One of each promise family and one of each outcome, with authentic audit
  // trails (remedies execute through the real enforcement spine).
  {
    method: "POST",
    path: "/api/demo/seed",
    auth: true,
    handler: async () => {
      const fresh = { guarantees: {}, events: [], audit: [], sequences: { guarantee: 0 } };
      store.initState(fresh);
      await store.persist();
      store.audit({ kind: "demo_reset", note: "demo dataset reseeded" });

      const mk = async (text, orderId, captureId, events, daysAgo) => {
        const parsed = await parsePromise(text);
        if (parsed.refusal) return null;
        const id = store.nextGuaranteeId();
        const createdAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
        store.putGuarantee({ id, version: 1, status: "monitored", promiseText: text, sla: parsed.sla, aiSource: parsed.source, orderId, payment: { captureId }, createdAt });
        for (const e of events) {
          store.addEvent({ guaranteeId: id, eventId: `sd_${id}_${Math.random().toString(36).slice(2, 7)}`, at: new Date(Date.now() - e.daysAgo * 86_400_000).toISOString(), ...e });
        }
        return id;
      };
      const day = (n, extra = {}) => ({ daysAgo: n, ...extra });

      // 1. Hero: delivery breach → refunded (the receipt the buyer view opens on)
      const g1 = await mk("2-day delivery or $5 back", "OFFLINE-ORDER-1", "OFFLINE-CAPTURE-1", [
        day(3, { type: "tracking.stalled", detail: "held at regional facility beyond promised window" }),
        day(1, { type: "tracking.exception", detail: "package lost in transit" }),
      ], 4);
      // 2. Resolution promise, window still open
      await mk("Repairs completed within 48 hours or full refund", "OFFLINE-ORDER-2", "OFFLINE-CAPTURE-2", [
        day(1, { type: "status.opened", detail: "repair ticket opened, technician scheduled" }),
      ], 1.5);
      // 3. Price match with lower price observed (breach pending evaluation)
      await mk("Best price this week or the difference back", "OFFLINE-ORDER-3", "OFFLINE-CAPTURE-3", [
        day(2, { type: "price.lower_elsewhere", detail: "same SKU found at $12.50 less", amountDelta: 12.5 }),
      ], 3);
      // 4. Delivered late → refunded via the delivered-late path
      const g4 = await mk("Delivery in 5 days or $10 back", "OFFLINE-ORDER-4", "OFFLINE-CAPTURE-4", [
        day(2, { type: "tracking.delivered", detail: "delivered after the promised window" }),
      ], 8);
      // 5. Refund declined by PayPal → refund_failed with the obligation on record
      const g5 = await mk("2-day delivery or $5 back", "OFFLINE-ORDER-5", "OFFLINE-DECLINE", [
        day(2, { type: "tracking.exception", detail: "package lost in transit" }),
      ], 3);

      // Execute the remedies through the real spine (authentic audit records).
      const results = {};
      for (const id of [g1, g4, g5].filter(Boolean)) {
        results[id] = (await executeRemedy(id, { expectedVersion: 1, requestedBy: "demo-seed" })).ok === true ? "refunded" : (store.getGuarantee(id)?.status ?? "unknown");
      }
      return ok({ seeded: store.getState().sequences.guarantee, outcomes: results });
    },
  },

  // --- PayPal webhooks (signature-verified) --------------------------------
  {
    method: "POST",
    path: "/webhooks/paypal",
    auth: false,
    rawBody: true,
    handler: async (ctx) => {
      const verification = await paypal.verifyWebhookSignature(ctx.headers, ctx.rawBody);
      if (!verification.verified) {
        store.audit({ kind: "webhook_rejected", provenance: verification.provenance });
        return ok({ error: "signature_verification_failed" }, 400);
      }
      const event = ctx.body || {};
      // PAYMENT.CAPTURE.REFUND.* / PAYMENT.CAPTURE.* events are recorded as evidence;
      // they never trigger money movement by themselves.
      store.addEvent({ guaranteeId: event.resource?.reference_id ?? "unlinked", type: `paypal.${event.event_type}`, at: event.create_time, detail: event.summary, eventId: `pw_${event.id ?? Math.random().toString(36).slice(2, 10)}` });
      store.audit({ kind: "webhook_accepted", event_type: event.event_type });
      return ok({ received: true });
    },
  },
];

// Compile ":param" path patterns to matchers.
export function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const pattern = r.path.replace(/:(\w+)/g, "(?<$1>[^/]+)");
    const m = pathname.match(new RegExp(`^${pattern}$`));
    if (m) return { route: r, params: m.groups || {} };
  }
  return null;
}
