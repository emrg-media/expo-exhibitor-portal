import { NextRequest, NextResponse } from "next/server";
import { computeOrder, type OrderSelection } from "@/lib/pricing";
import { isValidOrderEmail, renderReceiptPdf, sendOrderEmails, type OrderCompany } from "@/lib/order";
import { logOrder } from "@/lib/logOrder";

// Direct submit with no payment step. Still used as the fallback while Stripe
// is not configured, so the form keeps working end to end without keys.
export async function POST(req: NextRequest) {
  const { company, selection, today } = (await req.json()) as {
    company: OrderCompany; selection: OrderSelection; today?: string;
  };

  const when = today ? new Date(today) : new Date();
  const totals = computeOrder(selection, when);

  if (totals.lines.length === 0) {
    return NextResponse.json({ error: "No services selected." }, { status: 400 });
  }
  if (!isValidOrderEmail(company?.email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const pdf = await renderReceiptPdf(company, totals, when);
  await sendOrderEmails(company, totals, pdf);
  await logOrder({
    company,
    totals,
    orderId: `EXPO-${Date.now().toString(36).toUpperCase()}`,
    paymentStatus: "Submitted (no payment)",
    when,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="expo-booth-services-receipt.pdf"' },
  });
}
