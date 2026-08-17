// Shared order artifacts: receipt PDF + confirmation emails.
//
// Used by three routes so the same receipt and wording is produced everywhere:
//   /api/order          - legacy direct submit, used while Stripe is unconfigured
//   /api/stripe/webhook - sends the emails once payment actually succeeds
//   /api/receipt        - rebuilds the PDF for the confirmation screen (no emails)

import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import nodemailer from "nodemailer";
import { computeOrder, fmt, type OrderSelection, type OrderTotals } from "@/lib/pricing";
import { buildReceiptDocument, type ReceiptCompany } from "@/lib/ReceiptPDF";

/** Which of the two portals this build is. Stamped into Stripe metadata so the
 *  shared Stripe account cannot cross-deliver orders between them. */
export const SITE = "booth";

export const NOTIFY_EMAIL = process.env.EXPO_NOTIFY_EMAIL || "jstewart@emrgmedia.com";

export function isValidOrderEmail(email?: string): boolean {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

/**
 * Something went wrong after the card was charged. Email the details so the
 * order can be handled by hand, rather than leaving it in a log nobody reads.
 * Plain text with no attachment: the less this depends on, the more likely it
 * is to get through when something else has already failed.
 */
/**
 * Non-email alert channel. When email is the thing that has broken, an emailed
 * alarm cannot ring, which is exactly how three paid orders went out with no
 * receipt and nobody found out. Set EXPO_ALERT_WEBHOOK to a Slack or Discord
 * incoming webhook and the alarm survives an email outage.
 */
async function postAlertWebhook(text: string): Promise<void> {
  const url = process.env.EXPO_ALERT_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Slack reads `text`, Discord reads `content`. Sending both means one
      // variable works with either service without a code change.
      body: JSON.stringify({ text, content: text }),
    });
  } catch (err) {
    console.error("Alert webhook failed:", err instanceof Error ? err.message : err);
  }
}

