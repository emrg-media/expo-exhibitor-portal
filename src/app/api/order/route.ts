import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import nodemailer from "nodemailer";
import { computeOrder, fmt, type OrderSelection } from "@/lib/pricing";
import { buildReceiptDocument, type ReceiptCompany } from "@/lib/ReceiptPDF";

const NOTIFY_EMAIL = process.env.EXPO_NOTIFY_EMAIL || "jstewart@emrgmedia.com";

export async function POST(req: NextRequest) {
  const { company, selection, today } = (await req.json()) as {
    company: ReceiptCompany; selection: OrderSelection; today?: string;
  };

  const when = today ? new Date(today) : new Date();
  const totals = computeOrder(selection, when);

  if (totals.lines.length === 0) {
    return NextResponse.json({ error: "No services selected." }, { status: 400 });
  }
  if (!company?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const dateStr = when.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const logoBase64 = readFileSync(join(process.cwd(), "public", "expo-logo.png")).toString("base64");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await renderToBuffer(buildReceiptDocument({ company, totals, logoBase64, dateStr }) as any);

  // Send confirmation emails when SMTP is configured; never block the receipt on it.
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT || "587"),
        secure: parseInt(SMTP_PORT || "587") === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      const from = SMTP_FROM || SMTP_USER;
      const itemLines = totals.lines.map((l) => `  ${l.label} (${l.qty} x ${fmt(l.unit)}) — ${fmt(l.amount)}`).join("\n");
      const filename = `expo-receipt-${(company.company || "booth").replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`;
      const attachments = [{ filename, content: pdf, contentType: "application/pdf" }];

      // Buyer confirmation
      await transporter.sendMail({
        from, to: company.email, attachments,
        subject: "Your Event Planner Expo booth services receipt",
        text: [
          `Hi ${company.contact || "there"},`, "",
          `Thank you for your booth services order for The Event Planner Expo. Your receipt is attached.`, "",
          itemLines, "",
          `Subtotal: ${fmt(totals.subtotal)}`,
          `Processing fee: ${fmt(totals.fee)}`,
          `Total: ${fmt(totals.total)}`, "",
          `Questions? forms@theeventplannerexpo.com`,
          `EMRG Media`,
        ].join("\n"),
      });

      // Jessica notification
      await transporter.sendMail({
        from, to: NOTIFY_EMAIL, attachments,
        subject: `New booth order: ${company.company || "Exhibitor"} — ${fmt(totals.total)}`,
        text: [
          `New booth services order.`, "",
          `Company: ${company.company}`,
          `Contact: ${company.contact}`,
          `Email: ${company.email}`,
          `Phone: ${company.phone}`,
          `Booth: ${company.booth}`, "",
          itemLines, "",
          `Subtotal: ${fmt(totals.subtotal)}`,
          `Processing fee: ${fmt(totals.fee)}`,
          `Total: ${fmt(totals.total)}`,
        ].join("\n"),
      });
    } catch (err) {
      console.error("Expo order email failed:", err instanceof Error ? err.message : err);
    }
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="expo-booth-services-receipt.pdf"' },
  });
}
