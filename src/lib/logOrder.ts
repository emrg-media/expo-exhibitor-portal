// Booth-services order tracker (Google Sheets).
//
// Four tabs, per Jessica's spec:
//   Master         - one row per order: contact details, qty and $ of every
//                    service, subtotal, fee, total
//   Electric       - only companies that bought electric
//   Wi-Fi          - only companies that bought Wi-Fi
//   Lead Retrieval - only companies that bought lead retrieval
//
// Design notes, both learned from stress testing against the real sheet:
//
//  1. Only Master is written. The three service tabs are live FILTER formulas
//     over Master, so they can never disagree with it, need no writes, and
//     update themselves. One write per order also keeps us well inside Sheets'
//     60-writes-per-minute quota during a rush.
//
//  2. Concurrent appends silently lose rows. Six simultaneous appendCells calls
//     all returned HTTP 200 and only three rows survived: Sheets resolves "the
//     last row with data" against the same revision, so writers overwrite each
//     other and are still told they succeeded. Every write is therefore verified
//     by reading the unique Order ID back, and retried when it is missing.
//
// Values are written as explicitly typed cells, never parsed, so a company
// called "=1+1" stays text instead of becoming a live formula.
//
// No-ops silently when unconfigured: logging must never be the reason an order
// that has already been paid for fails.
//
// Env vars:
//   GOOGLE_SERVICE_ACCOUNT_KEY - base64-encoded service-account JSON
//   EXPO_LOG_SHEET_ID          - spreadsheet ID (share the sheet with the
//                                service-account email as Editor)

import { google, type sheets_v4 } from "googleapis";
import type { OrderTotals } from "./pricing";
import type { ReceiptCompany } from "./ReceiptPDF";

export const TABS = {
  master: "Master",
  electric: "Electric",
  wifi: "Wi-Fi",
  lead: "Lead Retrieval",
} as const;

export const MASTER_HEADERS = [
  "Order Date", "Order ID", "Company Name", "First Name", "Last Name", "Email Address", "Phone Number",
  "20-amp Outlets (Qty)", "20-amp Outlets ($)",
  "Power Strips (Qty)", "Power Strips ($)",
  "Wi-Fi Devices (Qty)", "Wi-Fi Devices ($)",
  "Lead Retrieval (Qty)", "Lead Retrieval ($)",
  "Subtotal", "Processing Fee", "Total", "Payment Status", "Lead Retrieval Tier",
];

export const ELECTRIC_HEADERS = [
  "Order Date", "Company Name", "Contact", "Email Address", "Phone Number",
  "20-amp Outlets (Qty)", "20-amp Outlets ($)",
  "Power Strips (Qty)", "Power Strips ($)",
  "Electric Total",
];

export const WIFI_HEADERS = [
  "Order Date", "Company Name", "Contact", "Email Address", "Phone Number",
  "Wi-Fi Devices (Qty)", "Wi-Fi Total",
];

export const LEAD_HEADERS = [
  "Order Date", "Company Name", "Contact", "Email Address", "Phone Number",
  "Lead Retrieval (Qty)", "Pricing Tier", "Lead Retrieval Total",
];

const HEADERS: Record<string, string[]> = {
  [TABS.master]: MASTER_HEADERS,
  [TABS.electric]: ELECTRIC_HEADERS,
  [TABS.wifi]: WIFI_HEADERS,
  [TABS.lead]: LEAD_HEADERS,
};

// Which columns hold money on each tab (0-based), so they get a currency format.
const MONEY_COLUMNS: Record<string, number[]> = {
  [TABS.master]: [8, 10, 12, 14, 15, 16, 17],
  [TABS.electric]: [6, 8, 9],
  [TABS.wifi]: [6],
  [TABS.lead]: [7],
};

// Shared prefix for the service views: date, company, contact, email, phone.
const WHO = 'Master!A2:A,Master!C2:C,Master!D2:D&" "&Master!E2:E,Master!F2:F,Master!G2:G';

// Each service tab is one spilling formula over Master, so a company appears on
// a service tab exactly when they bought that service.
const VIEW_FORMULAS: Record<string, string> = {
  [TABS.electric]:
    `=IFERROR(FILTER({${WHO},Master!H2:H,Master!I2:I,Master!J2:J,Master!K2:K,Master!I2:I+Master!K2:K},(Master!H2:H>0)+(Master!J2:J>0)),"")`,
  [TABS.wifi]:
    `=IFERROR(FILTER({${WHO},Master!L2:L,Master!M2:M},Master!L2:L>0),"")`,
  [TABS.lead]:
    `=IFERROR(FILTER({${WHO},Master!N2:N,Master!T2:T,Master!O2:O},Master!N2:N>0),"")`,
};