export async function alertOps(orderId: string, problems: string[], detail: string): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  // Always first, and never conditional on SMTP working.
  await postAlertWebhook(
    `ACTION NEEDED: paid order ${orderId} was not fully processed.\n`
    + `What failed: ${problems.join("; ")}\n\n${detail}`,
  );

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error(`ALERT (no SMTP to send it): order ${orderId} had problems: ${problems.join("; ")}`);
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || "587"),
      secure: parseInt(SMTP_PORT || "587") === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: process.env.EXPO_ALERT_EMAIL || NOTIFY_EMAIL,
      subject: `ACTION NEEDED: paid booth order ${orderId} was not fully processed`,
      text: [
        `A booth services order was paid for, but part of the follow-up failed.`,
        `The customer has been charged. Please handle this one manually.`, "",
        `Order ID: ${orderId}`,
        `What failed: ${problems.join("; ")}`, "",
        `Order details:`,
        detail, "",
        `The payment itself is fine and visible in Stripe. This alert only means`,
        `the receipt email or the order tracker did not complete.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("ALERT could not be sent:", err instanceof Error ? err.message : err);
  }
}

export function receiptFilename(company: ReceiptCompany): string {
  return `expo-receipt-${(company.company || "booth").replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`;
}

export async function renderReceiptPdf(
  company: ReceiptCompany, totals: OrderTotals, when: Date, orderId: string,
): Promise<Buffer> {
  const dateStr = when.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const logoBase64 = readFileSync(join(process.cwd(), "public", "expo-logo-white.png")).toString("base64");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(buildReceiptDocument({ company, totals, logoBase64, dateStr, orderId }) as any);
}

// Sends the buyer confirmation and the internal notification. Never throws:
// a mail failure must not lose an order that has already been paid for.
export async function sendOrderEmails(
  company: ReceiptCompany, totals: OrderTotals, pdf: Buffer, orderId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  // Not configured is not a failure: nothing was promised.
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return { ok: true };

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || "587"),
      secure: parseInt(SMTP_PORT || "587") === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    const from = SMTP_FROM || SMTP_USER;
    // The account that authenticates does not have to be the one that answers.
    // Gmail only permits a From it owns or has verified, but Reply-To is free,
    // so receipts can come from a configured mailbox and still reach the team.
    const replyTo = process.env.SMTP_REPLY_TO || undefined;
    const itemLines = totals.lines.map((l) => `  ${l.label} (${l.qty} x ${fmt(l.unit)}) = ${fmt(l.amount)}`).join("\n");
    const attachments = [{ filename: receiptFilename(company), content: pdf, contentType: "application/pdf" }];

    // Order details grouped by category for the confirmation email.
    const electric = categoryDetail(totals, ["amp20", "powerstrip"]);
    const wifi = categoryDetail(totals, ["wifi"]);
    const lead = categoryDetail(totals, ["lead"]);
    const signoff = "Jessica Stewart, Erica Maurer and Mario Stewart";

    // Buyer confirmation (Jessica's template)
    await transporter.sendMail({
      from, to: company.email, attachments, replyTo,
      subject: "Your Event Planner Expo 2026 booth add-on order confirmation",
      text: [
        `Hi ${firstName(company.contact)},`, "",
        `Thank you for submitting your booth add-on order for The Event Planner Expo 2026.`, "",
        ...(orderId ? [`Order reference: ${orderId}`, ""] : []),
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
    ${orderId ? `<p style="margin:0 0 14px;font-size:13px;color:#414b61">Order reference: <strong style="color:#000434">${orderId}</strong></p>` : ""}
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

    // Internal notification
    await transporter.sendMail({
      from, to: NOTIFY_EMAIL, attachments, replyTo: company.email || replyTo,
      subject: `New booth order: ${company.company || "Exhibitor"} for ${fmt(totals.total)}${orderId ? ` (${orderId})` : ""}`,
      text: [
        `New booth services order.`, "",
        ...(orderId ? [`Order ID: ${orderId}`] : []),
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
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("Expo order email failed:", error);
    return { ok: false, error };
  }
}

// ── Stripe metadata round-trip ───────────────────────────────────────────────
// Stripe Checkout is stateless for us (no database), so the order rides along
// in session metadata and is rebuilt on the way back. Values must be strings
// and stay well under Stripe's 500-character-per-value limit.

// The receipt only needs a joined contact name, but the tracker wants the
// first and last name the exhibitor actually typed, so both travel together.
export type OrderCompany = ReceiptCompany & { firstName?: string; lastName?: string };

export interface OrderContext {
  company: OrderCompany;
  selection: OrderSelection;
  when: Date;
  orderId: string;
}

// Human-readable order reference, printed on the receipt and used as the key in
// the tracker. Generated once when checkout starts and carried in Stripe
// metadata, so the webhook, the confirmation screen and the sheet all agree.
// Ambiguous characters (I, O, 0, 1) are left out for reading off a printout.
export function newOrderId(when: Date = new Date()): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  const suffix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `EXPO-${when.getFullYear()}-${suffix}`;
}

export function encodeOrderMetadata(ctx: OrderContext): Record<string, string> {
  const { company, selection, when } = ctx;
  return {
    v: "1",
    // Both sites share one Stripe account, so every checkout event is delivered
    // to both webhook endpoints. This is how each one recognises its own.
    site: SITE,
    order_id: ctx.orderId,
    company: (company.company || "").slice(0, 480),
    contact: (company.contact || "").slice(0, 480),
    first: (company.firstName || "").slice(0, 240),
    last: (company.lastName || "").slice(0, 240),
    email: (company.email || "").slice(0, 480),
    phone: (company.phone || "").slice(0, 60),
    // a=20-amp outlets, s=power strips, w=wifi devices, l=lead retrieval
    sel: `a:${selection.amp20Qty},s:${selection.powerStripQty},w:${selection.wifiDevices},l:${selection.leadRetrieval ? 1 : 0}`,
    priced_at: when.toISOString(),
  };
}

export function decodeOrderMetadata(md: Record<string, string> | null | undefined): OrderContext | null {
  if (!md || !md.sel) return null;
  // An order stamped for the other site is not ours to process. Sessions
  // created before the stamp existed have no `site`, so those still decode.
  if (md.site && md.site !== SITE) return null;
  const nums: Record<string, number> = {};
  for (const part of md.sel.split(",")) {
    const [k, v] = part.split(":");
    nums[k] = parseInt(v) || 0;
  }
  const parsed = md.priced_at ? new Date(md.priced_at) : new Date();
  return {
    orderId: md.order_id || "",
    company: {
      company: md.company || "",
      contact: md.contact || "",
      firstName: md.first || "",
      lastName: md.last || "",
      email: md.email || "",
      phone: md.phone || "",
    },
    selection: {
      amp20Qty: nums.a || 0,
      powerStripQty: nums.s || 0,
      wifiDevices: nums.w || 0,
      leadRetrieval: (nums.l || 0) > 0,
    },
    when: isNaN(parsed.getTime()) ? new Date() : parsed,
  };
}

// Rebuild the priced order from a decoded context. Prices always come from the
// server-side table, never from anything the browser sent.
export function totalsFor(ctx: OrderContext): OrderTotals {
  return computeOrder(ctx.selection, ctx.when);
}
