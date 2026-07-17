"use client";

import { useEffect, useState } from "react";
import {
  LEAD_TIERS, ELECTRIC, EVENT_DAYS, WIFI_PER_DEVICE, PROCESSING_FEE_RATE,
  computeOrder, currentLeadTier, tierStatus, fmt,
  type OrderSelection,
} from "@/lib/pricing";

export default function BoothServicesPage() {
  // Same-day value on server and client to avoid a hydration mismatch; the
  // ?preview=YYYY-MM-DD override (to demo how tiers gray out) applies after mount.
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

  const amp20Unit = ELECTRIC.amp20Price * (ELECTRIC.amp20PerDay ? EVENT_DAYS : 1);
  const amp20Amount = sel.amp20Qty * amp20Unit;
  const stripAmount = sel.powerStripQty * ELECTRIC.powerStripPrice;
  const electricitySubtotal = amp20Amount + stripAmount;
  const wifiAmount = sel.wifiDevices * WIFI_PER_DEVICE;

  function setQty(key: keyof OrderSelection, v: number) {
    setSel((p) => ({ ...p, [key]: Math.max(0, v) }));
  }

  const canSubmit = company.company.trim() && company.email.trim() && totals.lines.length > 0 && !submitting;

  async function handleContinue() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
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
    <div className="min-h-screen">
      {/* Hero */}
      <header className="hero-gradient text-white">
        <div className="max-w-2xl mx-auto px-6 md:px-8 pt-14 pb-16">
          <p className="text-[10.5px] tracking-[0.34em] uppercase text-white/45 mb-3">The Event Planner Expo</p>
          <h1 className="text-[34px] md:text-[42px] font-bold tracking-[-0.02em] leading-[1.05]">Booth Services</h1>
          <p className="text-[14.5px] text-white/55 mt-3 max-w-md leading-relaxed">
            Order electricity, Wi-Fi, and lead retrieval for your booth. Select what you need, pay securely, and get an instant receipt by email.
          </p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 md:px-8 -mt-8 pb-16 space-y-5">

        {/* Company */}
        <section className="premium-card p-6 md:p-7">
          <StepTitle n={1}>Your Company</StepTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
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
        <section className="premium-card p-6 md:p-7">
          <StepTitle n={2} note={electricitySubtotal > 0 ? fmt(electricitySubtotal) : undefined}>Electricity</StepTitle>
          <p className="text-[12.5px] text-[color:var(--ink-soft)] mt-1.5 mb-1">Each 20-amp outlet covers up to 1700W. For 1800W or more, order two.</p>
          <QtyRow label="20-amp outlet" unitLabel={`${fmt(amp20Unit)} each`} value={sel.amp20Qty} lineTotal={amp20Amount} onChange={(v) => setQty("amp20Qty", v)} />
          <QtyRow label="Power strip" unitLabel={`${fmt(ELECTRIC.powerStripPrice)} per cord`} value={sel.powerStripQty} lineTotal={stripAmount} onChange={(v) => setQty("powerStripQty", v)} />
        </section>

        {/* Wi-Fi */}
        <section className="premium-card p-6 md:p-7">
          <StepTitle n={3} note={wifiAmount > 0 ? fmt(wifiAmount) : undefined}>Wi-Fi</StepTitle>
          <p className="text-[12.5px] text-[color:var(--ink-soft)] mt-1.5 mb-1">{fmt(WIFI_PER_DEVICE)} per device. Choose how many devices need Wi-Fi.</p>
          <QtyRow label="Wi-Fi devices" unitLabel={`${fmt(WIFI_PER_DEVICE)} per device`} value={sel.wifiDevices} lineTotal={wifiAmount} onChange={(v) => setQty("wifiDevices", v)} />
        </section>

        {/* Lead Retrieval */}
        <section className="premium-card p-6 md:p-7">
          <StepTitle n={4}>Lead Retrieval</StepTitle>
          <p className="text-[12.5px] text-[color:var(--ink-soft)] mt-1.5 mb-4">
            Crowd Pass pricing rises as the event approaches. {leadClosed
              ? "Registration for this pricing has closed."
              : <>Today you pay <span className="font-semibold" style={{ color: "var(--emrg-red)" }}>{fmt(leadTier!.price)}</span>.</>}
          </p>

          <div className="rounded-2xl border border-stone-200/80 overflow-hidden mb-4 divide-y divide-stone-100">
            {LEAD_TIERS.map((tier) => {
              const status = tierStatus(tier, today);
              const past = status === "past";
              const current = status === "current";
              return (
                <div key={tier.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors"
                  style={current
                    ? { background: "linear-gradient(90deg, rgba(192,24,42,0.07), rgba(192,24,42,0.02))", boxShadow: "inset 3px 0 0 var(--emrg-red)" }
                    : undefined}>
                  {/* Date, given its own clear treatment */}
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold tracking-[0.16em] uppercase mb-0.5"
                      style={{ color: current ? "var(--emrg-red)" : past ? "#b8b0a7" : "#a8a29a" }}>
                      {current ? "Today" : past ? "Closed" : "Upcoming"}
                    </span>
                    <span className="text-[14.5px] tracking-tight"
                      style={{ color: past ? "#b8b0a7" : "#16130f", fontWeight: current ? 700 : 500, textDecoration: past ? "line-through" : "none" }}>
                      {tier.label}
                    </span>
                  </div>
                  <span className="text-[16px] tabular-nums"
                    style={{ color: current ? "var(--emrg-red)" : past ? "#b8b0a7" : "#16130f", fontWeight: current ? 700 : 600, textDecoration: past ? "line-through" : "none" }}>
                    {fmt(tier.price)}
                  </span>
                </div>
              );
            })}
          </div>

          {!leadClosed && (
            <label className="flex items-center gap-3 cursor-pointer rounded-xl border-2 px-4 py-3 transition-colors"
              style={{ borderColor: sel.leadRetrieval ? "var(--emrg-red)" : "#e7e2da", background: sel.leadRetrieval ? "rgba(192,24,42,0.03)" : "transparent" }}>
              <input type="checkbox" checked={sel.leadRetrieval} onChange={(e) => setSel({ ...sel, leadRetrieval: e.target.checked })} className="h-5 w-5" />
              <span className="text-[14px] font-medium">Add Lead Retrieval at today&apos;s price</span>
              <span className="ml-auto text-[15px] font-bold tabular-nums" style={{ color: "var(--emrg-red)" }}>{fmt(leadTier!.price)}</span>
            </label>
          )}
        </section>

        {/* Summary */}
        <section className="premium-card p-6 md:p-7" style={{ boxShadow: "var(--card-shadow-lg)" }}>
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[color:var(--ink-soft)]">Order Summary</p>
          <div className="mt-4">
            {totals.lines.length === 0 ? (
              <p className="text-[13.5px] text-stone-400 py-4 text-center">Select the services you need above to see your total.</p>
            ) : (
              <div className="space-y-2.5">
                {totals.lines.map((l) => (
                  <div key={l.key} className="flex items-baseline justify-between text-[14px]">
                    <span className="text-stone-700">{l.label} <span className="text-stone-400 text-[13px]">{l.qty} x {fmt(l.unit)}</span></span>
                    <span className="tabular-nums font-medium">{fmt(l.amount)}</span>
                  </div>
                ))}
                <div className="border-t border-stone-200 pt-3 mt-3 space-y-1.5">
                  <div className="flex justify-between text-[13.5px] text-[color:var(--ink-soft)]"><span>Subtotal</span><span className="tabular-nums">{fmt(totals.subtotal)}</span></div>
                  <div className="flex justify-between text-[13.5px] text-[color:var(--ink-soft)]"><span>Processing fee ({(PROCESSING_FEE_RATE * 100).toFixed(0)}%)</span><span className="tabular-nums">{fmt(totals.fee)}</span></div>
                  <div className="flex justify-between items-baseline pt-2"><span className="text-[17px] font-bold">Total</span><span className="text-[22px] font-bold tabular-nums tracking-tight">{fmt(totals.total)}</span></div>
                </div>
              </div>
            )}
          </div>

          <button onClick={handleContinue} disabled={!canSubmit}
            className="cta-gradient w-full mt-6 py-4 text-[13.5px] font-bold tracking-[0.16em] uppercase rounded-xl text-white disabled:text-stone-500">
            {submitting ? "Processing…" : totals.total > 0 ? `Continue to Payment  ${fmt(totals.total)}` : "Continue to Payment"}
          </button>
          <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-stone-400 mt-3">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M4 7V5a4 4 0 0 1 8 0v2m-9 0h10v7H3V7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
            Secure card payment. Receipt sent to your email.
          </p>
        </section>

        <p className="text-center text-[11px] text-stone-400 pt-2 pb-4">EMRG Media &nbsp;·&nbsp; The Event Planner Expo &nbsp;·&nbsp; forms@theeventplannerexpo.com</p>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepTitle({ n, note, children }: { n: number; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-bold text-white shrink-0"
        style={{ background: "linear-gradient(160deg, #2a2521, #0d0b0a)" }}>{n}</span>
      <h2 className="text-[16px] font-bold tracking-tight">{children}</h2>
      {note && <span className="ml-auto text-[15px] font-bold tabular-nums tracking-tight">{note}</span>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10.5px] font-bold tracking-[0.14em] uppercase text-[color:var(--ink-soft)] mb-1.5">
        {label}{required && <span style={{ color: "var(--emrg-red)" }}> *</span>}
      </label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-stone-300/90 rounded-xl px-3.5 py-2.5 text-[15px] bg-white text-stone-900 placeholder-stone-300 transition-shadow" />
    </div>
  );
}

function QtyRow({ label, unitLabel, value, lineTotal, onChange }: {
  label: string; unitLabel: string; value: number; lineTotal: number; onChange: (v: number) => void;
}) {
  const active = value > 0;
  return (
    <div className="flex items-center gap-3 py-3.5 border-t border-stone-100 first:border-0">
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold tracking-tight">{label}</p>
        <p className="text-[12px] text-stone-400">{unitLabel}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center rounded-xl border border-stone-200 bg-stone-50/60 p-0.5">
          <button onClick={() => onChange(value - 1)} disabled={value <= 0}
            className="w-8 h-8 rounded-lg text-stone-600 text-lg leading-none hover:bg-white disabled:opacity-25 transition-colors" aria-label={`Decrease ${label}`}>−</button>
          <input value={value} onChange={(e) => onChange(parseInt(e.target.value.replace(/[^0-9]/g, "")) || 0)}
            className="w-10 text-center bg-transparent text-[15px] font-semibold tabular-nums outline-none" inputMode="numeric" />
          <button onClick={() => onChange(value + 1)}
            className="w-8 h-8 rounded-lg text-stone-600 text-lg leading-none hover:bg-white transition-colors" aria-label={`Increase ${label}`}>+</button>
        </div>
        <span className="w-20 text-right text-[15px] font-bold tabular-nums" style={{ color: active ? "#16130f" : "#cfc8bf" }}>
          {fmt(lineTotal)}
        </span>
      </div>
    </div>
  );
}
