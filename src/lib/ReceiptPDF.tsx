import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { createElement } from "react";
import { fmt, PROCESSING_FEE_RATE, type OrderTotals } from "@/lib/pricing";

export interface ReceiptCompany {
  company: string; contact: string; email: string; phone: string; booth: string;
}

const C = { red: "#c0182a", black: "#111111", gray: "#57534e", light: "#a8a29e", border: "#d6d3d1", bg: "#fafaf9" };

const s = StyleSheet.create({
  page: { paddingHorizontal: 46, paddingVertical: 44, fontFamily: "Helvetica", fontSize: 10, color: C.black },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  logo: { width: 150 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20, textAlign: "right" },
  subtitle: { fontSize: 9, color: C.gray, textAlign: "right", marginTop: 3 },
  expo: { fontSize: 9, color: C.light, marginBottom: 20, letterSpacing: 1 },
  label: { fontSize: 8, letterSpacing: 1, color: C.light, marginBottom: 3, fontFamily: "Helvetica-Bold" },
  name: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  line: { fontSize: 9.5, color: C.gray, marginTop: 1 },
  billRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  tHead: { flexDirection: "row", backgroundColor: C.black, color: "#fff", paddingVertical: 5, paddingHorizontal: 7 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 0.5 },
  tRow: { flexDirection: "row", borderBottomWidth: 0.75, borderColor: C.border, paddingVertical: 6, paddingHorizontal: 7 },
  cItem: { flex: 1 },
  cQty: { width: 44, textAlign: "right" },
  cUnit: { width: 74, textAlign: "right" },
  cAmt: { width: 80, textAlign: "right" },
  totals: { flexDirection: "row", justifyContent: "flex-end", marginTop: 16 },
  totalsBox: { width: 240 },
  tr: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  trLabel: { fontSize: 10, color: C.gray },
  trVal: { fontSize: 10, textAlign: "right" },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderColor: C.black, marginTop: 3 },
  grandLabel: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  grandVal: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "right" },
  footer: { position: "absolute", bottom: 30, left: 46, right: 46, borderTopWidth: 0.75, borderColor: "#e7e5e4", paddingTop: 8, textAlign: "center", fontSize: 8, color: C.light },
});

export function ReceiptPDF({ company, totals, logoBase64, dateStr }: {
  company: ReceiptCompany; totals: OrderTotals; logoBase64: string; dateStr: string;
}) {
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.headerRow}>
          <Image src={`data:image/png;base64,${logoBase64}`} style={s.logo} />
          <View>
            <Text style={s.title}>RECEIPT</Text>
            <Text style={s.subtitle}>{dateStr}</Text>
          </View>
        </View>
        <Text style={s.expo}>THE EVENT PLANNER EXPO · BOOTH SERVICES</Text>

        <View style={s.billRow}>
          <View>
            <Text style={s.label}>BILL TO</Text>
            <Text style={s.name}>{company.company || "Exhibitor"}</Text>
            {company.contact ? <Text style={s.line}>{company.contact}</Text> : null}
            {company.email ? <Text style={s.line}>{company.email}</Text> : null}
            {company.phone ? <Text style={s.line}>{company.phone}</Text> : null}
          </View>
          {company.booth ? (
            <View>
              <Text style={s.label}>BOOTH</Text>
              <Text style={s.name}>{company.booth}</Text>
            </View>
          ) : null}
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
              <Text>{l.label}</Text>
              {l.detail ? <Text style={{ fontSize: 8, color: C.light }}>{l.detail}</Text> : null}
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

        <Text style={s.footer}>EMRG Media LLC · Charges appear as EMRG Media LLC · forms@theeventplannerexpo.com · 212.254.3700</Text>
      </Page>
    </Document>
  );
}

export function buildReceiptDocument(props: { company: ReceiptCompany; totals: OrderTotals; logoBase64: string; dateStr: string }) {
  return createElement(ReceiptPDF, props);
}
