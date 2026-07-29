// Booth-services order tracker (Google Sheets).
//
// Four tabs, per Jessica's spec:
//   Master         - one row per order: contact details, qty and $ of every
//                    service, subtotal, fee, total
//   Electric       - only companies that bought electric
//   Wi-Fi          - only companies that bought Wi-Fi
//   Lead Retrieval - only companies that bought lead retrieval
//
// The tab structure is created on demand by ensureStructure(), so the headers
// and the rows written below can never drift apart, and there is no manual
// setup step. No-ops silently when unconfigured: logging must never be the
// reason an order that was already paid for fails.
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
  "Subtotal", "Processing Fee", "Total", "Payment Status",
];

export const ELECTRIC_HEADERS = [
  "Order Date", "Company Name", "Contact", "Email Address", "Phone Number",
  "20-amp Outlets (Qty)", "Price per Outlet", "20-amp Outlets ($)",
  "Power Strips (Qty)", "Price per Strip", "Power Strips ($)",
  "Electric Total",
];

export const WIFI_HEADERS = [
  "Order Date", "Company Name", "Contact", "Email Address", "Phone Number",
  "Wi-Fi Devices (Qty)", "Price per Device", "Wi-Fi Total",
];

export const LEAD_HEADERS = [
  "Order Date", "Company Name", "Contact", "Email Address", "Phone Number",
  "Lead Retrieval (Qty)", "Pricing Tier", "Price", "Lead Retrieval Total",
];

// Which columns hold money on each tab (0-based), so they get a currency format.
const MONEY_COLUMNS: Record<string, number[]> = {
  [TABS.master]: [8, 10, 12, 14, 15, 16, 17],
  [TABS.electric]: [6, 7, 9, 10, 11],
  [TABS.wifi]: [6, 7],
  [TABS.lead]: [7, 8],
};

const HEADERS: Record<string, string[]> = {
  [TABS.master]: MASTER_HEADERS,
  [TABS.electric]: ELECTRIC_HEADERS,
  [TABS.wifi]: WIFI_HEADERS,
  [TABS.lead]: LEAD_HEADERS,
};

