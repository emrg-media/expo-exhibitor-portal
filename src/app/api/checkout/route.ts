import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { computeOrder, fmt, PROCESSING_FEE_RATE, type OrderSelection } from "@/lib/pricing";
import type { ReceiptCompany } from "@/lib/ReceiptPDF";
import { encodeOrderMetadata, isValidOrderEmail } from "@/lib/order";

// Creates a Stripe-hosted Checkout Session and hands back its URL for the
// browser to redirect to. Responds { configured: false } when no Stripe key is
// present so the form can fall back to the no-payment path instead of breaking.
export async function POST(req: NextRequest) {
  const { company, selection } = (await req.json()) as {
    company: ReceiptCompany; selection: OrderSelection;
  };

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ configured: false });

  // Price on the server clock. The browser never gets to choose which lead
  // retrieval tier it pays, and never sends amounts.
  const when = new Date();
  const totals = computeOrder(selection, when);

  if (totals.lines.length === 0) {
    return NextResponse.json({ error: "No services selected." }, { status: 400 });
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

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      customer_email: company.email,
      // {CHECKOUT_SESSION_ID} is substituted by Stripe, leave it unencoded.
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      metadata: encodeOrderMetadata({ company, selection, when }),
      payment_intent_data: {
        description: `Expo 2026 booth services for ${company.company || "exhibitor"} (${fmt(totals.total)})`,
      },
    });

    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return NextResponse.json({ configured: true, url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    console.error("Stripe checkout session failed:", message);
    return NextResponse.json({ error: "Could not start checkout.", detail: message }, { status: 502 });
  }
}
