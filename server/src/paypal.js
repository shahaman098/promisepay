// PayPal integration layer.
//
// Modes:
//  - "sandbox": real calls against api-m.sandbox.paypal.com with full provenance
//    (every record carries retrieval time + API endpoint + ids).
//  - "offline" (default): fixture records only — no credentials needed. Fixture
//    records are labeled as such; the enforcement layer treats them identically,
//    which keeps the demo honest: we never claim sandbox data where there is none.
//
// IMPORTANT (hackathon rules): credentials live in env vars only, never in code.

const API_BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

// Effective mode is evaluated per call (not at import time, when Workers env
// bindings may not be mirrored yet). "sandbox" only takes effect when
// credentials exist: a deployment that sets PROMISEPAY_MODE=sandbox but has no
// secrets must degrade to honestly-labeled offline fixtures, not throw.
function currentMode() {
  const wanted = (process.env.PROMISEPAY_MODE || "offline").toLowerCase();
  return wanted === "sandbox" && process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET ? "sandbox" : "offline";
}

let tokenCache = { token: null, expiresAt: 0 };

async function accessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID/SECRET missing for sandbox mode");
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return tokenCache.token;
}

function fixture(tag) {
  return { provenance: "fixture", note: "offline fixture record, not retrieved from PayPal" , ...tag };
}

// Ids minted by the offline fixtures (demo seed, tests) are always served as
// labeled fixtures, even in sandbox mode: they do not exist at PayPal, and the
// demo must be resettable on a deployment that has real sandbox credentials.
const isFixtureId = (id) => typeof id === "string" && id.startsWith("OFFLINE");

export function mode() {
  return currentMode();
}

// --- Orders v2 ---------------------------------------------------------

export async function getOrder(orderId) {
  if (currentMode() === "offline" || isFixtureId(orderId)) {
    return fixture({ kind: "order", id: orderId, status: "APPROVED" });
  }
  const token = await accessToken();
  const res = await fetch(`${API_BASE}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PayPal getOrder(${orderId}) failed: ${res.status}`);
  const json = await res.json();
  return { provenance: "paypal-sandbox", retrievedAt: new Date().toISOString(), endpoint: "/v2/checkout/orders", ...json };
}

export async function createOrder({ amount, currency = "USD", reference }) {
  if (currentMode() === "offline") {
    return fixture({ kind: "order", id: `OFFLINE-${Math.random().toString(36).slice(2, 10)}`, status: "CREATED", amount, currency, reference });
  }
  const token = await accessToken();
  const res = await fetch(`${API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ reference_id: reference, amount: { currency_code: currency, value: amount } }],
    }),
  });
  if (!res.ok) throw new Error(`PayPal createOrder failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function captureOrder(orderId) {
  if (currentMode() === "offline") {
    return fixture({ kind: "capture", id: `OFFLINE-CAP-${Math.random().toString(36).slice(2, 8)}`, status: "COMPLETED", order_id: orderId });
  }
  const token = await accessToken();
  const res = await fetch(`${API_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`PayPal capture(${orderId}) failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return { provenance: "paypal-sandbox", capturedAt: new Date().toISOString(), ...json };
}

// --- Captures / refunds ------------------------------------------------

export async function getCapture(captureId) {
  if (currentMode() === "offline" || isFixtureId(captureId)) {
    return fixture({ kind: "capture", id: captureId, status: "COMPLETED", amount: { currency_code: "USD", value: "100.00" } });
  }
  const token = await accessToken();
  const res = await fetch(`${API_BASE}/v2/payments/captures/${captureId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PayPal getCapture(${captureId}) failed: ${res.status}`);
  const json = await res.json();
  return { provenance: "paypal-sandbox", retrievedAt: new Date().toISOString(), endpoint: "/v2/payments/captures", ...json };
}

export async function refundCapture({ captureId, amount, currency = "USD", idempotencyKey }) {
  if (currentMode() === "offline" || isFixtureId(captureId)) {
    // Offline refunds succeed deterministically except for a sentinel id used by
    // the decline-simulation test — mirrors PayPal-Mock-Response INSTRUMENT_DECLINED.
    if (captureId === "OFFLINE-DECLINE") {
      return { provenance: "fixture", simulatedDecline: true, error: "INSTRUMENT_DECLINED" };
    }
    return fixture({ kind: "refund", id: `RF-${Math.random().toString(36).slice(2, 10)}`, capture_id: captureId, status: "COMPLETED", amount: { currency_code: currency, value: amount }, idempotency_key: idempotencyKey });
  }
  const token = await accessToken();
  const res = await fetch(`${API_BASE}/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": idempotencyKey, // PayPal's idempotency mechanism
    },
    body: JSON.stringify(amount ? { amount: { currency_code: currency, value: Number(amount).toFixed(2) } } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { provenance: "paypal-sandbox", ok: false, status: res.status, error: json, retrievedAt: new Date().toISOString() };
  }
  return { provenance: "paypal-sandbox", ok: true, retrievedAt: new Date().toISOString(), endpoint: "/v2/payments/captures/{id}/refund", ...json };
}

export async function listRefundsForCapture(captureId) {
  if (currentMode() === "offline") {
    // The store's event log is the fixture ledger in offline mode.
    return { provenance: "fixture", refunds: [] };
  }
  const token = await accessToken();
  const res = await fetch(`${API_BASE}/v2/payments/refunds`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PayPal listRefunds failed: ${res.status}`);
  const json = await res.json();
  const refunds = (json.refunds || []).filter((r) => r.capture_id === captureId);
  return { provenance: "paypal-sandbox", retrievedAt: new Date().toISOString(), refunds };
}

// --- Webhook signature verification -------------------------------------

export async function verifyWebhookSignature(headers, rawBody) {
  const hget = (name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]);
  if (currentMode() === "offline") {
    // Offline test webhooks carry a dev signature header; document clearly.
    return { provenance: "fixture", verified: hget("x-promisepay-dev-webhook") === "1" };
  }
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID missing for sandbox webhook verification");
  const token = await accessToken();
  const res = await fetch(`${API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: hget("paypal-auth-algo"),
      cert_url: hget("paypal-cert-url"),
      transmission_id: hget("paypal-transmission-id"),
      transmission_sig: hget("paypal-transmission-sig"),
      transmission_time: hget("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: typeof rawBody?.toString === "function" ? JSON.parse(rawBody.toString("utf8")) : rawBody,
    }),
  });
  if (!res.ok) return { provenance: "paypal-sandbox", verified: false, status: res.status };
  const json = await res.json();
  return { provenance: "paypal-sandbox", verified: json.verification_status === "SUCCESS" };
}
