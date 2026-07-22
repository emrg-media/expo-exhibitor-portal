import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import nodemailer from "nodemailer";
import { computeOrder, fmt, type OrderSelection, type OrderTotals } from "@/lib/pricing";
import { buildReceiptDocument, type ReceiptCompany } from "@/lib/ReceiptPDF";

const NOTIFY_EMAIL = process.env.EXPO_NOTIFY_EMAIL || "jstewart@emrgmedia.com";

// First name for the greeting, falling back to a friendly default.
function firstName(contact?: string): string {
  const n = (contact || "").trim().split(/\s+/)[0];
  return n || "there";
}

// One human line per service category, built from the order lines. Returns
// "Not ordered" when the exhibitor skipped that category.
function categoryDetail(totals: OrderTotals, keys: string[]): string {
  const picked = totals.lines.filter((l) => keys.includes(l.key));
  if (picked.length === 0) return "Not ordered";
  return picked.map((l) => `${l.qty} x ${l.label} (${fmt(l.amount)})`).join(", ");
}

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
  const logoBase64 = readFileSync(join(process.cwd(), "public", "expo-logo-white.png")).toString("base64");
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
      const itemLines = totals.lines.map((l) => `  ${l.label} (${l.qty} x ${fmt(l.unit)}) = ${fmt(l.amount)}`).join("\n");
      const filename = `expo-receipt-${(company.company || "booth").replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`;
      const attachments = [{ filename, content: pdf, contentType: "application/pdf" }];

      // Order details grouped by category for the confirmation email.
      const electric = categoryDetail(totals, ["amp20", "powerstrip"]);
      const wifi = categoryDetail(totals, ["wifi"]);
      const lead = categoryDetail(totals, ["lead"]);
      const signoff = "Jessica Stewart, Erica Maurer and Mario Stewart";

      // Buyer confirmation (Jessica's template)
      await transporter.sendMail({
        from, to: company.email, attachments,
        subject: "Your Event Planner Expo 2026 booth add-on order confirmation",
        text: [
          `Hi ${firstName(company.contact)},`, "",
          `Thank you for submitting your booth add-on order for The Event Planner Expo 2026.`, "",
          `Your order confirmation is as follows:`, "",
          `Electric: ${electric}`,
          `Wi-Fi: ${wifi}`,
          `Lead Retrieval: ${lead}`, "",
          `Total: ${fmt(totals.total)} (a detailed receipt is attached)`, "",
          `Stay tuned for additional information and instructions regarding your selected add-ons as we get closer to the Expo.`, "",
          `We look forward to seeing you at The Event Planner Expo 2026.`, "",
          `Best,`,
          signoff,
        ].join("\n"),
        html: `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1b2333;line-height:1.55;max-width:560px">
  <div style="background:#000434;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">
    <div style="font-size:12px;letter-spacing:1.5px;opacity:0.7">THE EVENT PLANNER EXPO 2026</div>
    <div style="font-size:19px;font-weight:bold;margin-top:4px">Booth Add-On Order Confirmation</div>
  </div>
  <div style="border:1px solid #d9deea;border-top:0;border-radius:0 0 12px 12px;padding:22px">
    <p style="margin:0 0 14px">Hi ${firstName(company.contact)},</p>
    <p style="margin:0 0 14px">Thank you for submitting your booth add-on order for The Event Planner Expo 2026.</p>
    <p style="margin:0 0 8px">Your order confirmation is as follows:</p>
    <table style="width:100%;border-collapse:collapse;margin:6px 0 16px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #eef1f7;font-weight:bold;width:120px">Electric</td><td style="padding:8px 0;border-bottom:1px solid #eef1f7">${electric}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eef1f7;font-weight:bold">Wi-Fi</td><td style="padding:8px 0;border-bottom:1px solid #eef1f7">${wifi}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eef1f7;font-weight:bold">Lead Retrieval</td><td style="padding:8px 0;border-bottom:1px solid #eef1f7">${lead}</td></tr>
      <tr><td style="padding:10px 0;font-weight:bold">Total</td><td style="padding:10px 0;font-weight:bold">${fmt(totals.total)}</td></tr>
    </table>
    <p style="margin:0 0 14px;font-size:13px;color:#414b61">A detailed receipt is attached to this email.</p>
    <p style="margin:0 0 14px">Stay tuned for additional information and instructions regarding your selected add-ons as we get closer to the Expo.</p>
    <p style="margin:0 0 14px">We look forward to seeing you at The Event Planner Expo 2026.</p>
    <p style="margin:0">Best,<br/>${signoff}</p>
  </div>
</div>`.trim(),
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
          `Cell Phone: ${company.phone}`, "",
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
