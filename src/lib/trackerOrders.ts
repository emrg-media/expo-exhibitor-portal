import { google } from "googleapis";
import { TABS } from "@/lib/logOrder";
import type { OrderCompany } from "@/lib/order";
import type { OrderLine, OrderTotals } from "@/lib/pricing";

// Rebuilds a paid order from its tracker row, so a receipt can be re-sent
// without the original Stripe session. Column order is MASTER_HEADERS in
// logOrder.ts; the two must stay in step.

export interface TrackerOrder {
  orderId: string;
  company: OrderCompany;
  totals: OrderTotals;
  when: Date;
  paymentStatus: string;
}

export function parseTrackerRow(r: unknown[]): TrackerOrder | null {
  const s = (i: number) => String(r[i] ?? "").trim();
  const n = (i: number) => {
    const v = Number(r[i]);
    return Number.isFinite(v) ? v : 0;
  };
  const orderId = s(1);
  if (!orderId) return null;

  const lines: OrderLine[] = [];
  const push = (key: string, label: string, detail: string, qi: number, ai: number) => {
    const qty = n(qi);
    const amount = n(ai);
    if (qty > 0 && amount > 0) lines.push({ key, label, detail, qty, unit: amount / qty, amount });
  };
  push("amp20", "20-amp outlet", "each", 7, 8);
  push("powerstrip", "Power strip", "per cord", 9, 10);
  push("wifi", "Wi-Fi device", "per device", 11, 12);
  push("lead", "Lead Retrieval", s(19) || "registration", 13, 14);

  // Sheet serial (days since 1899-12-30) back to a date.
  const serial = n(0);
  const when = serial > 0 ? new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000) : new Date();

  return {
    orderId,
    company: {
      company: s(2),
      contact: [s(3), s(4)].filter(Boolean).join(" "),
      firstName: s(3),
      lastName: s(4),
      email: s(5),
      phone: s(6),
    },
    totals: { lines, subtotal: n(15), fee: n(16), total: n(17) },
    when,
    paymentStatus: s(18),
  };
}

export async function loadTrackerOrders(): Promise<TrackerOrder[]> {
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.EXPO_LOG_SHEET_ID;
  if (!keyB64 || !sheetId) throw new Error("tracker not configured");

  const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const res = await google.sheets({ version: "v4", auth }).spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TABS.master}!A2:T`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values || [])
    .map(parseTrackerRow)
    .filter((o): o is TrackerOrder => o !== null);
}