// Live totals parked to the right of each table. Kept entirely on row 1: an
// append uses INSERT_ROWS, which shifts anything sitting on row 2 or below,
// so a multi-row summary block would drift down with every order.
// INDIRECT keeps the ranges literal, so the totals stay correct even if someone
// later inserts or deletes rows by hand (a plain C2:C would be rewritten).
const SUMMARY: Record<string, { cell: string; row: string[]; moneyCol: number }> = {
  [TABS.master]: { cell: "U1", row: ["Orders", '=COUNTA(INDIRECT("C2:C"))', "Grand Total", '=SUM(INDIRECT("R2:R"))'], moneyCol: 23 },
  [TABS.electric]: { cell: "N1", row: ["Companies", '=COUNTA(INDIRECT("B2:B"))', "Electric Revenue", '=SUM(INDIRECT("L2:L"))'], moneyCol: 16 },
  [TABS.wifi]: { cell: "J1", row: ["Companies", '=COUNTA(INDIRECT("B2:B"))', "Wi-Fi Revenue", '=SUM(INDIRECT("H2:H"))'], moneyCol: 12 },
  [TABS.lead]: { cell: "K1", row: ["Companies", '=COUNTA(INDIRECT("B2:B"))', "Lead Retrieval Revenue", '=SUM(INDIRECT("I2:I"))'], moneyCol: 13 },
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

// Order timestamp in event-local (New York) time, in a form Sheets parses as a
// real datetime rather than text.
function orderStamp(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((acc, x) => { acc[x.type] = x.value; return acc; }, {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const ensured = new Set<string>();

// Creates any missing tab, writes the header row, freezes it, and applies
// number formats. Idempotent, and cached per warm instance.
export async function ensureStructure(
  sheets: sheets_v4.Sheets, sheetId: string, force = false,
): Promise<void> {
  if (!force && ensured.has(sheetId)) return;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existing = new Map(
    (meta.data.sheets || []).map((s) => [s.properties?.title || "", s.properties?.sheetId ?? -1]),
  );

  const wanted = Object.values(TABS);
  const missing = wanted.filter((t) => !existing.has(t));

  if (missing.length > 0) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    });
    for (const reply of created.data.replies || []) {
      const props = reply.addSheet?.properties;
      if (props?.title) existing.set(props.title, props.sheetId ?? -1);
    }
  }

  // Header rows and summary blocks.
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        ...wanted.map((tab) => ({ range: `${tab}!A1`, values: [HEADERS[tab]] })),
        ...wanted.map((tab) => ({ range: `${tab}!${SUMMARY[tab].cell}`, values: [SUMMARY[tab].row] })),
      ],
    },
  });

  // Bold frozen header, currency on money columns, date format on column A.
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
      // Plain body style for every data row, applied before the specific
      // formats below. Also repairs rows that previously inherited the header's
      // navy fill, which rendered white-on-navy and unreadable.
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
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: format } });
  }

  // Drop Google's default empty tab so the tracker is exactly the four tabs,
  // but only when it is genuinely empty, so nobody's data can be lost.
  for (const [title, gid] of existing) {
    if (wanted.includes(title as (typeof wanted)[number]) || gid < 0) continue;
    if (!/^Sheet ?1$/i.test(title)) continue;
    const probe = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${title}!A1:Z50` });
    if ((probe.data.values || []).length > 0) continue;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ deleteSheet: { sheetId: gid } }] },
    });
  }

  ensured.add(sheetId);
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
    await ensureStructure(sheets, sheetId);

    const stamp = orderStamp(input.when || new Date());
    const { first, last } = nameParts(company);
    const line = (key: string) => totals.lines.find((l) => l.key === key);
    const qty = (key: string) => line(key)?.qty ?? 0;
    const amt = (key: string) => line(key)?.amount ?? 0;
    const unit = (key: string) => line(key)?.unit ?? 0;
    const contact = [first, last].filter(Boolean).join(" ") || company.contact || "";

    const data: sheets_v4.Schema$ValueRange[] = [];

    data.push({
      range: `${TABS.master}!A:S`,
      values: [[
        stamp, orderId, company.company || "", first, last, company.email || "", company.phone || "",
        qty("amp20"), amt("amp20"),
        qty("powerstrip"), amt("powerstrip"),
        qty("wifi"), amt("wifi"),
        qty("lead"), amt("lead"),
        totals.subtotal, totals.fee, totals.total, paymentStatus,
      ]],
    });

    const electricTotal = amt("amp20") + amt("powerstrip");
    if (electricTotal > 0) {
      data.push({
        range: `${TABS.electric}!A:L`,
        values: [[
          stamp, company.company || "", contact, company.email || "", company.phone || "",
          qty("amp20"), unit("amp20"), amt("amp20"),
          qty("powerstrip"), unit("powerstrip"), amt("powerstrip"),
          electricTotal,
        ]],
      });
    }

    if (amt("wifi") > 0) {
      data.push({
        range: `${TABS.wifi}!A:H`,
        values: [[
          stamp, company.company || "", contact, company.email || "", company.phone || "",
          qty("wifi"), unit("wifi"), amt("wifi"),
        ]],
      });
    }

    if (amt("lead") > 0) {
      data.push({
        range: `${TABS.lead}!A:I`,
        values: [[
          stamp, company.company || "", contact, company.email || "", company.phone || "",
          qty("lead"), line("lead")?.detail || "", unit("lead"), amt("lead"),
        ]],
      });
    }

    // One append per tab; appendCells has no batch form.
    for (const range of data) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: range.range!,
        valueInputOption: "USER_ENTERED",
        // OVERWRITE, never INSERT_ROWS: an inserted row inherits the header
        // row's formatting (white bold text on navy) and shifts the summary
        // formulas' references down. Writing into the existing blank rows keeps
        // the column formats and leaves row 1 alone.
        insertDataOption: "OVERWRITE",
        requestBody: { values: range.values! },
      });
    }
  } catch (err) {
    console.error("Expo order logging failed:", err instanceof Error ? err.message : err);
  }
}
