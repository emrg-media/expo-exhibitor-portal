import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { computeOrder, fmt, PROCESSING_FEE_RATE, sanitizeSelection, selectionTooLarge } from "@/lib/pricing";
import { encodeOrderMetadata, isValidOrderEmail, newOrderId, type OrderCompany } from "@/lib/order";

// Creates a Stripe-hosted Checkout Session and hands back its URL for the
// browser to redirect to. Responds { configured: false } when no Stripe key is
// present so the form can fall back to the no-payment path instead of breaking.
export async function POST(req: NextRequest) {
  // This endpoint is public, so nothing in the body is trusted: quantities are
  // coerced to whole numbers and bounded before anything is priced.
  let body: { company?: OrderCompany; selection?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const company = body?.company ?? ({} as OrderCompany);
  const selection = sanitizeSelection(body?.selection);

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ configured: false });

  // Price on the server clock. The browser never gets to choose which lead
  // retrieval tier it pays, and never sends amounts.
  const when = new Date();
  const totals = computeOrder(selection, when);

  if (totals.lines.length === 0) {
    return NextResponse.json({ error: "No services selected." }, { status: 400 });
  }
  const tooLarge = selectionTooLarge(selection);
  if (tooLarge) {
    return NextResponse.json({ error: tooLarge }, { status: 400 });
  }
  if (!isValidOrderEmail(company?.email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = totals.lines.map((l) => ({
    quantity: l.qty,
    price_data: {
      currency: "usd",
      unit_amount: Math.round(l.unit * 100),
      product_data: {
        name: l.label,
        ...(l.detail ? { description: l.detail } : {}),
      },
    },
  }));

  // The processing fee is shown as its own line so the Stripe page adds up to
  // exactly what the order summary quoted.
  if (totals.fee > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: Math.round(totals.fee * 100),
        product_data: { name: `Credit card processing fee (${(PROCESSING_FEE_RATE * 100).toFixed(0)}%)` },
      },
    });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
  const stripe = new Stripe(key);
  // Minted once here and carried in metadata, so the receipt, the confirmation
  // screen and the tracker all show the same reference.
  const orderId = newOrderId(when);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      customer_email: company.email,
      // {CHECKOUT_SESSION_ID} is substituted by Stripe, leave it unencoded.
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      // Always bill in USD. The Stripe account has Adaptive Pricing on, which
      // was defaulting overseas exhibitors to their local currency (an
      // Indonesian IP was shown IDR 3,193,059.92 as the pre-selected option).
      // Our prices, receipt PDF and tracker are all USD, so a converted charge
      // would not match the paperwork Jessica reconciles against.
      adaptive_pricing: { enabled: false },
      metadata: encodeOrderMetadata({ company, selection, when, orderId }),
      payment_intent_data: {
        description: `${orderId} Expo 2026 booth services for ${company.company || "exhibitor"} (${fmt(totals.total)})`,
      },
    });

    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return NextResponse.json({ configured: true, url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    console.error("Stripe checkout session failed:", message);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
