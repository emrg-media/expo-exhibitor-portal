import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import { TABS } from "@/lib/logOrder";
import { EVENT_TZ, currentLeadTier, toDateStr } from "@/lib/pricing";

// Opens the SMTP connection and authenticates, without sending anything.
// Checking that the variables merely exist is not worth much: a wrong app
// password looks perfectly healthy right up until a paid order gets no receipt.
async function verifySmtp(): Promise<{ verified: boolean; error?: string }> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return { verified: false, error: "not configured" };
  try {
    const port = parseInt(SMTP_PORT || "587");
    await nodemailer.createTransport({
      host: SMTP_HOST, port, secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 8000, greetingTimeout: 8000,
    }).verify();
    return { verified: true };
  } catch (err) {
    return { verified: false, error: err instanceof Error ? err.message.slice(0, 200) : "unknown error" };
  }
}

// SMTP_FROM may carry a display name: `The Event Planner Expo <a@b.com>`.
function fromAddress(v?: string): string {
  if (!v) return "";
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim().toLowerCase();
}

// Masked, so a public endpoint can confirm *which* mailbox is configured
// without publishing a staff address for scrapers.
function maskEmail(v?: string): string | undefined {
  const a = fromAddress(v);
  if (!a) return undefined;
  const [user, domain] = a.split("@");
  if (!domain) return "set";
  return `${user.slice(0, 2)}***@${domain}`;
}

// Configuration check for the deployed app: which integrations are wired up,
// and can the tracker actually be reached with the credentials in this
// environment. Reports presence and counts only, never values, so it is safe to
// leave public. Read-only: sends no email and writes no rows.
export async function GET(req: NextRequest) {
  const env = process.env;

  const tracker: Record<string, unknown> = {
    configured: Boolean(env.GOOGLE_SERVICE_ACCOUNT_KEY && env.EXPO_LOG_SHEET_ID),
  };

  if (tracker.configured) {
    try {
      const credentials = JSON.parse(Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY!, "base64").toString("utf8"));
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const sheets = google.sheets({ version: "v4", auth });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: env.EXPO_LOG_SHEET_ID! });
      const titles = (meta.data.sheets || []).map((s) => s.properties?.title || "");
      const expected = Object.values(TABS);

      const rows = await sheets.spreadsheets.values.get({
        spreadsheetId: env.EXPO_LOG_SHEET_ID!,
        range: `${TABS.master}!B2:B`,
      });

      tracker.reachable = true;
      tracker.tabsPresent = expected.every((t) => titles.includes(t));
      tracker.ordersLogged = (rows.data.values || []).flat().filter(Boolean).length;
    } catch (err) {
      tracker.reachable = false;
      // The message can name a missing sheet or a bad key, which is the whole
      // point of the check, but it never contains the credential itself.
      tracker.error = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    }
  }

  const smtp = await verifySmtp();

  // What this server would charge for lead retrieval right now, and the date it
  // is deciding that from. Tiers roll over at midnight in EVENT_TZ, so this is
  // how you confirm an increase landed when it was supposed to, without having
  // to place an order to find out.
  const now = new Date();
  const tier = currentLeadTier(now);
  const leadRetrieval = {
    timezone: EVENT_TZ,
    dateThere: toDateStr(now),
    price: tier ? tier.price : null,
    tier: tier ? tier.label : "closed",
  };

  const payments = {
    stripeKey: Boolean(env.STRIPE_SECRET_KEY),
    webhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
    // Both must be set before real orders: with a key but no webhook secret,
    // cards would be charged and no receipt would ever be sent.
    readyForLiveOrders: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
  };

  const email = {
    smtpConfigured: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
    smtpVerified: smtp.verified,
    // Which mailbox is authenticating, and which addresses it sends and
    // replies as. The three being out of step is a common misconfiguration.
    smtpUser: maskEmail(env.SMTP_USER),
    sendsAs: maskEmail(env.SMTP_FROM),
    repliesTo: maskEmail(env.SMTP_REPLY_TO),
    ...(smtp.error ? { smtpError: smtp.error } : {}),
    notifyRecipientSet: Boolean(env.EXPO_NOTIFY_EMAIL),
    // Gmail rewrites or rejects a From that is neither the authenticated
    // account nor a verified "Send mail as" alias.
    fromMatchesUser: !env.SMTP_FROM || fromAddress(env.SMTP_FROM) === (env.SMTP_USER || "").toLowerCase(),
    ...(env.SMTP_REPLY_TO ? { replyToSet: true } : {}),
  };

  // Everything that has to be true for a paid order to reach the customer.
  const ok = payments.readyForLiveOrders
    && email.smtpVerified
    && (!tracker.configured || tracker.reachable === true);

  // ?strict=1 answers 503 instead of 200 when something is broken, so an
  // ordinary uptime monitor can watch this URL and raise the alarm over SMS or
  // Slack. Deliberately not the default: the plain view is for reading.
  const strict = req.nextUrl.searchParams.get("strict") === "1";

  return NextResponse.json({ ok, payments, email, leadRetrieval, tracker }, {
    status: strict && !ok ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
