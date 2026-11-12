// Cloudflare Workers entry: the same API as the Node server, driven through a
// single Durable Object so every request mutates one serialized, durable state.
// Static assets (the demo UI) are served by Workers Assets; API and webhook
// paths are routed to this worker first (see wrangler.jsonc).

import { matchRoute, apiKeyOk } from "../server/src/routes.js";
import * as store from "../server/src/store.js";
import { setAiBinding } from "../server/src/ai/parser.js";

const DO_ID = "promisepay-global"; // one instance for the whole deployment

export class PromisePayDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Shared modules read process.env (PayPal keys, model config, API key).
    // With nodejs_compat, process.env exists; mirror the worker's bindings into it.
    try {
      for (const [k, v] of Object.entries(env || {})) {
        if (typeof v === "string") process.env[k] ??= v;
      }
    } catch { /* process.env unavailable on exotic runtimes — env passed explicitly */ }

    setAiBinding(env?.AI);

    // Load durable state once; this constructor only runs on wake.
    ctx.blockConcurrencyWhile(async () => {
      const persisted = await ctx.storage.get("state");
      store.initState(persisted || undefined);
      store.setPersistFn(async (s) => ctx.storage.put("state", s));
    });
  }

  async fetch(req) {
    return handle(req, this.env);
  }
}

async function handle(req, env) {
  try {
    const url = new URL(req.url);
    const matched = matchRoute(req.method, url.pathname);
    if (!matched) return json({ error: "not_found" }, 404);
    const { route, params } = matched;

    if (route.auth && !apiKeyOk(req.headers, env)) return json({ error: "bad_api_key" }, 401);

    let body = null;
    let rawBody = null;
    if (route.rawBody) {
      rawBody = Buffer.from(await req.arrayBuffer());
      try { body = JSON.parse(rawBody.toString("utf8")); } catch { body = null; }
    } else if (["POST", "PUT", "PATCH"].includes(req.method)) {
      try { body = await req.json(); } catch { body = null; }
    }

    const out = await route.handler({ params, body, headers: req.headers, rawBody, env });
    // Await durability before responding: the CAS/refund record must survive.
    await store.flush();
    return json(out.body, out.status);
  } catch (e) {
    await store.flush().catch(() => {});
    return json({ error: String(e?.message || e) }, 400);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default {
  async fetch(req, env, ctx) {
    // Route every API/webhook request through the singleton DO.
    const ns = env.PROMISEPAY_DO;
    const id = ns.idFromName(DO_ID);
    const stub = ns.get(id);
    return stub.fetch(req);
  },
};
