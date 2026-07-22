"use client";

import { useEffect, useRef, useState } from "react";
import {
  LEAD_TIERS, ELECTRIC, EVENT_DAYS, WIFI_PER_DEVICE, PROCESSING_FEE_RATE, EVENT_INFO, WIFI_ELECTRIC_DEADLINE,
  computeOrder, currentLeadTier, tierStatus, fmt,
  type OrderSelection, type OrderTotals, type LeadTier,
} from "@/lib/pricing";
import { useCountUp, formatPhone, isValidEmail } from "@/lib/ui";

const STEPS = ["Company", "Electric", "Wi-Fi", "Lead Retrieval"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INTRO = "Enhance your Expo experience by ordering any additional services you may need, including electric, Wi-Fi, and lead retrieval. Please select your items below and submit your order form in advance to ensure everything is ready when you arrive at the Expo. Please follow all deadline dates.";

function shortEnd(end: string): string {
  const [, m, d] = end.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// Days remaining (inclusive of today and the tier's last day) at the current rate.
function daysLeftInTier(today: Date, endStr: string): number {
  const [y, m, d] = endStr.split("-").map(Number);
  const end = new Date(y, m - 1, d);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - t0.getTime()) / 86400000) + 1;
}

const DATE_VENUE = `${EVENT_INFO.dates} / ${EVENT_INFO.location}`;

