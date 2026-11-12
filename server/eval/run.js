// Measure the deployed parser end to end over HTTP (LLM + guards + validation).
// Usage: node eval/run.js http://localhost:8799   (or the live URL)
// Writes eval/results.json with per-case outcomes, accuracy and latency.
import fs from "node:fs";
import { CORPUS } from "./corpus.js";

const base = (process.argv[2] || "http://localhost:8799").replace(/\/$/, "");
const key = process.env.PROMISEPAY_API_KEY || "dev-key-change-me";

const mode = await (await fetch(`${base}/api/mode`)).json();
const rows = [];
for (const [text, expect] of CORPUS) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/parse-preview`, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ promiseText: text }),
  });
  const ms = performance.now() - t0;
  const out = await res.json();
  const sla = out.sla;
  let pass;
  if (expect.refuse) pass = !sla;
  else {
    const v = sla?.verification || {};
    const hours = v.withinHours ?? (v.withinDays != null ? v.withinDays * 24 : null);
    pass = !!sla && sla.kind === expect.kind && sla.remedy?.type === expect.remedy
      && (expect.amount == null || sla.remedy.amount === expect.amount)
      && (expect.days == null || hours === expect.days * 24)
      && (expect.hours == null || hours === expect.hours);
  }
  rows.push({ text, expect, pass, source: out.source, ms: Math.round(ms), got: sla ?? { refusal: out.refusal?.refusal } });
  console.log(`${pass ? "PASS" : "FAIL"} ${String(Math.round(ms)).padStart(5)}ms [${out.source}] ${text}`);
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const exec = rows.filter((r) => !r.expect.refuse), refu = rows.filter((r) => r.expect.refuse);
const llmMs = rows.filter((r) => r.source === "llm").map((r) => r.ms);
const summary = {
  measuredAt: new Date().toISOString(),
  target: base, model: mode.model, provider: mode.provider,
  cases: rows.length,
  accuracy: rows.filter((r) => r.pass).length / rows.length,
  executableCorrect: `${exec.filter((r) => r.pass).length}/${exec.length}`,
  unsafeCorrectlyRefused: `${refu.filter((r) => r.pass).length}/${refu.length}`,
  falseGuarantees: refu.filter((r) => !r.pass).length,
  answeredBy: { llm: rows.filter((r) => r.source === "llm").length, guard: rows.filter((r) => r.source === "guard").length, fallback: rows.filter((r) => r.source === "fallback").length },
  latencyMs: { medianAll: pct(rows.map((r) => r.ms), 0.5), medianLlm: llmMs.length ? pct(llmMs, 0.5) : null, p90Llm: llmMs.length ? pct(llmMs, 0.9) : null },
  conditions: "sequential HTTP requests, one at a time, temperature 0; latency is end-to-end request time measured by the client",
};
console.log("\n" + JSON.stringify(summary, null, 2));
fs.writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