// Live totals parked to the right of each table, on row 1 so nothing can shift
// them. INDIRECT keeps the ranges literal even if rows are inserted by hand.
const SUMMARY: Record<string, { cell: string; row: string[]; moneyCol: number }> = {
  [TABS.master]: { cell: "V1", row: ["Orders", '=COUNTA(INDIRECT("C2:C"))', "Grand Total", '=SUM(INDIRECT("R2:R"))'], moneyCol: 24 },
  [TABS.electric]: { cell: "L1", row: ["Companies", '=COUNTA(INDIRECT("B2:B"))', "Electric Revenue", '=SUM(INDIRECT("J2:J"))'], moneyCol: 14 },
  [TABS.wifi]: { cell: "I1", row: ["Companies", '=COUNTA(INDIRECT("B2:B"))', "Wi-Fi Revenue", '=SUM(INDIRECT("G2:G"))'], moneyCol: 11 },
  [TABS.lead]: { cell: "J1", row: ["Companies", '=COUNTA(INDIRECT("B2:B"))', "Lead Retrieval Revenue", '=SUM(INDIRECT("H2:H"))'], moneyCol: 12 },
};

function client(): { sheets: sheets_v4.Sheets; sheetId: string } | null {
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.EXPO_LOG_SHEET_ID;
  if (!keyB64 || !sheetId) return null;
  const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), sheetId };
}

// Order timestamp as a Sheets serial number in event-local (New York) time. A
// number rather than a string so the cell can be written literally.
function orderSerial(d: Date): number {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((acc, x) => { acc[x.type] = x.value; return acc; }, {});
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const epoch = Date.UTC(1899, 11, 30); // Sheets' day-zero
  return (wall - epoch) / 86_400_000;
}

// Explicitly typed cell values: nothing the exhibitor typed is ever parsed.
function cell(v: string | number): sheets_v4.Schema$CellData {
  return typeof v === "number"
    ? { userEnteredValue: { numberValue: v } }
    : { userEnteredValue: { stringValue: v } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sheets allows 60 writes per minute per user, and a burst of exhibitors paying
// at once will exceed that. Retry on quota and transient server errors.
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const code = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
      const retryable = code === 429 || code === 500 || code === 503;
      if (!retryable || i === attempts - 1) break;
      const backoff = Math.min(2 ** i * 500, 8000) + Math.floor(Math.random() * 400);
      console.warn(`Sheets ${label}: ${code}, retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// Cached per warm instance. Holds the promise, not just the result, so several
// concurrent orders on the same instance await one setup instead of racing.
const ensured = new Map<string, Promise<Map<string, number>>>();

export async function ensureStructure(
  sheets: sheets_v4.Sheets, sheetId: string, force = false,
): Promise<Map<string, number>> {
  if (!force) {
    const cached = ensured.get(sheetId);
    if (cached) return cached;
  }
  const run = buildStructure(sheets, sheetId);
  ensured.set(sheetId, run);
  try {
    return await run;
  } catch (err) {
    ensured.delete(sheetId); // don't cache a failure
    throw err;
  }
}

async function buildStructure(
  sheets: sheets_v4.Sheets, sheetId: string,
): Promise<Map<string, number>> {
  const wanted = Object.values(TABS);

  const readMeta = async () => {
    const meta = await withRetry("get", () => sheets.spreadsheets.get({ spreadsheetId: sheetId }));
    return new Map(
      (meta.data.sheets || []).map((s) => [s.properties?.title || "", s.properties?.sheetId ?? -1]),
    );
  };

  let existing = await readMeta();
  const missing = wanted.filter((t) => !existing.has(t));

  // Already set up with the current schema: skip every write, so the steady
  // state costs one read. Comparing the header row also means a schema change
  // here repairs an existing sheet on the next order.
  if (missing.length === 0) {
    const head = await withRetry("head", () => sheets.spreadsheets.values.get({
      spreadsheetId: sheetId, range: `${TABS.master}!A1:T1`,
    }));
    const current = (head.data.values || [[]])[0] || [];
    if (MASTER_HEADERS.every((h, i) => current[i] === h)) {
      return new Map(wanted.map((t) => [t, existing.get(t) ?? -1]));
    }
  }

  if (missing.length > 0) {
    try {
      const created = await withRetry("addSheet", () => sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      }));
      for (const reply of created.data.replies || []) {
        const props = reply.addSheet?.properties;
        if (props?.title) existing.set(props.title, props.sheetId ?? -1);
      }
    } catch {
      // Another instance almost certainly created the tabs first (a duplicate
      // title is rejected). Re-read and carry on rather than losing the order.
      existing = await readMeta();
      const stillMissing = wanted.filter((t) => !existing.has(t));
      if (stillMissing.length > 0) throw new Error(`could not create tabs: ${stillMissing.join(", ")}`);
    }
  }

  // Headers, the service-view formulas, and the summary blocks. USER_ENTERED
  // here on purpose: this is our own content, never exhibitor input.
  await withRetry("headers", () => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        ...wanted.map((tab) => ({ range: `${tab}!A1`, values: [HEADERS[tab]] })),
        ...wanted.map((tab) => ({ range: `${tab}!${SUMMARY[tab].cell}`, values: [SUMMARY[tab].row] })),
        ...Object.entries(VIEW_FORMULAS).map(([tab, formula]) => ({ range: `${tab}!A2`, values: [[formula]] })),
      ],
    },
  }));

  const format: sheets_v4.Schema$Request[] = [];
  for (const tab of wanted) {
    const gid = existing.get(tab);
    if (gid === undefined || gid < 0) continue;
    format.push(
      {
        updateSheetProperties: {
          properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      // Plain body style for every data row, applied before the specific formats.
      {
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS[tab].length },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: false, foregroundColor: { red: 0, green: 0, blue: 0 } },
              backgroundColor: { red: 1, green: 1, blue: 1 },
            },
          },
          fields: "userEnteredFormat(textFormat,backgroundColor)",
        },
      },
      {
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              backgroundColor: { red: 0, green: 0.016, blue: 0.204 }, // Expo navy #000434
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(textFormat,backgroundColor,verticalAlignment)",
        },
      },
      {
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd hh:mm" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      },
      ...MONEY_COLUMNS[tab].map((col) => ({
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      })),
      // Summary labels bold, and its money cell as currency.
      {
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: SUMMARY[tab].moneyCol - 3, endColumnIndex: SUMMARY[tab].moneyCol + 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat",
        },
      },
      {
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: SUMMARY[tab].moneyCol, endColumnIndex: SUMMARY[tab].moneyCol + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      },
      {
        autoResizeDimensions: {
          dimensions: { sheetId: gid, dimension: "COLUMNS", startIndex: 0, endIndex: HEADERS[tab].length },
        },
      },
    );
  }
  if (format.length > 0) {
    await withRetry("format", () =>
      sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: format } }),
    );
  }

  // Drop Google's default empty tab so the tracker is exactly the four tabs,
  // but only when it is genuinely empty, so nobody's data can be lost.
  for (const [title, gid] of [...existing]) {
    if (wanted.includes(title as (typeof wanted)[number]) || gid < 0) continue;
    if (!/^Sheet ?1$/i.test(title)) continue;
    const probe = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${title}!A1:Z50` });
    if ((probe.data.values || []).length > 0) continue;
    await withRetry("deleteSheet", () => sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ deleteSheet: { sheetId: gid } }] },
    }));
    existing.delete(title);
  }

  return new Map(wanted.map((t) => [t, existing.get(t) ?? -1]));
}

