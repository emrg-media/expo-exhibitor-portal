import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { alertOps, decodeOrderMetadata, renderReceiptPdf, sendOrderEmails, totalsFor } from "@/lib/order";
import { logOrder } from "@/lib/logOrder";
import { fmt } from "@/lib/pricing";

// Stripe calls this once payment actually succeeds, which is the only point at
// which we send a receipt. Signature is verified against STRIPE_WEBHOOK_SECRET,
// so an unsigned or replayed body is rejected.
export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !webhookSecret) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const stripe = new Stripe(key);
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "bad signature";
    console.error("Stripe webhook signature rejected:", message);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    return NextResponse.json({ received: true, ignored: `payment_status=${session.payment_status}` });
  }

  const ctx = decodeOrderMetadata(session.metadata as Record<string, string>);
  if (!ctx) {
    console.error("Stripe webhook: session", session.id, "had no order metadata");
    // 200 so Stripe stops retrying something we can never process.
    return NextResponse.json({ received: true, error: "no order metadata" });
  }

  // Idempotency: Stripe retries on any non-2xx, and can deliver more than once.
  // We mark the PaymentIntent after emailing and skip if the mark is present,
  // so a retry cannot send a second receipt.
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id;

  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.metadata?.expo_emailed === "1") {
        return NextResponse.json({ received: true, ignored: "already emailed" });
      }
    } catch (err) {
      // If the check itself fails, prefer sending over silently dropping the receipt.
      console.error("Stripe webhook: could not read payment intent", paymentIntentId, err instanceof Error ? err.message : err);
    }
  }

  const totals = totalsFor(ctx);
  // Belt and braces for sessions created before orders carried a site stamp:
  // an order from the other portal decodes to nothing we sell, and a real order
  // always has at least one line. Never email or log a zero-value receipt.
  if (totals.lines.length === 0) {
    console.error("Stripe webhook: session", session.id, "decoded to no line items, ignoring");
    return NextResponse.json({ received: true, ignored: "no line items for this site" });
  }

  const orderId = ctx.orderId || session.id;

  // Past this point the exhibitor has been charged. Nothing here may fail
  // quietly: a paid order that never reaches the receipt or the tracker is the
  // worst outcome this system has, so someone gets told.
  const problems: string[] = [];
  let pdf: Buffer | null = null;

  try {
    pdf = await renderReceiptPdf(ctx.company, totals, ctx.when, orderId);
  } catch (err) {
    problems.push(`receipt PDF failed: ${err instanceof Error ? err.message : err}`);
  }

  if (pdf) {
    const mail = await sendOrderEmails(ctx.company, totals, pdf, orderId);
    if (!mail.ok) problems.push(`confirmation email failed: ${mail.error}`);
  }

  const logged = await logOrder({
    company: ctx.company,
    totals,
    orderId,
    paymentStatus: "Paid",
    when: ctx.when,
  });
  if (!logged.ok) problems.push(`order tracker failed: ${logged.error}`);

  if (problems.length > 0) {
    await alertOps(orderId, problems, [
      `Company: ${ctx.company.company}`,
      `Contact: ${ctx.company.contact}`,
      `Email: ${ctx.company.email}`,
      `Phone: ${ctx.company.phone}`,
      ``,
      ...totals.lines.map((l) => `${l.label} x${l.qty} = ${fmt(l.amount)}`),
      ``,
      `Total paid: ${fmt(totals.total)}`,
      `Stripe session: ${session.id}`,
    ].join("\n"));
  }

  if (paymentIntentId) {
    try {
      await stripe.paymentIntents.update(paymentIntentId, { metadata: { expo_emailed: "1" } });
    } catch (err) {
      console.error("Stripe webhook: could not mark payment intent emailed:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ received: true, emailed: true });
}
