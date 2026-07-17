"use client";

import { useEffect, useState } from "react";
import {
  LEAD_TIERS, ELECTRIC, WIFI_PER_DEVICE, PROCESSING_FEE_RATE,
  computeOrder, currentLeadTier, tierStatus, fmt,
  type OrderSelection,
} from "@/lib/pricing";

export default function BoothServicesPage() {
  // Start from a same-day value on both server and client to avoid a hydration
  // mismatch; the ?preview=YYYY-MM-DD override (used to demo how tiers gray out
  // across the season) is applied only after mount, client-side.
  const [today, setToday] = useState<Date>(() => new Date());
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p && /^\d{4}-\d{2}-\d{2}$/.test(p)) {
      const [y, m, d] = p.split("-").map(Number);
      setToday(new Date(y, m - 1, d));
    }
  }, []);
  const [company, setCompany] = useState({ company: "", contact: "", email: "", phone: "", booth: "" });
  const [sel, setSel] = useState<OrderSelection>({ amp20Qty: 0, powerStripQty: 0, wifiDevices: 0, leadRetrieval: false });
  const [submitting, setSubmitting] = useState(false);

  const totals = computeOrder(sel, today);
  const leadTier = currentLeadTier(today);
  const leadClosed = leadTier === null;

  function setQty(key: keyof OrderSelection, v: number) {
    setSel((p) => ({ ...p, [key]: Math.max(0, v) }));
  }

  const canSubmit =
    company.company.trim() && company.email.trim() && totals.lines.length > 0 && !submitting;

  async function handleContinue() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Interim (pre-Stripe): place the order, generate the receipt, send emails.
      // When Stripe is wired, this instead creates a Checkout session and redirects.
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, selection: sel, today: today.toISOString() }),
      });
      if (!res.ok) throw new Error("Order failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "expo-booth-services-receipt.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#f5f4f2" }}>
      <div style={{ height: 4, background: "var(--emrg-red)" }} />
      <header style={{ background: "var(--emrg-black)" }} className="text-white px-6 md:px-10 py-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-[10px] tracking-[0.28em] uppercase text-white/50">The Event Planner Expo</p>
          <h1 className="text-2xl md:text-[28px] font-bold tracking-tight mt-1">Booth Services</h1>
          <p className="text-[13px] text-white/60 mt-1">Order electricity, Wi-Fi, and lead retrieval for your booth. Pay once, get instant confirmation.</p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-6">

        {/* Exhibitor info */}
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <SectionTitle n={1}>Your Company</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <Field label="Company name" required value={company.company} onChange={(v) => setCompany({ ...company, company: v })} placeholder="Acme Events" />
            <Field label="Booth number" value={company.booth} onChange={(v) => setCompany({ ...company, booth: v })} placeholder="e.g. 214" />
            <Field label="Contact name" value={company.contact} onChange={(v) => setCompany({ ...company, contact: v })} placeholder="Jane Smith" />
            <Field label="Phone" value={company.phone} onChange={(v) => setCompany({ ...company, phone: v })} placeholder="(212) 555 0100" />
            <div className="sm:col-span-2">
              <Field label="Email" required value={company.email} onChange={(v) => setCompany({ ...company, email: v })} placeholder="jane@acme.com" />
            </div>
          </div>
        </section>

        {/* Electricity */}
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <SectionTitle n={2}>Electricity</SectionTitle>
          <p className="text-[12.5px] text-stone-500 mt-1 mb-4">Each 20-amp outlet covers up to 1700W. For 1800W or more, order two.</p>
          <QtyRow label="20-amp outlet" price={`${fmt(ELECTRIC.amp20Price)} each`} value={sel.amp20Qty} onChange={(v) => setQty("amp20Qty", v)} />
          <QtyRow label="Power strip" price={`${fmt(ELECTRIC.powerStripPrice)} per cord`} value={sel.powerStripQty} onChange={(v) => setQty("powerStripQty", v)} />
        </section>

        {/* Wi-Fi */}
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <SectionTitle n={3}>Wi-Fi</SectionTitle>
          <p className="text-[12.5px] text-stone-500 mt-1 mb-4">{fmt(WIFI_PER_DEVICE)} per device. Choose how many devices need Wi-Fi.</p>
          <QtyRow label="Wi-Fi devices" price={`${fmt(WIFI_PER_DEVICE)} per device`} value={sel.wifiDevices} onChange={(v) => setQty("wifiDevices", v)} />
        </section>

        {/* Lead Retrieval */}
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <SectionTitle n={4}>Lead Retrieval (Crowd Pass)</SectionTitle>
          <p className="text-[12.5px] text-stone-500 mt-1 mb-4">
            Pricing rises as the event approaches. {leadClosed
              ? "Registration for this pricing has closed."
              : <>Today&apos;s price is <span className="font-semibold" style={{ color: "var(--emrg-red)" }}>{fmt(leadTier!.price)}</span>. Earlier pricing has passed.</>}
          </p>

          <div className="rounded-lg border border-stone-200 overflow-hidden mb-4">
            {LEAD_TIERS.map((tier) => {
              const status = tierStatus(tier, today);
              const past = status === "past";
              const current = status === "current";
              return (
                <div key={tier.id}
                  className="flex items-center justify-between px-4 py-2.5 border-b border-stone-100 last:border-0"
                  style={{
                    background: current ? "#fdf0e9" : "transparent",
                    opacity: past ? 0.45 : 1,
                  }}>
                  <span className="text-[14px]" style={{ textDecoration: past ? "line-through" : "none", fontWeight: current ? 700 : 400 }}>
                    {tier.label}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-[14px]" style={{ textDecoration: past ? "line-through" : "none", fontWeight: current ? 700 : 500, color: current ? "var(--emrg-red)" : "#111" }}>
                      {fmt(tier.price)}
                    </span>
                    {past && <span className="text-[9px] font-bold tracking-wider uppercase text-stone-400">Closed</span>}
                    {current && <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded text-white" style={{ background: "var(--emrg-red)" }}>Today</span>}
                    {status === "upcoming" && <span className="text-[9px] font-bold tracking-wider uppercase text-stone-300">Upcoming</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {!leadClosed && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={sel.leadRetrieval} onChange={(e) => setSel({ ...sel, leadRetrieval: e.target.checked })}
                className="h-5 w-5" style={{ accentColor: "var(--emrg-red)" }} />
              <span className="text-[14px]">Add Lead Retrieval at today&apos;s price ({fmt(leadTier!.price)})</span>
            </label>
          )}
        </section>

        {/* Summary */}
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <SectionTitle>Order Summary</SectionTitle>
          <div className="mt-4">
            {totals.lines.length === 0 ? (
              <p className="text-[13px] text-stone-400 py-3">Select the services you need above.</p>
            ) : (
              <div className="space-y-2">
                {totals.lines.map((l) => (
                  <div key={l.key} className="flex items-center justify-between text-[14px]">
                    <span>{l.label} <span className="text-stone-400">({l.qty} x {fmt(l.unit)})</span></span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(l.amount)}</span>
                  </div>
                ))}
                <div className="border-t border-stone-200 pt-2 mt-2 space-y-1">
                  <div className="flex justify-between text-[14px] text-stone-500"><span>Subtotal</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(totals.subtotal)}</span></div>
                  <div className="flex justify-between text-[14px] text-stone-500"><span>Processing fee ({(PROCESSING_FEE_RATE * 100).toFixed(0)}%)</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(totals.fee)}</span></div>
                  <div className="flex justify-between text-[18px] font-bold pt-1"><span>Total</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(totals.total)}</span></div>
                </div>
              </div>
            )}
          </div>

          <button onClick={handleContinue} disabled={!canSubmit}
            className="w-full mt-5 py-3.5 text-[14px] font-bold tracking-[0.16em] uppercase rounded-lg text-white transition-opacity disabled:opacity-40"
            style={{ background: "var(--emrg-red)" }}>
            {submitting ? "Processing…" : totals.total > 0 ? `Continue to Payment · ${fmt(totals.total)}` : "Continue to Payment"}
          </button>
          <p className="text-[11.5px] text-stone-400 text-center mt-2">Secure card payment. You will receive a receipt by email.</p>
        </section>

        <p className="text-center text-[11px] text-stone-400 pb-6">EMRG Media · The Event Planner Expo · Questions? forms@theeventplannerexpo.com</p>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ n, children }: { n?: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      {n && <span className="flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold text-white" style={{ background: "var(--emrg-black)" }}>{n}</span>}
      <h2 className="text-[15px] font-bold tracking-tight">{children}</h2>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold tracking-[0.14em] uppercase text-stone-600 mb-1.5">
        {label}{required && <span style={{ color: "var(--emrg-red)" }}> *</span>}
      </label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border-2 border-stone-300 rounded-lg px-3.5 py-2.5 text-[15px] bg-white text-stone-900 placeholder-stone-400 outline-none focus:border-[color:var(--emrg-red)]" />
    </div>
  );
}

function QtyRow({ label, price, value, onChange }: {
  label: string; price: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-t border-stone-100 first:border-0">
      <div>
        <p className="text-[14.5px] font-medium">{label}</p>
        <p className="text-[12px] text-stone-400">{price}</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(value - 1)} disabled={value <= 0}
          className="w-8 h-8 rounded-md border border-stone-300 text-stone-600 text-lg leading-none disabled:opacity-30" aria-label={`Decrease ${label}`}>−</button>
        <input value={value} onChange={(e) => onChange(parseInt(e.target.value.replace(/[^0-9]/g, "")) || 0)}
          className="w-14 text-center border border-stone-300 rounded-md py-1.5 text-[15px]" inputMode="numeric" />
        <button onClick={() => onChange(value + 1)}
          className="w-8 h-8 rounded-md border border-stone-300 text-stone-600 text-lg leading-none" aria-label={`Increase ${label}`}>+</button>
      </div>
    </div>
  );
}