export interface LogOrderInput {
  company: ReceiptCompany & { firstName?: string; lastName?: string };
  totals: OrderTotals;
  orderId: string;
  paymentStatus: string;
  when?: Date;
}

// Splits a joined contact name when the form's separate fields aren't available.
function nameParts(c: LogOrderInput["company"]): { first: string; last: string } {
  if (c.firstName || c.lastName) return { first: c.firstName || "", last: c.lastName || "" };
  const words = (c.contact || "").trim().split(/\s+/).filter(Boolean);
  return { first: words[0] || "", last: words.slice(1).join(" ") };
}

export async function logOrder(input: LogOrderInput): Promise<void> {
  const conn = client();
  if (!conn) return;
  const { sheets, sheetId } = conn;
  const { company, totals, orderId, paymentStatus } = input;

  try {
    const gids = await ensureStructure(sheets, sheetId);
    const masterGid = gids.get(TABS.master);
    if (masterGid === undefined || masterGid < 0) throw new Error("Master tab unavailable");

    const { first, last } = nameParts(company);
    const line = (key: string) => totals.lines.find((l) => l.key === key);
    const qty = (key: string) => line(key)?.qty ?? 0;
    const amt = (key: string) => line(key)?.amount ?? 0;

    const row: Array<string | number> = [
      orderSerial(input.when || new Date()), orderId,
      company.company || "", first, last, company.email || "", company.phone || "",
      qty("amp20"), amt("amp20"),
      qty("powerstrip"), amt("powerstrip"),
      qty("wifi"), amt("wifi"),
      qty("lead"), amt("lead"),
      totals.subtotal, totals.fee, totals.total, paymentStatus,
      line("lead")?.detail || "",
    ];

    // Write, then confirm the Order ID actually landed. Concurrent writers
    // overwrite each other while still reporting success, so the read-back is
    // the only way to know the order was recorded.
    for (let attempt = 0; attempt < 4; attempt++) {
      await withRetry("append", () => sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            appendCells: { sheetId: masterGid, rows: [{ values: row.map(cell) }], fields: "userEnteredValue" },
          }],
        },
      }));

      await sleep(400 + attempt * 400);
      const check = await withRetry("verify", () => sheets.spreadsheets.values.get({
        spreadsheetId: sheetId, range: `${TABS.master}!B2:B`,
      }));
      const hits = (check.data.values || []).flat().filter((v) => v === orderId).length;

      if (hits === 1) return;
      if (hits > 1) {
        console.warn(`Expo order ${orderId} recorded ${hits} times; de-duplicate in the tracker.`);
        return;
      }
      console.warn(`Expo order ${orderId} was overwritten by a concurrent write, retrying (${attempt + 1}/4)`);
    }
    console.error(`Expo order ${orderId} could not be recorded in the tracker after 4 attempts`);
  } catch (err) {
    console.error("Expo order logging failed:", err instanceof Error ? err.message : err);
  }
}
