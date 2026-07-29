import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { decodeOrderMetadata, renderReceiptPdf, totalsFor } from "@/lib/order";

// Rebuilds a paid order for the confirmation screen: the itemised totals plus
// the receipt PDF. Deliberately sends no email; the webhook owns that, so a
// page refresh here can never fire a duplicate receipt.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "Missing session_id." }, { status: 400 });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });

  const stripe = new Stripe(key);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "This order has not been paid." }, { status: 402 });
    }

    const ctx = decodeOrderMetadata(session.metadata as Record<string, string>);
    if (!ctx) return NextResponse.json({ error: "Order details are unavailable." }, { status: 404 });

    const totals = totalsFor(ctx);
    const orderId = ctx.orderId || session.id;
    const pdf = await renderReceiptPdf(ctx.company, totals, ctx.when, orderId);

    return NextResponse.json({
      company: ctx.company,
      totals,
      orderId,
      pdfBase64: pdf.toString("base64"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    console.error("Receipt lookup failed:", message);
    return NextResponse.json({ error: "Could not load your receipt." }, { status: 502 });
  }
}
