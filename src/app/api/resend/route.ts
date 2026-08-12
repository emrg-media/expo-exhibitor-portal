import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { renderReceiptPdf, sendOrderEmails } from "@/lib/order";
import { loadTrackerOrders, type TrackerOrder } from "@/lib/trackerOrders";

// Re-sends the receipt for an order that already paid, rebuilt from the tracker
// row. For the case in the runbook: an exhibitor says no receipt arrived, or
// email was misconfigured while real orders were coming in.
//
// Deliberately narrow:
//  - inert unless EXPO_ADMIN_TOKEN is set, and returns 404 either way when the
//    token is missing or wrong, so its existence is not advertised
//  - the recipient is always the address stored on the order. There is no way
//    to pass one in, so this cannot be turned into an open mail relay.

function authorised(req: NextRequest): boolean {
  const expected = process.env.EXPO_ADMIN_TOKEN;
  if (!expected) return false;
  const given = req.headers.get("x-admin-token") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Lists what is in the tracker, so you can see what would be re-sent. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const orders = await loadTrackerOrders();
    return NextResponse.json({
      count: orders.length,
      orders: orders.map((o) => ({
        orderId: o.orderId,
        date: o.when.toISOString().slice(0, 10),
        company: o.company.company,
        email: o.company.email,
        total: o.totals.total,
        paymentStatus: o.paymentStatus,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

/** Re-sends one order by id, or every order when { all: true }. */
export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body: { orderId?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let orders: TrackerOrder[];
  try {
    orders = await loadTrackerOrders();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }

  const targets = body.all
    ? orders
    : orders.filter((o) => o.orderId === String(body.orderId || "").trim());

  if (targets.length === 0) {
    return NextResponse.json({ error: "No matching order." }, { status: 404 });
  }

  const results: Array<{ orderId: string; email: string; sent: boolean; error?: string }> = [];
  for (const o of targets) {
    if (!o.company.email) {
      results.push({ orderId: o.orderId, email: "", sent: false, error: "no email on the order" });
      continue;
    }
    try {
      const pdf = await renderReceiptPdf(o.company, o.totals, o.when, o.orderId);
      const mail = await sendOrderEmails(o.company, o.totals, pdf, o.orderId);
      results.push({ orderId: o.orderId, email: o.company.email, sent: mail.ok, ...(mail.error ? { error: mail.error } : {}) });
    } catch (err) {
      results.push({
        orderId: o.orderId, email: o.company.email, sent: false,
        error: err instanceof Error ? err.message : "failed",
      });
    }
  }

  return NextResponse.json({ sent: results.filter((r) => r.sent).length, total: results.length, results });
}
