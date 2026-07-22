import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { createElement } from "react";
import { fmt, PROCESSING_FEE_RATE, EVENT_INFO, type OrderTotals } from "@/lib/pricing";

export interface ReceiptCompany {
  company: string; contact: string; email: string; phone: string;
}

// Palette matched to the website: Expo navy, cool grays, faint blue tint.
const C = {
  navy: "#000434",
  blue: "#1b3aa0",
  ink: "#0a0f1f",
  gray: "#414b61",
  light: "#8a92a6",
  border: "#dfe4ef",
  tint: "#f3f6fc",
  white: "#ffffff",
};

const PAD = 46;

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, color: C.ink, backgroundColor: C.white },

  // Full-bleed navy header band
  band: { backgroundColor: C.navy, paddingHorizontal: PAD, paddingTop: 34, paddingBottom: 30 },
  bandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  logo: { width: 150 },
  eyebrow: { color: "rgba(255,255,255,0.55)", fontSize: 8, letterSpacing: 1.6, marginTop: 14, fontFamily: "Helvetica-Bold" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, color: C.white, textAlign: "right", letterSpacing: 1 },
  titleSub: { fontSize: 9, color: "rgba(255,255,255,0.6)", textAlign: "right", marginTop: 4 },

  body: { paddingHorizontal: PAD, paddingTop: 26 },

  billRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  label: { fontSize: 8, letterSpacing: 1.2, color: C.light, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  name: { fontSize: 12, fontFamily: "Helvetica-Bold", color: C.ink },
  line: { fontSize: 9.5, color: C.gray, marginTop: 2 },
  metaVal: { fontSize: 10, color: C.ink, fontFamily: "Helvetica-Bold", textAlign: "right" },

  tHead: { flexDirection: "row", backgroundColor: C.navy, color: C.white, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 3 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 0.6 },
  tRow: { flexDirection: "row", borderBottomWidth: 0.75, borderColor: C.border, paddingVertical: 8, paddingHorizontal: 10 },
  cItem: { flex: 1 },
  cQty: { width: 44, textAlign: "right" },
  cUnit: { width: 74, textAlign: "right" },
  cAmt: { width: 80, textAlign: "right" },
  itemLabel: { fontSize: 10, color: C.ink, fontFamily: "Helvetica-Bold" },
  itemDetail: { fontSize: 8, color: C.light, marginTop: 1.5 },

  totals: { flexDirection: "row", justifyContent: "flex-end", marginTop: 18 },
  totalsBox: { width: 250, backgroundColor: C.tint, borderRadius: 8, padding: 14 },
  tr: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  trLabel: { fontSize: 10, color: C.gray },
  trVal: { fontSize: 10, textAlign: "right", color: C.ink },
  grand: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 9, marginTop: 6, borderTopWidth: 1, borderColor: C.navy },
  grandLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.navy, letterSpacing: 0.3 },
  grandVal: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right", color: C.navy },

  thanks: { marginTop: 26, fontSize: 10, color: C.gray },

  footer: { position: "absolute", bottom: 30, left: PAD, right: PAD, borderTopWidth: 0.75, borderColor: C.border, paddingTop: 10, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 8, color: C.light },
});

export function ReceiptPDF({ company, totals, logoBase64, dateStr }: {
  company: ReceiptCompany; totals: OrderTotals; logoBase64: string; dateStr: string;
}) {
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* Navy header band */}
        <View style={s.band}>
          <View style={s.bandRow}>
            <View>
              <Image src={`data:image/png;base64,${logoBase64}`} style={s.logo} />
              <Text style={s.eyebrow}>THE EVENT PLANNER EXPO 2026  ·  BOOTH SERVICES</Text>
            </View>
            <View>
              <Text style={s.title}>RECEIPT</Text>
              <Text style={s.titleSub}>{dateStr}</Text>
            </View>
          </View>
        </View>

        <View style={s.body}>
          <View style={s.billRow}>
            <View>
              <Text style={s.label}>BILL TO</Text>
              <Text style={s.name}>{company.company || "Exhibitor"}</Text>
              {company.contact ? <Text style={s.line}>{company.contact}</Text> : null}
              {company.email ? <Text style={s.line}>{company.email}</Text> : null}
              {company.phone ? <Text style={s.line}>{company.phone}</Text> : null}
            </View>
            <View>
              <Text style={s.label}>EVENT</Text>
              <Text style={s.metaVal}>{EVENT_INFO.dates}</Text>
              <Text style={[s.line, { textAlign: "right" }]}>{EVENT_INFO.location}</Text>
            </View>
          </View>

          <View style={s.tHead}>
            <Text style={[s.th, s.cItem]}>SERVICE</Text>
            <Text style={[s.th, s.cQty]}>QTY</Text>
            <Text style={[s.th, s.cUnit]}>UNIT</Text>
            <Text style={[s.th, s.cAmt]}>AMOUNT</Text>
          </View>
          {totals.lines.map((l) => (
            <View style={s.tRow} key={l.key}>
              <View style={s.cItem}>
                <Text style={s.itemLabel}>{l.label}</Text>
                {l.detail ? <Text style={s.itemDetail}>{l.detail}</Text> : null}
              </View>
              <Text style={s.cQty}>{l.qty}</Text>
              <Text style={s.cUnit}>{fmt(l.unit)}</Text>
              <Text style={s.cAmt}>{fmt(l.amount)}</Text>
            </View>
          ))}

          <View style={s.totals}>
            <View style={s.totalsBox}>
              <View style={s.tr}><Text style={s.trLabel}>Subtotal</Text><Text style={s.trVal}>{fmt(totals.subtotal)}</Text></View>
              <View style={s.tr}><Text style={s.trLabel}>Processing fee ({(PROCESSING_FEE_RATE * 100).toFixed(0)}%)</Text><Text style={s.trVal}>{fmt(totals.fee)}</Text></View>
              <View style={s.grand}><Text style={s.grandLabel}>Total Paid</Text><Text style={s.grandVal}>{fmt(totals.total)}</Text></View>
            </View>
          </View>

          <Text style={s.thanks}>Thank you for your order. We look forward to seeing you at The Event Planner Expo 2026.</Text>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>EMRG Media LLC  ·  Charges appear as EMRG Media LLC</Text>
          <Text style={s.footerText}>forms@theeventplannerexpo.com  ·  212.254.3700</Text>
        </View>
      </Page>
    </Document>
  );
}

export function buildReceiptDocument(props: { company: ReceiptCompany; totals: OrderTotals; logoBase64: string; dateStr: string }) {
  return createElement(ReceiptPDF, props);
}
