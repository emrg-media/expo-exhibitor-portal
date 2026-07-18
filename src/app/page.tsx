"use client";

import { useEffect, useRef, useState } from "react";
import {
  LEAD_TIERS, ELECTRIC, EVENT_DAYS, WIFI_PER_DEVICE, PROCESSING_FEE_RATE, EVENT_INFO,
  computeOrder, currentLeadTier, tierStatus, fmt,
  type OrderSelection, type OrderTotals, type LeadTier,
} from "@/lib/pricing";
import { useCountUp, formatPhone, isValidEmail } from "@/lib/ui";

const STEPS = ["Company", "Electricity", "Wi-Fi", "Lead Retrieval"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortEnd(end: string): string {
  const [, m, d] = end.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export default function BoothServicesPage() {
  const [today, setToday] = useState<Date>(() => new Date());
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p && /^\d{4}-\d{2}-\d{2}$/.test(p)) {
      const [y, m, d] = p.split("-").map(Number);
      setToday(new Date(y, m - 1, d));
    }
  }, []);

  const [company, setCompany] = useState({ company: "", contact: "", email: "", phone: "", booth: "" });
  const [emailTouched, setEmailTouched] = useState(false);

  // Scroll-spy: light up the step in the hero as each section crosses the viewport center.
  const [activeStep, setActiveStep] = useState(0);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const idx = sectionRefs.current.indexOf(e.target as HTMLElement);
          if (idx >= 0) setActiveStep(idx);
        }
      }
    }, { rootMargin: "-45% 0px -45% 0px" });
    sectionRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);
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

  // Always-present service lines so the summary reads like a receipt being written.
  const summaryLines = [
    { key: "amp20", label: "20-amp outlet", qty: sel.amp20Qty, unit: amp20Unit, amount: amp20Amount },
    { key: "strip", label: "Power strip", qty: sel.powerStripQty, unit: ELECTRIC.powerStripPrice, amount: stripAmount },
    { key: "wifi", label: "Wi-Fi", qty: sel.wifiDevices, unit: WIFI_PER_DEVICE, amount: wifiAmount },
    ...(!leadClosed ? [{ key: "lead", label: "Lead Retrieval", qty: sel.leadRetrieval ? 1 : 0, unit: leadTier!.price, amount: sel.leadRetrieval ? leadTier!.price : 0 }] : []),
  ];

  const emailInvalid = emailTouched && company.email.trim().length > 0 && !isValidEmail(company.email);
  const canSubmit = !!company.company.trim() && isValidEmail(company.email) && totals.lines.length > 0 && !submitting;

  function setQty(key: keyof OrderSelection, v: number) {
    setSel((p) => ({ ...p, [key]: Math.max(0, v) }));
  }

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
      a.href = url; a.download = "expo-booth-services-receipt.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch { /* noop */ } finally { setSubmitting(false); }
  }

  return (
    <div className="min-h-screen pb-24 lg:pb-10">
      {/* Hero */}
      <header className="hero-gradient text-white overflow-hidden">
        <div className="max-w-5xl mx-auto px-6 md:px-8 pt-12 pb-16 relative">
          <p className="text-[10.5px] tracking-[0.34em] uppercase text-white/45 mb-3">The Event Planner Expo</p>
          <h1 className="text-[36px] md:text-[46px] font-bold leading-[1.02]" style={{ letterSpacing: "-0.03em" }}>Booth Services</h1>
          <p className="text-[14.5px] text-white/55 mt-3 max-w-md leading-relaxed">
            Order electricity, Wi-Fi, and lead retrieval for your booth. Pay securely and get an instant receipt by email.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-5 text-[12.5px] text-white/50">
            <span className="num">{EVENT_INFO.dates}</span>
            <span className="w-1 h-1 rounded-full bg-white/25" />
            <span>{EVENT_INFO.venue}</span>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-2.5 mt-7">
            {STEPS.map((s, i) => {
              const current = i === activeStep;
              const done = i < activeStep;
              return (
                <div key={s} className="flex items-center gap-2.5">
                  <span className="flex items-center gap-1.5 text-[11px] tracking-wide transition-colors"
                    style={{ color: current ? "#fff" : done ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.38)", fontWeight: current ? 600 : 400 }}>
                    {current && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#fff" }} />}
                    <span className="tnum">{i + 1}</span> {s}
                  </span>
                  {i < STEPS.length - 1 && <span className="w-6 h-px" style={{ background: "rgba(255,255,255,0.12)" }} />}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 md:px-8 pt-8">
        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6 lg:items-start">

          {/* Left: form */}
          <div className="space-y-5">
            {/* Company */}
            <section ref={(el) => { sectionRefs.current[0] = el; }} className="premium-card p-6 md:p-7">
              <StepTitle n={1}>Your Company</StepTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                <Field label="Company name" required value={company.company} onChange={(v) => setCompany({ ...company, company: v })} placeholder="Acme Events" />
                <Field label="Booth number" value={company.booth} onChange={(v) => setCompany({ ...company, booth: v })} placeholder="e.g. 214" />
                <Field label="Contact name" value={company.contact} onChange={(v) => setCompany({ ...company, contact: v })} placeholder="Jane Smith" />
                <Field label="Phone" value={company.phone} onChange={(v) => setCompany({ ...company, phone: formatPhone(v) })} placeholder="(212) 555-0100" />
                <div className="sm:col-span-2">
                  <Field label="Email" required value={company.email}
                    onChange={(v) => setCompany({ ...company, email: v })}
                    onBlur={() => setEmailTouched(true)}
                    invalid={emailInvalid} error={emailInvalid ? "Enter a valid email address" : undefined}
                    placeholder="jane@acme.com" />
                </div>
              </div>
            </section>

            {/* Electricity */}
            <section ref={(el) => { sectionRefs.current[1] = el; }} className="premium-card p-6 md:p-7">
              <StepTitle n={2} note={electricitySubtotal}>Electricity</StepTitle>
              <p className="text-[12.5px] text-[color:var(--ink-soft)] mt-1.5">Each 20-amp outlet covers up to 1700W. For 1800W or more, order two.</p>
              <div className="mt-2">
                <QtyRow label="20-amp outlet" unitLabel={`${fmt(amp20Unit)} each`} value={sel.amp20Qty} lineTotal={amp20Amount} onChange={(v) => setQty("amp20Qty", v)} />
                <QtyRow label="Power strip" unitLabel={`${fmt(ELECTRIC.powerStripPrice)} per cord`} value={sel.powerStripQty} lineTotal={stripAmount} onChange={(v) => setQty("powerStripQty", v)} />
              </div>
            </section>

            {/* Wi-Fi */}
            <section ref={(el) => { sectionRefs.current[2] = el; }} className="premium-card p-6 md:p-7">
              <StepTitle n={3} note={wifiAmount}>Wi-Fi</StepTitle>
              <p className="text-[12.5px] text-[color:var(--ink-soft)] mt-1.5">{fmt(WIFI_PER_DEVICE)} per device. Choose how many devices need Wi-Fi.</p>
              <div className="mt-2">
                <QtyRow label="Wi-Fi devices" unitLabel={`${fmt(WIFI_PER_DEVICE)} per device`} value={sel.wifiDevices} lineTotal={wifiAmount} onChange={(v) => setQty("wifiDevices", v)} />
              </div>
            </section>

            {/* Lead Retrieval */}
            <section ref={(el) => { sectionRefs.current[3] = el; }} className="premium-card p-6 md:p-7">
              <StepTitle n={4}>Lead Retrieval</StepTitle>
              <LeadRetrieval today={today} leadTier={leadTier} leadClosed={leadClosed}
                checked={sel.leadRetrieval} onToggle={(b) => setSel((p) => ({ ...p, leadRetrieval: b }))} />
            </section>

            {/* Mobile summary (in flow) */}
            <div className="lg:hidden">
              <SummaryCard lines={summaryLines} totals={totals} booth={company.booth} canSubmit={canSubmit} submitting={submitting} onContinue={handleContinue} />
            </div>
          </div>

          {/* Right: sticky summary (desktop) */}
          <aside className="hidden lg:block lg:sticky lg:top-6">
            <SummaryCard lines={summaryLines} totals={totals} booth={company.booth} canSubmit={canSubmit} submitting={submitting} onContinue={handleContinue} />
          </aside>
        </div>

        <p className="text-center text-[11px] text-[color:var(--ink-faint)] pt-6 pb-4">EMRG Media &nbsp;·&nbsp; The Event Planner Expo &nbsp;·&nbsp; forms@theeventplannerexpo.com</p>
      </div>

      {/* Mobile sticky bottom bar */}
      <MobileBar total={totals.total} canSubmit={canSubmit} submitting={submitting} onContinue={handleContinue} />
    </div>
  );
}

// ── Order summary ─────────────────────────────────────────────────────────────

type SummaryLine = { key: string; label: string; qty: number; unit: number; amount: number };

function SummaryCard({ lines, totals, booth, canSubmit, submitting, onContinue }: {
  lines: SummaryLine[]; totals: OrderTotals; booth: string; canSubmit: boolean; submitting: boolean; onContinue: () => void;
}) {
  const animTotal = useCountUp(totals.total);
  return (
    <div className="premium-card p-6" style={{ boxShadow: "var(--elevation-lg)" }}>
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[color:var(--ink-soft)]">Order Summary</p>

      {/* Event context, so the summary reads like a receipt from the first glance */}
      <div className="mt-3 pb-3.5 text-[12px] text-[color:var(--ink-soft)] flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ borderBottom: "1px solid var(--hairline)" }}>
        <span className="num">{EVENT_INFO.dates}</span>
        <span className="w-1 h-1 rounded-full" style={{ background: "var(--ink-faint)" }} />
        <span>{EVENT_INFO.venue}</span>
        {booth.trim() && <><span className="w-1 h-1 rounded-full" style={{ background: "var(--ink-faint)" }} /><span>Booth <span className="num font-medium text-stone-700">{booth}</span></span></>}
      </div>

      <div className="mt-3.5 space-y-2.5">
        {lines.map((l) => {
          const on = l.amount > 0;
          return (
            <div key={l.key} className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span style={{ color: on ? "#3f3a34" : "var(--ink-faint)" }}>
                {l.label}{on && <span className="text-[color:var(--ink-faint)] text-[12px]"> {l.qty} &times; {fmt(l.unit)}</span>}
              </span>
              <span className="num w-24 text-right font-medium" style={{ color: on ? "#16130f" : "var(--ink-faint)" }}>{fmt(l.amount)}</span>
            </div>
          );
        })}
        <div className="pt-3 mt-1 space-y-1.5" style={{ borderTop: "1px solid var(--hairline)" }}>
          <div className="flex justify-between text-[13px] text-[color:var(--ink-soft)]"><span>Subtotal</span><span className="num">{fmt(totals.subtotal)}</span></div>
          <div className="flex justify-between text-[13px] text-[color:var(--ink-soft)]"><span>Processing fee ({(PROCESSING_FEE_RATE * 100).toFixed(0)}%)</span><span className="num">{fmt(totals.fee)}</span></div>
          <div className="flex justify-between items-baseline pt-2"><span className="text-[15px] font-bold">Total</span><span className="num text-[24px] font-bold" style={{ letterSpacing: "-0.02em" }}>{fmt(animTotal)}</span></div>
        </div>
      </div>

      <button onClick={onContinue} disabled={!canSubmit}
        className="cta-gradient w-full mt-5 h-12 flex items-center justify-center gap-2 text-[13px] font-bold tracking-[0.16em] uppercase rounded-xl">
        {submitting ? <><Spinner /> Processing</> : "Continue to Payment"}
      </button>

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--hairline)" }}>
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-[color:var(--ink-faint)] mb-3">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M4 7V5a4 4 0 0 1 8 0v2m-9 0h10v7H3V7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          Secure checkout. Receipt emailed instantly.
        </div>
        <CardMarks />
        <p className="text-center text-[10px] text-[color:var(--ink-faint)] mt-2.5">Powered by <span className="font-semibold text-stone-500">Stripe</span></p>
      </div>
    </div>
  );
}

function CardMarks() {
  return (
    <div className="flex items-center justify-center gap-3.5" style={{ opacity: 0.55 }}>
      {/* Visa */}
      <svg viewBox="0 0 40 14" height="12" aria-label="Visa"><text x="0" y="12" fontFamily="Arial, Helvetica, sans-serif" fontStyle="italic" fontWeight="800" fontSize="14" letterSpacing="-0.5" fill="#5f574f">VISA</text></svg>
      {/* Mastercard */}
      <svg viewBox="0 0 34 22" height="17" aria-label="Mastercard">
        <circle cx="13" cy="11" r="10" fill="#6f665d" />
        <circle cx="21" cy="11" r="10" fill="#9a9188" />
        <path d="M17 3.2a9.98 9.98 0 0 0 0 15.6 9.98 9.98 0 0 0 0-15.6z" fill="#7d746b" />
      </svg>
      {/* Amex */}
      <svg viewBox="0 0 42 13" height="11" aria-label="American Express"><text x="0" y="11" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="11" fill="#5f574f">AMEX</text></svg>
      {/* Apple Pay */}
      <span className="flex items-center gap-0.5" aria-label="Apple Pay">
        <svg viewBox="0 0 18 20" height="15" fill="#5f574f"><path d="M12.4 2.9c.5-.6.8-1.5.7-2.4-.8 0-1.7.5-2.2 1.2-.5.6-.9 1.4-.8 2.3.9.1 1.7-.5 2.3-1.1zM13.3 4.8c-1.2-.1-2.3.7-2.9.7-.6 0-1.5-.7-2.5-.7-1.3 0-2.4.7-3.1 1.9-1.3 2.3-.3 5.7 1 7.5.6.9 1.3 1.9 2.3 1.9.9 0 1.2-.6 2.3-.6 1.1 0 1.4.6 2.4.6 1 0 1.6-.9 2.2-1.8.7-1 1-2 1-2-.02-.01-1.9-.74-1.9-2.9 0-1.8 1.5-2.7 1.5-2.7-.8-1.2-2.1-1.4-2.5-1.4z" /></svg>
        <span className="text-[13px] font-semibold" style={{ color: "#5f574f" }}>Pay</span>
      </span>
    </div>
  );
}

function MobileBar({ total, canSubmit, submitting, onContinue }: {
  total: number; canSubmit: boolean; submitting: boolean; onContinue: () => void;
}) {
  const animTotal = useCountUp(total);
  if (total <= 0) return null;
  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 px-4 py-3 flex items-center gap-3"
      style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(10px)", borderTop: "1px solid var(--hairline)", boxShadow: "0 -8px 24px -12px rgba(20,17,15,0.18)" }}>
      <div className="leading-tight">
        <p className="text-[10px] uppercase tracking-wider text-[color:var(--ink-faint)]">Total</p>
        <p className="num text-[19px] font-bold" style={{ letterSpacing: "-0.02em" }}>{fmt(animTotal)}</p>
      </div>
      <button onClick={onContinue} disabled={!canSubmit}
        className="cta-gradient ml-auto h-12 px-6 flex items-center justify-center gap-2 text-[12.5px] font-bold tracking-[0.14em] uppercase rounded-xl text-white">
        {submitting ? <><Spinner /> Processing</> : "Continue"}
      </button>
    </div>
  );
}

// ── Lead retrieval ────────────────────────────────────────────────────────────

function LeadRetrieval({ today, leadTier, leadClosed, checked, onToggle }: {
  today: Date; leadTier: LeadTier | null; leadClosed: boolean; checked: boolean; onToggle: (b: boolean) => void;
}) {
  const [showPast, setShowPast] = useState(false);

  if (leadClosed) {
    return (
      <div className="mt-2">
        <p className="text-[13.5px] text-[color:var(--ink-soft)]">Crowd Pass registration has closed for this event.</p>
        <button onClick={() => setShowPast((s) => !s)}
          className="text-[12px] font-medium mt-1.5 underline underline-offset-2 decoration-stone-300 hover:decoration-stone-500 transition-colors"
          style={{ color: "var(--ink-soft)" }}>
          {showPast ? "Hide past pricing" : "View past pricing ›"}
        </button>
        {showPast && <Timeline today={today} />}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-[12.5px] text-[color:var(--ink-soft)] mb-4">
        Crowd Pass pricing rises as the event approaches. Today you pay{" "}
        <span className="font-semibold num" style={{ color: "var(--emrg-red)" }}>{fmt(leadTier!.price)}</span>.
      </p>
      <Timeline today={today} />
      <label className="mt-4 flex items-center gap-3 cursor-pointer rounded-xl border px-4 h-14 transition-colors"
        style={{ borderColor: checked ? "var(--emrg-red)" : "var(--hairline)", background: checked ? "rgba(192,24,42,0.03)" : "transparent" }}>
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="h-5 w-5" />
        <span className="text-[14px] font-medium">Add Lead Retrieval at today&apos;s price</span>
        <span className="ml-auto num text-[16px] font-bold" style={{ color: "var(--emrg-red)" }}>{fmt(leadTier!.price)}</span>
      </label>
    </div>
  );
}

function Timeline({ today }: { today: Date }) {
  return (
    <div className="flex items-stretch gap-1.5">
      {LEAD_TIERS.map((tier) => {
        const status = tierStatus(tier, today);
        const past = status === "past";
        const current = status === "current";
        return (
          <div key={tier.id} className="flex-1 rounded-xl px-2 py-3 text-center transition-colors"
            style={{
              background: current ? "rgba(192,24,42,0.06)" : "transparent",
              border: current ? "1px solid rgba(192,24,42,0.35)" : "1px solid var(--hairline)",
              opacity: past ? 0.4 : 1,
            }}>
            <div className="text-[9px] font-bold tracking-[0.1em] uppercase mb-1"
              style={{ color: current ? "var(--emrg-red)" : "var(--ink-faint)" }}>
              {current ? "Today" : past ? "Closed" : "Soon"}
            </div>
            <div className="num text-[15px]" style={{ fontWeight: current ? 700 : 600, color: current ? "var(--emrg-red)" : past ? "var(--ink-faint)" : "#16130f", textDecoration: past ? "line-through" : "none" }}>
              {fmt(tier.price).replace(".00", "")}
            </div>
            <div className="text-[10px] text-[color:var(--ink-faint)] mt-0.5">thru {shortEnd(tier.end)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function StepTitle({ n, note, children }: { n: number; note?: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-bold text-white shrink-0 num"
        style={{ background: "linear-gradient(160deg, #2a2521, #0d0b0a)" }}>{n}</span>
      <h2 className="text-[16px] font-bold" style={{ letterSpacing: "-0.01em" }}>{children}</h2>
      {note !== undefined && note > 0 && <span className="ml-auto num text-[15px] font-bold">{fmt(note)}</span>}
    </div>
  );
}

function Field({ label, value, onChange, onBlur, placeholder, required, invalid, error }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  placeholder?: string; required?: boolean; invalid?: boolean; error?: string;
}) {
  return (
    <div>
      <label className="block text-[10.5px] font-bold tracking-[0.14em] uppercase text-[color:var(--ink-soft)] mb-1.5">
        {label}{required && <span style={{ color: "var(--emrg-red)" }}> *</span>}
      </label>
      <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder}
        className={`w-full border rounded-xl px-3.5 py-2.5 text-[15px] bg-white text-stone-900 placeholder-stone-300 transition-shadow ${invalid ? "invalid" : ""}`}
        style={{ borderColor: invalid ? "var(--emrg-red)" : "var(--hairline)" }} />
      {error && <p className="text-[11.5px] mt-1" style={{ color: "var(--emrg-red)" }}>{error}</p>}
    </div>
  );
}

function QtyRow({ label, unitLabel, value, lineTotal, onChange }: {
  label: string; unitLabel: string; value: number; lineTotal: number; onChange: (v: number) => void;
}) {
  const anim = useCountUp(lineTotal);
  const active = value > 0;
  return (
    <div className="flex items-center gap-3 py-3.5" style={{ borderTop: "1px solid var(--hairline)" }}>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold" style={{ letterSpacing: "-0.01em" }}>{label}</p>
        <p className="text-[12px] text-[color:var(--ink-faint)]">{unitLabel}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center rounded-xl border bg-stone-50/60 p-0.5" style={{ borderColor: "var(--hairline)" }}>
          <button onClick={() => onChange(value - 1)} disabled={value <= 0}
            className="spring w-8 h-8 rounded-lg text-stone-600 text-lg leading-none hover:bg-white disabled:opacity-25" aria-label={`Decrease ${label}`}>−</button>
          <input value={value} onChange={(e) => onChange(parseInt(e.target.value.replace(/[^0-9]/g, "")) || 0)}
            className="tnum w-10 text-center bg-transparent text-[15px] font-semibold outline-none" inputMode="numeric" aria-label={`${label} quantity`} />
          <button onClick={() => onChange(value + 1)}
            className="spring w-8 h-8 rounded-lg text-stone-600 text-lg leading-none hover:bg-white" aria-label={`Increase ${label}`}>+</button>
        </div>
        <span className="num w-24 text-right text-[15px] font-bold" style={{ color: active ? "#16130f" : "#cfc8bf" }}>{fmt(anim)}</span>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
