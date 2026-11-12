// Promise parser: turns arbitrary merchant promise prose into a structured,
// executable SLA. This is the step the engine's red team called the moment AI
// becomes *indispensable* — a structured form cannot read prose.
//
// Fail-closed at parse time: prose that cannot be turned into an executable,
// evidence-checkable promise returns a REFUSAL, and the API refuses to create
// a guarantee. Nothing moves money on a promise we could not understand.
// (Red-team checklist: handle negation, ambiguity, multiple remedies without
// inventing numbers.)
//
// Two implementations:
//  1. LLM (any OpenAI-compatible endpoint) when configured.
//  2. Deterministic fallback covering the canonical promise families.
// Both results are labeled with their source ("llm" | "fallback").

const REMEDY_TYPES = { FIXED_AMOUNT: "fixed_amount", FULL_REFUND: "full_refund", DIFFERENCE: "difference" };
const SLA_KINDS = { DELIVERY_BY: "delivery_by", RESOLUTION_WITHIN: "resolution_within", PRICE_MATCH: "price_match" };

function clampNumber(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// Negation / hedge detection: a promise that says it does NOT apply, or that
// hides the remedy behind a condition the user must interpret, must not become
// an executable SLA (we would risk moving money on a misread).
const NEGATION_PATTERNS = [
  /\bno\s+refunds?\b/,
  /\bnon[- ]?refundable\b/,
  /\bwe\s+don(?:'?t|ot)\s+guarantee\b/,
  /\bwe\s+don(?:'?t|ot)\s+offer\b/,
  /\bnever\s+refund/,
  /\bcannot\s+guarantee\b/,
];

// Deterministic refusal guards. Run BEFORE any model so a model can never
// talk its way past a negation or a discretionary remedy.
export function preRefuse(text) {
  const raw = text.trim();
  const t = raw.toLowerCase();

  // Reject trivially non-promissory input.
  if (raw.length < 8) {
    return { refusal: "too_short", reason: "promise text too short to contain a commitment" };
  }
  for (const p of NEGATION_PATTERNS) {
    if (p.test(t)) {
      return { refusal: "negated_promise", reason: "text states an absence of a guarantee; refusing to create an executable SLA" };
    }
  }
  // Ambiguity guard: a remedy contingent on something we cannot evidence.
  if (/\bunless\b|\bat our discretion\b|\bcase by case\b|\bwe may\b/.test(t)) {
    return { refusal: "contingent_promise", reason: "remedy depends on discretionary conditions we cannot evidence" };
  }
  return null;
}

export function parseFallback(text) {
  const raw = text.trim();
  const t = raw.toLowerCase();
  const pre = preRefuse(text);
  if (pre) return pre;

  const amountMatch = t.match(/(?:\$|usd\s*)(\d+(?:\.\d{1,2})?)/);
  const hoursMatch = t.match(/(\d+)\s*(hour|hr)/);
  const daysMatch = t.match(/(\d+)\s*(day)/);
  const hasRemedyWord = /\b(back|refund|compensat|credit|pay)\b/.test(t);

  // Price-match family: "best price ... or the difference (back)".
  if ((t.includes("best price") || t.includes("price match")) && t.includes("difference")) {
    return {
      kind: SLA_KINDS.PRICE_MATCH,
      verification: { type: "price_comparison", source: "merchant_price_feed" },
      remedy: { type: REMEDY_TYPES.DIFFERENCE, amount: null },
    };
  }

  // Resolution family: "fixed/repaired/resolved within N hours/days".
  if (/\b(fix|repair|resolve|restor)\w*\b/.test(t)) {
    if (!hasRemedyWord) {
      return { refusal: "no_remedy", reason: "describes a repair commitment without stating what the buyer receives if missed" };
    }
    const hours = hoursMatch ? clampNumber(hoursMatch[1], 48) : daysMatch ? clampNumber(daysMatch[1], 2) * 24 : 48;
    return {
      kind: SLA_KINDS.RESOLUTION_WITHIN,
      verification: { type: "status_timeline", source: "merchant_status_feed", withinHours: hours },
      remedy: { type: amountMatch ? REMEDY_TYPES.FIXED_AMOUNT : REMEDY_TYPES.FULL_REFUND, amount: amountMatch ? clampNumber(amountMatch[1], null) : null },
    };
  }

  // Delivery family (default): needs BOTH a schedule and a remedy to be executable.
  const hasSchedule = daysMatch || hoursMatch || /\b(deliver\w*|ship\w*)\b/.test(t);
  if (!hasSchedule) {
    return { refusal: "no_schedule", reason: "no delivery/resolution timeframe detected" };
  }
  if (!hasRemedyWord) {
    return { refusal: "no_remedy", reason: "no remedy stated for the missed promise" };
  }
  const days = daysMatch ? clampNumber(daysMatch[1], 2) : hoursMatch ? clampNumber(hoursMatch[1], 48) / 24 : 2;
  const fullRefund = /money back|full refund|refund the full|entire payment/.test(t);
  // Never invent a remedy amount: a partial remedy must state its number.
  if (!fullRefund && !amountMatch) {
    return { refusal: "no_remedy_amount", reason: "remedy is not a full refund and states no dollar amount; refusing to invent one" };
  }
  return {
    kind: SLA_KINDS.DELIVERY_BY,
    verification: { type: "tracking_timeline", source: "carrier_feed", withinDays: days },
    remedy: fullRefund
      ? { type: REMEDY_TYPES.FULL_REFUND, amount: null }
      : { type: REMEDY_TYPES.FIXED_AMOUNT, amount: amountMatch ? clampNumber(amountMatch[1], null) : null },
  };
}

const SYSTEM_PROMPT = [
    "You convert merchant service promises into a strict JSON SLA, or refuse.",
    'Output ONLY JSON: {"kind":"delivery_by"|"resolution_within"|"price_match",',
    '"verification":{"type":string,"source":string,"withinDays"?:number,"withinHours"?:number},',
    '"remedy":{"type":"fixed_amount"|"full_refund"|"difference","amount":number|null}}',
    'OR {"refusal":"reason_tag","reason":string}.',
    "Refuse (never guess) when: the text negates a guarantee, the remedy is discretionary,",
    "no timeframe or remedy is stated, or any number would have to be invented.",
    "Never invent numbers that are not implied by the text; use null when absent.",
].join(" ");

// Cloudflare Workers AI binding (set by the worker entry). When present it is
// the primary model path: no external API key needed.
let aiBinding = null;
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export function setAiBinding(b) { aiBinding = b || null; }
export function aiMode() {
  if (aiBinding) return { ai: "llm", provider: "cloudflare-workers-ai", model: WORKERS_AI_MODEL };
  if (process.env.OPENAI_API_KEY) return { ai: "llm", provider: "openai-compatible", model: process.env.PROMISEPAY_MODEL || "gpt-4o-mini" };
  return { ai: "fallback-parser", provider: null, model: null };
}

function validLlmOutput(parsed, text = "") {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.refusal) return parsed;
  if (!parsed.kind || !parsed.verification || !parsed.remedy) return null;
  if (!Object.values(SLA_KINDS).includes(parsed.kind)) return null;
  if (!Object.values(REMEDY_TYPES).includes(parsed.remedy.type)) return null;
  // A fixed remedy must be a positive number that is actually stated in the
  // prose, in dollars (a "20% off" must never become $20).
  if (parsed.remedy.type === REMEDY_TYPES.FIXED_AMOUNT) {
    const amt = Number(parsed.remedy.amount);
    const stated = text.match(/(?:\$|usd\s*)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd)\b/gi) || [];
    const nums = stated.map((m) => Number(m.replace(/[^\d.]/g, "")));
    if (!Number.isFinite(amt) || amt <= 0 || !nums.includes(amt) || /%|percent/i.test(text)) {
      return { refusal: "remedy_amount_not_stated", reason: "model proposed a fixed amount that is not a stated dollar figure; refusing rather than inventing one" };
    }
  }
  // The model decides WHAT was promised; code decides WHICH evidence feed
  // checks it. Pin the evidence source per SLA kind so the evaluator never
  // depends on model-invented feed names.
  const CANON = {
    delivery_by: { type: "tracking_timeline", source: "carrier_feed" },
    resolution_within: { type: "status_timeline", source: "merchant_status_feed" },
    price_match: { type: "price_comparison", source: "merchant_price_feed" },
  };
  const v = parsed.verification || {};
  const verification = { ...CANON[parsed.kind] };
  if (v.withinDays != null) verification.withinDays = clampNumber(v.withinDays, null);
  if (v.withinHours != null) verification.withinHours = clampNumber(v.withinHours, null);
  if (parsed.kind !== "price_match" && verification.withinDays == null && verification.withinHours == null) {
    return { refusal: "no_schedule", reason: "model found no evidence window; refusing rather than inventing one" };
  }
  return { ...parsed, verification };
}

function extractJson(out) {
  if (out && typeof out === "object" && !("response" in out)) return out;
  const r = out?.response ?? out;
  if (r && typeof r === "object") return r;
  const str = String(r ?? "");
  const m = str.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

async function llmParse(text) {
  const system = SYSTEM_PROMPT;
  if (aiBinding) {
    try {
      const out = await aiBinding.run(WORKERS_AI_MODEL, {
        messages: [{ role: "system", content: system }, { role: "user", content: text }],
        temperature: 0,
        max_tokens: 400,
      });
      const v = validLlmOutput(extractJson(out), text);
      if (v) return { ...v, _model: WORKERS_AI_MODEL };
    } catch { /* fall through */ }
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.PROMISEPAY_MODEL || "gpt-4o-mini";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: text }],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const parsed = validLlmOutput(JSON.parse(json.choices[0].message.content), text);
    return parsed ? { ...parsed, _model: model } : null;
  } catch {
    return null;
  }
}

export async function parsePromise(text) {
  const pre = preRefuse(text);
  if (pre) return { sla: null, refusal: pre, source: "fallback", promiseText: text };
  const viaLlm = await llmParse(text);
  if (viaLlm) {
    const { _model: model, ...out } = viaLlm;
    return { sla: out.refusal ? null : out, refusal: out.refusal ? out : null, source: "llm", model, promiseText: text };
  }
  const fallback = parseFallback(text);
  if (fallback.refusal) return { sla: null, refusal: fallback, source: "fallback", promiseText: text };
  return { sla: fallback, refusal: null, source: "fallback", promiseText: text };
}