export default function BoothServicesPage() {
  const [today, setToday] = useState<Date>(() => new Date());
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p && /^\d{4}-\d{2}-\d{2}$/.test(p)) {
      const [y, m, d] = p.split("-").map(Number);
      setToday(new Date(y, m - 1, d));
    }
  }, []);

  const [company, setCompany] = useState({ company: "", contact: "", email: "", phone: "" });
  const [emailTouched, setEmailTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const companyRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Scroll-spy: the active step is the last section whose top has scrolled past
  // ~35% of the viewport. Monotonic, so the highlight advances 1->2->3->4 cleanly
  // instead of flickering between sections of different heights.
  const [activeStep, setActiveStep] = useState(0);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const threshold = window.innerHeight * 0.35;
      let active = 0;
      sectionRefs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= threshold) active = i;
      });
      setActiveStep(active);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const [sel, setSel] = useState<OrderSelection>({ amp20Qty: 0, powerStripQty: 0, wifiDevices: 0, leadRetrieval: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [phase, setPhase] = useState<"form" | "confirmed">("form");
  const [receipt, setReceipt] = useState<{ url: string; company: typeof company; totals: OrderTotals } | null>(null);

  const totals = computeOrder(sel, today);
  const leadTier = currentLeadTier(today);
  const leadClosed = leadTier === null;

  const amp20Unit = ELECTRIC.amp20Price * (ELECTRIC.amp20PerDay ? EVENT_DAYS : 1);
  const amp20Amount = sel.amp20Qty * amp20Unit;
  const stripAmount = sel.powerStripQty * ELECTRIC.powerStripPrice;
  const electricitySubtotal = amp20Amount + stripAmount;
  const powerStripLocked = sel.amp20Qty === 0; // a power strip requires a 20-amp outlet
  const wifiAmount = sel.wifiDevices * WIFI_PER_DEVICE;

  // Always-present service lines so the summary reads like a receipt being written.
  const summaryLines = [
    { key: "amp20", label: "20-amp outlet", qty: sel.amp20Qty, unit: amp20Unit, amount: amp20Amount },
    { key: "strip", label: "Power strip", qty: sel.powerStripQty, unit: ELECTRIC.powerStripPrice, amount: stripAmount },
    { key: "wifi", label: "Wi-Fi device", qty: sel.wifiDevices, unit: WIFI_PER_DEVICE, amount: wifiAmount },
    ...(!leadClosed ? [{ key: "lead", label: "Lead Retrieval", qty: sel.leadRetrieval ? 1 : 0, unit: leadTier!.price, amount: sel.leadRetrieval ? leadTier!.price : 0 }] : []),
  ];

  const companyMissing = !company.company.trim();
  const emailMissing = !company.email.trim();
  const emailBad = company.email.trim().length > 0 && !isValidEmail(company.email);
  const companyError = attempted && companyMissing ? "Company name is required" : undefined;
  const emailError = (emailTouched || attempted)
    ? (emailMissing ? "Email is required" : emailBad ? "Enter a valid email address" : undefined)
    : undefined;

  const hasService = totals.lines.length > 0;
  const formValid = !companyMissing && isValidEmail(company.email) && hasService;

  function setQty(key: keyof OrderSelection, v: number) {
    setSel((p) => ({ ...p, [key]: Math.max(0, v) }));
  }

  function scrollToStep(i: number) {
    sectionRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleContinue() {
    if (submitting || !hasService) return;
    if (!formValid) {
      setAttempted(true);
      const target = companyMissing ? companyRef.current : emailRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => target?.focus({ preventScroll: true }), 350);
      return;
    }
    setSubmitError(false);
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
      setReceipt({ url, company: { ...company }, totals });
      setPhase("confirmed");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  function resetOrder() {
    if (receipt) URL.revokeObjectURL(receipt.url);
    setReceipt(null);
    setPhase("form");
    setSel({ amp20Qty: 0, powerStripQty: 0, wifiDevices: 0, leadRetrieval: false });
    setAttempted(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const daysLeft = mounted && leadTier ? daysLeftInTier(today, leadTier.end) : null;

  return (
    <div className="min-h-screen pb-24 lg:pb-10">
      {/* Hero */}
      <header className="hero-gradient text-white overflow-hidden">
        <div className="max-w-5xl mx-auto px-6 md:px-8 pt-12 pb-16 relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/expo-logo.png" alt="The Event Planner Expo 2026" className="h-16 md:h-20 w-auto mb-5" style={{ filter: "brightness(0) invert(1)" }} />
          <p className="text-[16px] md:text-[18px] font-semibold text-white/90 mb-6" style={{ letterSpacing: "0.01em" }}>
            <span className="num">{EVENT_INFO.dates}</span> <span className="text-white/45 mx-1">/</span> {EVENT_INFO.location}
          </p>
          <h1 className="text-[36px] md:text-[46px] font-bold leading-[1.02]" style={{ letterSpacing: "-0.03em" }}>Booth Services</h1>

          {phase === "form" && (
            <>
              <p className="text-[15px] md:text-[15.5px] text-white/75 mt-4 max-w-2xl leading-relaxed">{INTRO}</p>
              {/* Step indicator (clickable for back/forward navigation) */}
              <div className="flex flex-wrap items-center gap-2.5 mt-7">
                {STEPS.map((s, i) => {
                  const current = i === activeStep;
                  const done = i < activeStep;
                  return (
                    <div key={s} className="flex items-center gap-2.5">
                      <button type="button" onClick={() => scrollToStep(i)}
                        className="step-chip flex items-center gap-1.5 text-[12.5px] tracking-wide"
                        style={{ color: current ? "#fff" : done ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.5)", fontWeight: current ? 600 : 500 }}>
                        {current && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#fff" }} />}
                        <span className="tnum">{i + 1}</span> {s}
                      </button>
                      {i < STEPS.length - 1 && <span className="w-6 h-px" style={{ background: "rgba(255,255,255,0.16)" }} />}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </header>

      {phase === "confirmed" && receipt ? (
        <Confirmation receipt={receipt} onReset={resetOrder} />
      ) : (
        <div className="max-w-5xl mx-auto px-6 md:px-8 pt-8">
          <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6 lg:items-start">

            {/* Left: form */}
            <div className="space-y-5">
              {/* Company */}
              <section ref={(el) => { sectionRefs.current[0] = el; }} className="premium-card p-6 md:p-7">
                <StepTitle n={1}>Your Company</StepTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                  <Field label="Company name" required value={company.company} inputRef={companyRef}
                    onChange={(v) => setCompany({ ...company, company: v })}
                    invalid={!!companyError} error={companyError} placeholder="Acme Events" />
                  <Field label="Contact name" value={company.contact} onChange={(v) => setCompany({ ...company, contact: v })} placeholder="Jane Smith" />
                  <Field label="Cell phone" value={company.phone} onChange={(v) => setCompany({ ...company, phone: formatPhone(v) })} placeholder="(212) 555-0100" />
                  <Field label="Email" required value={company.email} inputRef={emailRef}
                    onChange={(v) => setCompany({ ...company, email: v })}
                    onBlur={() => setEmailTouched(true)}
                    invalid={!!emailError} error={emailError}
                    placeholder="jane@acme.com" />
                </div>
              </section>

              {/* Electric */}
              <section ref={(el) => { sectionRefs.current[1] = el; }} className="premium-card p-6 md:p-7">
                <StepTitle n={2} note={electricitySubtotal} deadline={`Order by ${WIFI_ELECTRIC_DEADLINE}`}>Electric</StepTitle>
                <div className="mt-4">
                  <QtyRow label="20-amp outlet" unitLabel={`${fmt(amp20Unit)} / outlet`} value={sel.amp20Qty} lineTotal={amp20Amount}
                    onChange={(v) => setSel((p) => ({ ...p, amp20Qty: Math.max(0, v), powerStripQty: v <= 0 ? 0 : p.powerStripQty }))} />
                  <QtyRow label="Power strip"
                    unitLabel={powerStripLocked ? `${fmt(ELECTRIC.powerStripPrice)} / cord. Add an outlet first.` : `${fmt(ELECTRIC.powerStripPrice)} / cord`}
                    value={sel.powerStripQty} lineTotal={stripAmount} disabled={powerStripLocked} onChange={(v) => setQty("powerStripQty", v)} />
                </div>
                <div className="mt-4">
                  <Note>If you are planning to use any type of electrical device in your booth, you must submit an electric order in advance. You will not be able to order electric day of event.</Note>
                </div>
              </section>

              {/* Wi-Fi */}
              <section ref={(el) => { sectionRefs.current[2] = el; }} className="premium-card p-6 md:p-7">
                <StepTitle n={3} note={wifiAmount} deadline={`Order by ${WIFI_ELECTRIC_DEADLINE}`}>Wi-Fi</StepTitle>
                <p className="text-[14px] text-[color:var(--ink-soft)] mt-2 leading-relaxed">{fmt(WIFI_PER_DEVICE)} per device. Choose how many devices need Wi-Fi (for example, 3 devices is $60).</p>
                <div className="mt-3">
                  <QtyRow label="Wi-Fi device" unitLabel={`${fmt(WIFI_PER_DEVICE)} / device`} value={sel.wifiDevices} lineTotal={wifiAmount} onChange={(v) => setQty("wifiDevices", v)} />
                </div>
              </section>

              {/* Lead Retrieval (set apart in its own framed card) */}
              <section ref={(el) => { sectionRefs.current[3] = el; }} className="lead-card p-7 md:p-8">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-8 h-8 rounded-full text-[13px] font-bold text-white shrink-0 num"
                    style={{ background: "linear-gradient(160deg, #12307e, #000434)" }}>4</span>
                  <h2 className="text-[21px] font-bold" style={{ letterSpacing: "-0.015em", color: "var(--brand-navy)" }}>Lead Retrieval</h2>
                </div>
                <p className="text-[14px] text-[color:var(--ink-soft)] mt-3 leading-relaxed">Scan attendee badges and follow up after the show.</p>
                <LeadRetrieval today={today} leadTier={leadTier} leadClosed={leadClosed} daysLeft={daysLeft}
                  checked={sel.leadRetrieval} onToggle={(b) => setSel((p) => ({ ...p, leadRetrieval: b }))} />
              </section>

              {/* Mobile summary (in flow) */}
              <div className="lg:hidden">
                <SummaryCard lines={summaryLines} totals={totals} hasService={hasService} submitting={submitting} submitError={submitError} onContinue={handleContinue} />
              </div>
            </div>

            {/* Right: sticky summary (desktop) */}
            <aside className="hidden lg:block lg:sticky lg:top-6">
              <SummaryCard lines={summaryLines} totals={totals} hasService={hasService} submitting={submitting} submitError={submitError} onContinue={handleContinue} />
            </aside>
          </div>

          <p className="text-center text-[12px] text-[color:var(--ink-faint)] pt-6 pb-4">EMRG Media &nbsp;·&nbsp; The Event Planner Expo &nbsp;·&nbsp; forms@theeventplannerexpo.com</p>
        </div>
      )}

      {/* Mobile sticky bottom bar */}
      {phase === "form" && <MobileBar total={totals.total} hasService={hasService} submitting={submitting} onContinue={handleContinue} />}
    </div>
  );
}

// ── Confirmation ──────────────────────────────────────────────────────────────

function Confirmation({ receipt, onReset }: { receipt: { url: string; company: { company: string; email: string }; totals: OrderTotals }; onReset: () => void }) {
  const { totals } = receipt;
  return (
    <div className="max-w-xl mx-auto px-6 md:px-8 pt-10">
      <div className="premium-card p-7 md:p-9 text-center">
        <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(27,58,160,0.09)" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.3L19 7.3" stroke="var(--blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h1 className="text-[24px] font-bold mt-5" style={{ letterSpacing: "-0.02em", color: "var(--brand-navy)" }}>Order confirmed</h1>
        <p className="text-[14.5px] text-[color:var(--ink-soft)] mt-2 leading-relaxed">
          Thank you{receipt.company.company ? `, ${receipt.company.company.replace(/[.\s]+$/, "")}` : ""}. Your booth add-on order for The Event Planner Expo 2026 has been submitted.
        </p>

        <div className="mt-6 rounded-xl px-5 py-4 text-left" style={{ border: "1px solid var(--hairline)" }}>
          {totals.lines.map((l) => (
            <div key={l.key} className="flex items-baseline justify-between gap-3 text-[14px] py-1">
              <span style={{ color: "var(--ink)" }}>{l.label} <span className="text-[color:var(--ink-faint)] text-[12.5px]">{l.qty} &times; {fmt(l.unit)}</span></span>
              <span className="num font-semibold" style={{ color: "var(--foreground)" }}>{fmt(l.amount)}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between pt-3 mt-2" style={{ borderTop: "1px solid var(--hairline)" }}>
            <span className="text-[15px] font-bold">Total paid</span>
            <span className="num text-[20px] font-bold">{fmt(totals.total)}</span>
          </div>
        </div>

        <p className="text-[13px] text-[color:var(--ink-soft)] mt-5">
          A confirmation email {receipt.company.email ? <>is on its way to <span className="font-semibold text-[color:var(--foreground)]">{receipt.company.email}</span></> : "is on its way"} with your receipt attached.
        </p>

        <a href={receipt.url} download="expo-booth-services-receipt.pdf"
          className="cta-gradient inline-flex items-center justify-center gap-2 w-full mt-6 h-12 text-[13.5px] font-bold tracking-[0.14em] uppercase rounded-xl">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0l3-3m-3 3L5 7M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Download receipt (PDF)
        </a>
        <button onClick={onReset} className="mt-4 text-[13px] font-medium underline underline-offset-2 decoration-stone-300 hover:decoration-stone-500 transition-colors" style={{ color: "var(--ink-soft)" }}>
          Place another order
        </button>
      </div>
      <p className="text-center text-[12px] text-[color:var(--ink-faint)] pt-6 pb-4">EMRG Media &nbsp;·&nbsp; The Event Planner Expo &nbsp;·&nbsp; forms@theeventplannerexpo.com</p>
    </div>
  );
}

// ── Order summary ─────────────────────────────────────────────────────────────

type SummaryLine = { key: string; label: string; qty: number; unit: number; amount: number };

function SummaryCard({ lines, totals, hasService, submitting, submitError, onContinue }: {
  lines: SummaryLine[]; totals: OrderTotals; hasService: boolean; submitting: boolean; submitError: boolean; onContinue: () => void;
}) {
  const animTotal = useCountUp(totals.total);
  return (
    <div className="premium-card p-6" style={{ boxShadow: "var(--elevation-lg)" }}>
      <p className="text-[12px] font-bold tracking-[0.2em] uppercase text-[color:var(--ink-soft)]">Order Summary</p>

      {/* Event context, so the summary reads like a receipt from the first glance */}
      <div className="mt-3 pb-3.5 text-[14px] font-semibold" style={{ borderBottom: "1px solid var(--hairline)", color: "var(--ink)" }}>
        <span className="num">{EVENT_INFO.dates}</span> <span className="text-[color:var(--ink-faint)] mx-0.5">/</span> {EVENT_INFO.location}
      </div>

      <div className="mt-3.5 space-y-2.5">
        {lines.map((l) => {
          const on = l.amount > 0;
          return (
            <div key={l.key} className="flex items-baseline justify-between gap-3 text-[14.5px] transition-opacity duration-200" style={{ opacity: on ? 1 : 0.4 }}>
              <span style={{ color: "var(--ink)" }}>
                {l.label}{on && <span className="text-[color:var(--ink-faint)] text-[12.5px]"> {l.qty} &times; {fmt(l.unit)}</span>}
              </span>
              <span className="num w-24 text-right font-semibold" style={{ color: "var(--foreground)" }}>{fmt(l.amount)}</span>
            </div>
          );
        })}
        <div className="pt-3 mt-1 space-y-1.5" style={{ borderTop: "1px solid var(--hairline)" }}>
          <div className="flex justify-between text-[13.5px] text-[color:var(--ink-soft)]"><span>Subtotal</span><span className="num">{fmt(totals.subtotal)}</span></div>
          <div className="flex justify-between text-[13.5px] text-[color:var(--ink-soft)]"><span>Processing fee ({(PROCESSING_FEE_RATE * 100).toFixed(0)}%)</span><span className="num">{fmt(totals.fee)}</span></div>
          <div className="flex justify-between items-baseline pt-2"><span className="text-[15px] font-bold">Total</span><span className="num text-[26px] font-bold" style={{ letterSpacing: "-0.02em" }}>{fmt(animTotal)}</span></div>
        </div>
      </div>

      <button onClick={onContinue} disabled={!hasService || submitting}
        className="cta-gradient w-full mt-5 h-12 flex items-center justify-center gap-2 text-[13.5px] font-bold tracking-[0.16em] uppercase rounded-xl">
        {submitting ? <><Spinner /> Processing</> : "Continue to Payment"}
      </button>
      {submitError && <p className="text-[12.5px] text-center mt-2.5 font-medium" style={{ color: "var(--brand-navy)" }}>Something went wrong submitting your order. Please try again.</p>}

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--hairline)" }}>
        <div className="flex items-center justify-center gap-1.5 text-[11.5px] text-[color:var(--ink-faint)] mb-3">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M4 7V5a4 4 0 0 1 8 0v2m-9 0h10v7H3V7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          Secure checkout. Receipt emailed instantly.
        </div>
        <CardMarks />
        <p className="text-center text-[10.5px] text-[color:var(--ink-faint)] mt-2.5">Powered by <span className="font-semibold text-[color:var(--ink-soft)]">Stripe</span></p>
      </div>
    </div>
  );
}

function CardMarks() {
  return (
    <div className="flex items-center justify-center gap-3.5" style={{ opacity: 0.6 }}>
      {/* Visa */}
      <svg viewBox="0 0 40 14" height="12" aria-label="Visa"><text x="0" y="12" fontFamily="Arial, Helvetica, sans-serif" fontStyle="italic" fontWeight="800" fontSize="14" letterSpacing="-0.5" fill="#4a5268">VISA</text></svg>
      {/* Mastercard */}
      <svg viewBox="0 0 34 22" height="17" aria-label="Mastercard">
        <circle cx="13" cy="11" r="10" fill="#5b647c" />
        <circle cx="21" cy="11" r="10" fill="#98a0b4" />
        <path d="M17 3.2a9.98 9.98 0 0 0 0 15.6 9.98 9.98 0 0 0 0-15.6z" fill="#767f97" />
      </svg>
      {/* Amex */}
      <svg viewBox="0 0 42 13" height="11" aria-label="American Express"><text x="0" y="11" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="11" fill="#4a5268">AMEX</text></svg>
      {/* Apple Pay */}
      <span className="flex items-center gap-0.5" aria-label="Apple Pay">
        <svg viewBox="0 0 18 20" height="15" fill="#4a5268"><path d="M12.4 2.9c.5-.6.8-1.5.7-2.4-.8 0-1.7.5-2.2 1.2-.5.6-.9 1.4-.8 2.3.9.1 1.7-.5 2.3-1.1zM13.3 4.8c-1.2-.1-2.3.7-2.9.7-.6 0-1.5-.7-2.5-.7-1.3 0-2.4.7-3.1 1.9-1.3 2.3-.3 5.7 1 7.5.6.9 1.3 1.9 2.3 1.9.9 0 1.2-.6 2.3-.6 1.1 0 1.4.6 2.4.6 1 0 1.6-.9 2.2-1.8.7-1 1-2 1-2-.02-.01-1.9-.74-1.9-2.9 0-1.8 1.5-2.7 1.5-2.7-.8-1.2-2.1-1.4-2.5-1.4z" /></svg>
        <span className="text-[13px] font-semibold" style={{ color: "#4a5268" }}>Pay</span>
      </span>
    </div>
  );
}

function MobileBar({ total, hasService, submitting, onContinue }: {
  total: number; hasService: boolean; submitting: boolean; onContinue: () => void;
}) {
  const animTotal = useCountUp(total);
  if (total <= 0) return null;
  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 px-4 py-3 flex items-center gap-3"
      style={{ background: "rgba(255,255,255,0.94)", backdropFilter: "blur(10px)", borderTop: "1px solid var(--hairline)", boxShadow: "0 -8px 24px -12px rgba(10,15,31,0.18)" }}>
      <div className="leading-tight">
        <p className="text-[10.5px] uppercase tracking-wider text-[color:var(--ink-faint)]">Total</p>
        <p className="num text-[20px] font-bold" style={{ letterSpacing: "-0.02em" }}>{fmt(animTotal)}</p>
      </div>
      <button onClick={onContinue} disabled={!hasService || submitting}
        className="cta-gradient ml-auto h-12 px-6 flex items-center justify-center gap-2 text-[12.5px] font-bold tracking-[0.14em] uppercase rounded-xl">
        {submitting ? <><Spinner /> Processing</> : "Continue"}
      </button>
    </div>
  );
}

// ── Lead retrieval ────────────────────────────────────────────────────────────

function LeadRetrieval({ today, leadTier, leadClosed, daysLeft, checked, onToggle }: {
  today: Date; leadTier: LeadTier | null; leadClosed: boolean; daysLeft: number | null; checked: boolean; onToggle: (b: boolean) => void;
}) {
  const [showPast, setShowPast] = useState(false);

  if (leadClosed) {
    return (
      <div className="mt-4">
        <p className="text-[14px] text-[color:var(--ink-soft)]">Lead Retrieval registration has closed for this event.</p>
        <button onClick={() => setShowPast((s) => !s)}
          className="text-[13px] font-medium mt-1.5 underline underline-offset-2 decoration-stone-300 hover:decoration-stone-500 transition-colors"
          style={{ color: "var(--ink-soft)" }}>
          {showPast ? "Hide past pricing" : "View past pricing ›"}
        </button>
        {showPast && <div className="mt-3"><Timeline today={today} /></div>}
      </div>
    );
  }

  return (
    <div className="mt-5">
      <p className="text-[14px] text-[color:var(--ink-soft)] mb-4 leading-relaxed">
        Lead retrieval prices increase as the event approaches. Please review the pricing deadlines and order early to secure the lowest available rate.
      </p>
      {daysLeft !== null && daysLeft > 0 && (
        <div className="flex items-center gap-2.5 rounded-full w-fit px-4 py-2 mb-4 text-[13px] font-semibold"
          style={{ background: "rgba(27,58,160,0.07)", border: "1px solid rgba(27,58,160,0.22)", color: "var(--brand-navy)" }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 5.2v3.4l2.1 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {daysLeft} {daysLeft === 1 ? "day" : "days"} left at this rate
        </div>
      )}
      <Timeline today={today} />
      <label className="mt-5 flex items-center gap-3 cursor-pointer rounded-xl border px-4 h-14 transition-colors"
        style={{ borderColor: checked ? "var(--blue)" : "var(--hairline)", background: checked ? "rgba(27,58,160,0.05)" : "#ffffff" }}>
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="h-5 w-5" />
        <span className="text-[15px] font-medium">Add Lead Retrieval at today&apos;s price</span>
        <span className="ml-auto num text-[17px] font-bold" style={{ color: "var(--foreground)" }}>{fmt(leadTier!.price)}</span>
      </label>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-4 py-3 text-[13px] leading-relaxed"
      style={{ background: "rgba(10,15,31,0.03)", border: "1px solid var(--hairline)", color: "var(--ink-soft)" }}>
      <span className="font-semibold" style={{ color: "var(--foreground)" }}>Note. </span>{children}
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
              background: current ? "rgba(27,58,160,0.07)" : "transparent",
              border: current ? "1.5px solid var(--blue)" : "1px solid var(--hairline)",
              opacity: past ? 0.4 : 1,
            }}>
            <div className="text-[10px] font-bold tracking-[0.1em] uppercase mb-1" style={{ color: "var(--blue)" }}>
              {current ? "Today" : " "}
            </div>
            <div className="num text-[16px]" style={{ fontWeight: current ? 700 : 600, color: current ? "var(--blue)" : past ? "var(--ink-faint)" : "var(--foreground)", textDecoration: past ? "line-through" : "none" }}>
              {fmt(tier.price).replace(".00", "")}
            </div>
            <div className="text-[10.5px] text-[color:var(--ink-faint)] mt-0.5">thru {shortEnd(tier.end)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function StepTitle({ n, note, deadline, children }: { n: number; note?: number; deadline?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center justify-center w-7 h-7 rounded-full text-[12.5px] font-bold text-white shrink-0 num"
        style={{ background: "linear-gradient(160deg, #12307e, #000434)" }}>{n}</span>
      <h2 className="text-[18px] font-bold" style={{ letterSpacing: "-0.01em" }}>{children}</h2>
      {deadline && <span className="text-[12.5px] font-medium text-[color:var(--ink-soft)]">{deadline}</span>}
      {note !== undefined && note > 0 && <span className="ml-auto num text-[16px] font-bold">{fmt(note)}</span>}
    </div>
  );
}

function Field({ label, value, onChange, onBlur, placeholder, required, invalid, error, inputRef }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  placeholder?: string; required?: boolean; invalid?: boolean; error?: string; inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-bold tracking-[0.12em] uppercase text-[color:var(--ink-soft)] mb-1.5">
        {label}{required && <span style={{ color: "var(--blue)" }}> *</span>}
      </label>
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder}
        className={`w-full border rounded-xl px-3.5 py-2.5 text-[16px] bg-white placeholder-stone-400 transition-shadow ${invalid ? "invalid" : ""}`}
        style={{ borderColor: invalid ? "var(--brand-navy)" : "var(--hairline)", color: "var(--foreground)" }} />
      {error && <p className="text-[12.5px] mt-1 font-medium" style={{ color: "var(--brand-navy)" }}>{error}</p>}
    </div>
  );
}

function QtyRow({ label, unitLabel, value, lineTotal, onChange, disabled }: {
  label: string; unitLabel: string; value: number; lineTotal: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  const anim = useCountUp(lineTotal);
  const active = value > 0;
  return (
    <div className="flex items-center gap-3 py-3.5" style={{ borderTop: "1px solid var(--hairline)", opacity: disabled ? 0.5 : 1 }}>
      <div className="min-w-0">
        <p className="text-[15.5px] font-semibold" style={{ letterSpacing: "-0.01em" }}>{label}</p>
        <p className="text-[13px] text-[color:var(--ink-soft)]">{unitLabel}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center rounded-xl border bg-stone-50/60 p-0.5" style={{ borderColor: "var(--hairline)" }}>
          <button onClick={() => onChange(value - 1)} disabled={disabled || value <= 0}
            className="spring w-8 h-8 rounded-lg text-[color:var(--ink)] text-lg leading-none hover:bg-white disabled:opacity-25" aria-label={`Decrease ${label}`}>−</button>
          <input value={value} onChange={(e) => onChange(parseInt(e.target.value.replace(/[^0-9]/g, "")) || 0)} disabled={disabled}
            className="tnum w-10 text-center bg-transparent text-[16px] font-semibold outline-none" inputMode="numeric" aria-label={`${label} quantity`} />
          <button onClick={() => onChange(value + 1)} disabled={disabled}
            className="spring w-8 h-8 rounded-lg text-[color:var(--ink)] text-lg leading-none hover:bg-white disabled:opacity-25" aria-label={`Increase ${label}`}>+</button>
        </div>
        <span className="num w-24 text-right text-[16px] font-bold" style={{ color: active ? "var(--foreground)" : "#b9c1d3" }}>{fmt(anim)}</span>
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
