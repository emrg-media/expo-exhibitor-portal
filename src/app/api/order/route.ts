import { NextRequest, NextResponse } from "next/server";
import { computeOrder, sanitizeSelection, selectionTooLarge } from "@/lib/pricing";
import { isValidOrderEmail, newOrderId, renderReceiptPdf, sendOrderEmails, type OrderCompany } from "@/lib/order";
import { logOrder } from "@/lib/logOrder";

// Direct submit with no payment step: the development fallback that keeps the
// form working end to end before any Stripe keys exist.
//
// It is switched off the moment Stripe is configured. This endpoint is public
// and takes no payment, so on a live site it would let anyone send themselves a
// receipt and write rows into the tracker without ever paying.
export async function POST(req: NextRequest) {
  if (process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  let body: { company?: OrderCompany; selection?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const company = body?.company ?? ({} as OrderCompany);
  const selection = sanitizeSelection(body?.selection);

  // Always the server clock. A caller-supplied date would let the sender choose
  // which lead retrieval tier they are billed at.
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

  const orderId = newOrderId(when);
  const pdf = await renderReceiptPdf(company, totals, when, orderId);
  await sendOrderEmails(company, totals, pdf, orderId);
  await logOrder({
    company,
    totals,
    orderId,
    paymentStatus: "Submitted (no payment)",
    when,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="expo-booth-services-receipt.pdf"',
      // So the confirmation screen can show the same reference as the receipt.
      "X-Order-Id": orderId,
      "Access-Control-Expose-Headers": "X-Order-Id",
    },
  });
}
