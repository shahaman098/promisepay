// PromisePay API. Every money-moving transition goes through enforce.js —
// no route may shortcut the proof obligations. Exported as buildApp() so the
// contract tests can drive the real app without a fixed port.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";
import * as paypal from "./paypal.js";
import { parsePromise } from "./ai/parser.js";
import { evaluateGuarantee, executeRemedy } from "./enforce.js";

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web");

export function buildApp() {
  const app = express();
  // Raw body needed for PayPal webhook signature verification.
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  // The demo UI ships from the same origin as the API (no CORS, one deployable URL).
  app.use(express.static(webDir));

  const requireApiKey = (req, res, next) => {
    if (req.header("x-api-key") !== (process.env.PROMISEPAY_API_KEY || "dev-key-change-me")) {
      return res.status(401).json({ error: "bad_api_key" });
    }
    next();
  };

  // --- Merchant: create a guarantee from promise prose --------------------
  app.post("/api/promises", requireApiKey, async (req, res) => {
    const { promiseText, orderId, captureId } = req.body || {};
    if (!promiseText || !orderId) return res.status(400).json({ error: "promiseText and orderId required" });
    const parsed = await parsePromise(promiseText);
    // Fail-closed at parse time: prose we cannot turn into an executable,
    // evidence-checkable SLA never becomes a guarantee.
    if (parsed.refusal || !parsed.sla) {
      return res.status(422).json({ refusal: parsed.refusal?.refusal ?? "unparseable", reason: parsed.refusal?.reason ?? "parser produced no SLA", source: parsed.source });
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
    res.json(g);
  });

  // --- Event ingestion (carrier feed / status feed) ------------------------
  app.post("/api/events", requireApiKey, (req, res) => {
    const { guaranteeId, type, at, detail, amountDelta } = req.body || {};
    if (!guaranteeId || !type) return res.status(400).json({ error: "guaranteeId and type required" });
    const evt = store.addEvent({ guaranteeId, type, at: at || new Date().toISOString(), detail, amountDelta, eventId: `e_${store.getState().events.length + 1}` });
    res.json(evt);
  });

  // --- Evaluation (read-only) ---------------------------------------------
  app.get("/api/guarantees/:id/evaluate", requireApiKey, async (req, res) => {
    try {
      const out = await evaluateGuarantee(req.params.id);
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  // --- THE enforcement endpoint -------------------------------------------
  app.post("/api/guarantees/:id/execute-remedy", requireApiKey, async (req, res) => {
    const { expectedVersion, requestedBy } = req.body || {};
    if (!Number.isInteger(expectedVersion)) return res.status(400).json({ error: "expectedVersion required" });
    try {
      const out = await executeRemedy(req.params.id, { expectedVersion, requestedBy: requestedBy || "api" });
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  // --- Reads ---------------------------------------------------------------
  app.get("/api/guarantees", requireApiKey, (_req, res) => {
    const list = Object.values(store.getState().guarantees).map((g) => ({ ...g, auditCount: store.auditFor(g.id).length, eventCount: store.eventsFor(g.id).length }));
    res.json(list);
  });

  app.get("/api/guarantees/:id", requireApiKey, (req, res) => {
    const g = store.getGuarantee(req.params.id);
    if (!g) return res.status(404).json({ error: "not_found" });
    res.json({ ...g, audit: store.auditFor(g.id), events: store.eventsFor(g.id) });
  });

  // Parse preview: what WOULD the parser do with this prose? No state changes.
  app.post("/api/parse-preview", requireApiKey, async (req, res) => {
    const { promiseText } = req.body || {};
    if (!promiseText) return res.status(400).json({ error: "promiseText required" });
    res.json(await parsePromise(promiseText));
  });

  app.get("/api/mode", (_req, res) => res.json({ paypalMode: paypal.mode(), ai: process.env.OPENAI_API_KEY ? "llm" : "fallback-parser" }));

  app.get("/api/audit", requireApiKey, (_req, res) => res.json(store.allAudit()));

  // --- PayPal webhooks (signature-verified) --------------------------------
  app.post("/webhooks/paypal", async (req, res) => {
    const verification = await paypal.verifyWebhookSignature(req.headers, req.rawBody);
    if (!verification.verified) {
      store.audit({ kind: "webhook_rejected", provenance: verification.provenance });
      return res.status(400).json({ error: "signature_verification_failed" });
    }
    const event = req.body || {};
    // PAYMENT.CAPTURE.REFUND.* / PAYMENT.CAPTURE.* events are recorded as evidence;
    // they never trigger money movement by themselves.
    store.addEvent({ guaranteeId: event.resource?.reference_id ?? "unlinked", type: `paypal.${event.event_type}`, at: event.create_time, detail: event.summary, eventId: `pw_${event.id ?? Math.random().toString(36).slice(2, 10)}` });
    store.audit({ kind: "webhook_accepted", event_type: event.event_type });
    res.json({ received: true });
  });

  return app;
}
