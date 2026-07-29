import { NextResponse } from "next/server";
import { google } from "googleapis";
import { TABS } from "@/lib/logOrder";

// Configuration check for the deployed app: which integrations are wired up,
// and can the tracker actually be reached with the credentials in this
// environment. Reports presence and counts only, never values, so it is safe to
// leave public. Read-only: sends no email and writes no rows.
export async function GET() {
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

  return NextResponse.json({
    payments: {
      stripeKey: Boolean(env.STRIPE_SECRET_KEY),
      webhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
      // Both must be set before real orders: with a key but no webhook secret,
      // cards would be charged and no receipt would ever be sent.
      readyForLiveOrders: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
    },
    email: {
      smtpConfigured: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
      notifyRecipientSet: Boolean(env.EXPO_NOTIFY_EMAIL),
    },
    tracker,
  }, { headers: { "Cache-Control": "no-store" } });
}
