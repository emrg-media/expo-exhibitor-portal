// Booth-services pricing for The Event Planner Expo.
// Values marked CONFIRM are placeholders from the 2025 forms, pending Jessica's
// final 2026 numbers. Everything the team might change lives at the top here.

export const PROCESSING_FEE_RATE = 0.03; // 3% credit card processing fee, applied to every order

// 2026 event details (from Jessica).
export const EVENT_INFO = {
  dates: "October 27th-29th",             // year lives on the logo, so it is omitted here
  location: "New York City",              // shown in the header + summary
  venue: "Metropolitan Pavilion",         // full venue, used in guidance notes
};

// Order deadline for Wi-Fi and Electric (from the exhibitor form). No day-of ordering.
export const WIFI_ELECTRIC_DEADLINE = "Friday, October 2nd, 2026";

// ── Electricity ──────────────────────────────────────────────────────────────
// CONFIRM: 2025 form lists the 20-amp outlet at "$150 per day x days". Treating
// it as a flat $150 each for now; flip PER_DAY to true and set EVENT_DAYS if it
// is actually per day.
export const ELECTRIC = {
  amp20Price: 150,      // per 20-amp outlet
  amp20PerDay: false,   // CONFIRM with Jessica
  powerStripPrice: 15,  // per power strip cord (flat)
};
export const EVENT_DAYS = 3; // used only if amp20PerDay is true

// ── Wi-Fi ────────────────────────────────────────────────────────────────────
export const WIFI_PER_DEVICE = 20;

// ── Lead Retrieval, date-tiered ──────────────────────────────────────────────
// 2026 pricing and deadlines from Jessica. `end` is the last day (inclusive) the
// price is available; price rises as the event approaches.
export interface LeadTier {
  id: string;
  label: string;   // human label shown in the table
  price: number;
  end: string;     // inclusive last day, YYYY-MM-DD
}
export const LEAD_TIERS: LeadTier[] = [
  { id: "t1", label: "By August 20", price: 150, end: "2026-08-20" },
  { id: "t2", label: "By September 10", price: 250, end: "2026-09-10" },
  { id: "t3", label: "By September 24", price: 300, end: "2026-09-24" },
  { id: "t4", label: "By October 9", price: 350, end: "2026-10-09" },
  { id: "t5", label: "By October 24", price: 400, end: "2026-10-24" },
  { id: "t6", label: "October 27-29", price: 550, end: "2026-10-29" },
];

// ── Selection + computation ──────────────────────────────────────────────────

export interface OrderSelection {
  amp20Qty: number;
  powerStripQty: number;
  wifiDevices: number;
  leadRetrieval: boolean; // one registration per company (CONFIRM if quantity should apply)
}

// Largest quantity the form will price without a conversation. Nothing on a
// booth plausibly needs more, and the checkout API is public: without a ceiling
// a crafted request can open a six-figure Stripe Checkout Session.
export const MAX_QTY = { amp20Qty: 25, powerStripQty: 50, wifiDevices: 50 } as const;

/**
 * Coerce whatever arrived over the wire into a selection we are willing to
 * price: whole numbers, never negative, anything unparseable treated as none.
 * The browser clamps as well, but the API is reachable directly.
 */
export function sanitizeSelection(raw: unknown): OrderSelection {
  const s = (raw ?? {}) as Record<string, unknown>;
  const qty = (v: unknown) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    amp20Qty: qty(s.amp20Qty),
    powerStripQty: qty(s.powerStripQty),
    wifiDevices: qty(s.wifiDevices),
    leadRetrieval: s.leadRetrieval === true,
  };
}

/**
 * Quantities above the ceiling are refused rather than silently reduced: an
 * exhibitor who asked for 80 outlets must not be quietly charged for 50.
 */
export function selectionTooLarge(sel: OrderSelection): string | null {
  const over = (
    [
      ["amp20Qty", "20-amp outlets"],
      ["powerStripQty", "power strips"],
      ["wifiDevices", "Wi-Fi devices"],
    ] as const
  ).find(([k]) => sel[k] > MAX_QTY[k]);
  if (!over) return null;
  const [key, label] = over;
  return `This form handles up to ${MAX_QTY[key]} ${label} per order. Please contact the Expo team to arrange a larger order.`;
}

export interface OrderLine {
  key: string;
  label: string;
  detail: string;
  qty: number;
  unit: number;
  amount: number;
}

export interface OrderTotals {
  lines: OrderLine[];
  subtotal: number;
  fee: number;
  total: number;
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Current lead-retrieval tier for a given day. Chronological string compare on
// YYYY-MM-DD works lexicographically. Returns null when registration has closed.
export function currentLeadTier(today: Date): LeadTier | null {
  const t = toDateStr(today);
  for (const tier of LEAD_TIERS) {
    if (t <= tier.end) return tier;
  }
  return null;
}

export type TierStatus = "past" | "current" | "upcoming";

export function tierStatus(tier: LeadTier, today: Date): TierStatus {
  const current = currentLeadTier(today);
  if (toDateStr(today) > tier.end) return "past";
  if (current && current.id === tier.id) return "current";
  return "upcoming";
}

export function computeOrder(sel: OrderSelection, today: Date): OrderTotals {
  const lines: OrderLine[] = [];

  if (sel.amp20Qty > 0) {
    const unit = ELECTRIC.amp20Price * (ELECTRIC.amp20PerDay ? EVENT_DAYS : 1);
    lines.push({
      key: "amp20",
      label: "20-amp outlet",
      detail: ELECTRIC.amp20PerDay ? `$${ELECTRIC.amp20Price}/day x ${EVENT_DAYS} days` : "each",
      qty: sel.amp20Qty, unit, amount: unit * sel.amp20Qty,
    });
  }
  if (sel.powerStripQty > 0) {
    lines.push({
      key: "powerstrip",
      label: "Power strip",
      detail: "per cord",
      qty: sel.powerStripQty, unit: ELECTRIC.powerStripPrice, amount: ELECTRIC.powerStripPrice * sel.powerStripQty,
    });
  }
  if (sel.wifiDevices > 0) {
    lines.push({
      key: "wifi",
      label: "Wi-Fi device",
      detail: "per device",
      qty: sel.wifiDevices, unit: WIFI_PER_DEVICE, amount: WIFI_PER_DEVICE * sel.wifiDevices,
    });
  }
  if (sel.leadRetrieval) {
    const tier = currentLeadTier(today);
    if (tier) {
      lines.push({
        key: "lead",
        label: "Lead Retrieval",
        detail: tier.label,
        qty: 1, unit: tier.price, amount: tier.price,
      });
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  // Round to whole cents so the page, the receipt and the Stripe charge agree.
  // Every price here is currently a whole dollar, which makes 3% land on exact
  // cents anyway, but a price ending in cents would otherwise put a fraction of
  // a cent between what is displayed and what is billed.
  const fee = Math.round(subtotal * PROCESSING_FEE_RATE * 100) / 100;
  const total = Math.round((subtotal + fee) * 100) / 100;
  return { lines, subtotal, fee, total };
}

export function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
