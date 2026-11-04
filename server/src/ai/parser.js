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

export function parseFallback(text) {
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
  return {
    kind: SLA_KINDS.DELIVERY_BY,
    verification: { type: "tracking_timeline", source: "carrier_feed", withinDays: days },
    remedy: fullRefund
      ? { type: REMEDY_TYPES.FULL_REFUND, amount: null }
      : { type: REMEDY_TYPES.FIXED_AMOUNT, amount: amountMatch ? clampNumber(amountMatch[1], 5) : 5 },
  };
}

async function llmParse(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.PROMISEPAY_MODEL || "gpt-4o-mini";
  const system = [
    "You convert merchant service promises into a strict JSON SLA, or refuse.",
    'Output ONLY JSON: {"kind":"delivery_by"|"resolution_within"|"price_match",',
    '"verification":{"type":string,"source":string,"withinDays"?:number,"withinHours"?:number},',
    '"remedy":{"type":"fixed_amount"|"full_refund"|"difference","amount":number|null}}',
    'OR {"refusal":"reason_tag","reason":string}.',
    "Refuse (never guess) when: the text negates a guarantee, the remedy is discretionary,",
    "no timeframe or remedy is stated, or any number would have to be invented.",
    "Never invent numbers that are not implied by the text; use null when absent.",
  ].join(" ");
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
    const parsed = JSON.parse(json.choices[0].message.content);
    if (parsed.refusal) return parsed;
    if (!parsed.kind || !parsed.verification || !parsed.remedy) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function parsePromise(text) {
  const viaLlm = await llmParse(text);
  if (viaLlm) return { sla: viaLlm.refusal ? null : viaLlm, refusal: viaLlm.refusal ? viaLlm : null, source: "llm", promiseText: text };
  const fallback = parseFallback(text);
  if (fallback.refusal) return { sla: null, refusal: fallback, source: "fallback", promiseText: text };
  return { sla: fallback, refusal: null, source: "fallback", promiseText: text };
}
