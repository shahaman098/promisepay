// Express binding of the shared route table (local Node, tests, sandbox harness).
// The Cloudflare Worker binding lives in worker/entry.js.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routes, matchRoute, apiKeyOk } from "./routes.js";

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web");

export function buildApp() {
  const app = express();
  // Raw body needed for PayPal webhook signature verification.
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  // The demo UI ships from the same origin as the API (no CORS, one deployable URL).
  app.use(express.static(webDir));

  for (const r of routes) {
    app[r.method.toLowerCase()](r.path, async (req, res) => {
      try {
        if (r.auth && !apiKeyOk(req.headers)) return res.status(401).json({ error: "bad_api_key" });
        const out = await r.handler({ params: req.params, body: req.body, headers: req.headers, rawBody: req.rawBody });
        res.status(out.status).json(out.body);
      } catch (e) {
        res.status(400).json({ error: String(e.message || e) });
      }
    });
  }

  return app;
}
