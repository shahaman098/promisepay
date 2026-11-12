// Labelled promise corpus for measuring the live parser (LLM + guards).
// expect: { kind, remedy, amount?, days?, hours? } for an executable SLA,
//         or { refuse: true } when the prose must NOT become a guarantee.
export const CORPUS = [
  // executable — delivery
  ["2-day delivery or $5 back", { kind: "delivery_by", remedy: "fixed_amount", amount: 5, days: 2 }],
  ["Delivery in 5 days or $10 back. That's a promise.", { kind: "delivery_by", remedy: "fixed_amount", amount: 10, days: 5 }],
  ["Arrives within 3 days or we send you $7", { kind: "delivery_by", remedy: "fixed_amount", amount: 7, days: 3 }],
  ["If it isn't at your door in 4 days, you get $15 back", { kind: "delivery_by", remedy: "fixed_amount", amount: 15, days: 4 }],
  ["Delivered within 7 days or your money back", { kind: "delivery_by", remedy: "full_refund", days: 7 }],
  ["Next-day delivery (1 day) or a full refund", { kind: "delivery_by", remedy: "full_refund", days: 1 }],
  ["Ships and arrives in 2 days, otherwise $4 credited back to you", { kind: "delivery_by", remedy: "fixed_amount", amount: 4, days: 2 }],
  // executable — resolution
  ["We will fix it within 24 hours or full refund", { kind: "resolution_within", remedy: "full_refund", hours: 24 }],
  ["Repairs completed in 48 hours or $25 back", { kind: "resolution_within", remedy: "fixed_amount", amount: 25, hours: 48 }],
  ["Support ticket resolved within 12 hours or $3 back", { kind: "resolution_within", remedy: "fixed_amount", amount: 3, hours: 12 }],
  ["Your laptop repaired within 72 hours or your money back", { kind: "resolution_within", remedy: "full_refund", hours: 72 }],
  // executable — price match
  ["Best price this week or the difference back", { kind: "price_match", remedy: "difference" }],
  ["Find it cheaper elsewhere and we refund the difference", { kind: "price_match", remedy: "difference" }],
  // must refuse — negated
  ["No refunds on sale items", { refuse: true }],
  ["This product is non-refundable", { refuse: true }],
  ["We don't guarantee delivery times during holidays", { refuse: true }],
  ["All sales final", { refuse: true }],
  // must refuse — discretionary / vague remedy
  ["Refunds at our discretion if something goes wrong", { refuse: true }],
  ["We may compensate affected customers", { refuse: true }],
  ["If your order arrives after Friday we'll credit you something nice", { refuse: true }],
  ["Fast shipping or we'll make it right", { refuse: true }],
  // must refuse — missing remedy / schedule / amount
  ["Delivery within 2 days for all orders", { refuse: true }],
  ["We fix things fast", { refuse: true }],
  ["Delivered in 3 days or 20% off your next order", { refuse: true }],
];
