# Expo Booth Services Portal

Public ordering page where exhibitors at The Event Planner Expo 2026 buy booth
add-ons (electric, Wi-Fi, lead retrieval), pay by card, and receive a receipt.
Replaces the old emailed PDF form with card details written on it.

**Live:** https://www.expoupgrades.com (apex redirects to `www`)
**Config check:** https://www.expoupgrades.com/api/health

---

## How it works

1. Exhibitor fills the form and picks services. Prices come from
   `src/lib/pricing.ts`, never from the browser.
2. `POST /api/checkout` prices the order **server-side**, creates a Stripe-hosted
   Checkout Session, and returns its URL. The browser redirects there.
3. Exhibitor pays on Stripe.
4. Stripe calls `POST /api/stripe/webhook`. Only then do we render the receipt
   PDF, send both emails, and write the tracker row.
5. Stripe returns them to `/?session_id=...`. `GET /api/receipt` rebuilds the
   paid order for the confirmation screen and offers the PDF.

Nothing is stored in a database. The order rides in Stripe session metadata and
is rebuilt on the way back.

### Files worth knowing

| Path | Purpose |
|---|---|
| `src/lib/pricing.ts` | **All prices, dates and deadlines.** Edit here, nowhere else. |
| `src/lib/order.ts` | Receipt rendering, emails, failure alerts, metadata round-trip |
| `src/lib/logOrder.ts` | Google Sheets tracker |
| `src/lib/ReceiptPDF.tsx` | The receipt |
| `src/app/api/*` | checkout, webhook, receipt, order (fallback), health |

---

## Environment variables

See `.env.example`. Set in Vercel under **Settings → Environment Variables**,
then **redeploy** — env changes do not apply to an existing build.

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_`/`rk_live_`. A restricted key needs write on Checkout Sessions and read/write on PaymentIntents. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_` from the webhook endpoint. **Per-mode**: a test-mode secret will not validate live events. |
| `SMTP_*` | Gmail. `SMTP_FROM` must match `SMTP_USER` or be a verified "Send mail as" alias, otherwise Gmail rewrites or rejects it. |
| `EXPO_NOTIFY_EMAIL` | Who receives new-order notifications. |
| `EXPO_ALERT_EMAIL` | Optional. Where post-payment failure alerts go. Defaults to `EXPO_NOTIFY_EMAIL`. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | base64 service-account JSON. The sheet must be shared with that account's email as Editor. |
| `EXPO_LOG_SHEET_ID` | Tracker spreadsheet ID. |
| `NEXT_PUBLIC_SITE_URL` | Optional. Pins Stripe return URLs. Unset means "whatever host the request came in on", which is usually right. |

**Switching Stripe test → live:** change `STRIPE_SECRET_KEY` **and**
`STRIPE_WEBHOOK_SECRET` together, and create the webhook endpoint again with
test mode off. Change only one and cards get charged with no receipt ever sent.

---

## Traps we already hit

Recorded so nobody rediscovers them the hard way.

**Vercel Hobby blocks deploys from unlinked commit authors.** Pushes fail with
"Vercel user not found" unless the commit author's GitHub account is linked to a
Vercel user on the team. Both repos are configured with
`user.email = afuente@emrgmedia.com`, which maps to the `emrg-media` GitHub
account. If deploys start getting Blocked, check `git config user.email` first.
A manual dashboard redeploy always works, because it is attributed to whoever
clicks it.

**Stripe Adaptive Pricing showed overseas buyers a local currency.** A non-US
visitor was offered IDR as the pre-selected option instead of USD. Our prices,
receipts and tracker are all USD, so a converted charge would not reconcile.
Disabled per session via `adaptive_pricing: { enabled: false }`. This is
account-wide behaviour, so any other Stripe checkout on this account has it too.

**Concurrent Google Sheets appends silently lose rows.** Six simultaneous
appends all returned HTTP 200 and only three rows survived; fifteen orders lost
twelve. Sheets resolves "the last row" against the same revision, so writers
overwrite each other and are still told they succeeded. Every write is now
verified by reading the Order ID back and retried if missing.

**Sheets executes what looks like a formula.** A company named `=1+1` was stored
as `2`. All cells are written as explicitly typed values now, and the timestamp
as a date serial rather than a parseable string.

**Inserted rows inherit the row above.** Using `INSERT_ROWS` made every order
row copy the navy header formatting (white text on navy, unreadable) and shifted
the summary formulas. Uses `appendCells` instead.

**`requestAnimationFrame` is paused in a background tab.** A price changed while
the tab was hidden stayed frozen at the old amount. `useCountUp` now snaps
instead of animating when `document.hidden`.

**The API routes are public, and were trusting the request body.** They are
reachable directly, not only from the form. Found by stress testing before go
live:

- `/api/order`, the no-payment development fallback, sent a receipt, emailed the
  team and wrote a tracker row for anyone who called it, and took the pricing
  date from the caller, which chose the lead retrieval tier. It now returns 404
  whenever `STRIPE_SECRET_KEY` is set, and always prices on the server clock.
- Quantities were used exactly as received. Fractions reached Stripe and failed
  there, and nothing capped the size of an order. `sanitizeSelection()` now
  coerces to whole positive numbers and `selectionTooLarge()` refuses anything
  over `MAX_QTY`. Over-limit orders are **refused, not clamped**: silently
  reducing 80 outlets to 25 would charge an exhibitor for less than they asked.

Prices were never at risk: they come from `pricing.ts` on the server and the
browser never sends amounts. Verified by reconciling 64,826 order combinations
against what Stripe would charge, with no mismatch.

---

## Runbook

**Change a price, a deadline or the event dates** → `src/lib/pricing.ts`, commit,
push. Deploys automatically.

**Check what is configured** → open `/api/health`. `readyForLiveOrders` is only
true when both the Stripe key *and* the webhook secret are present.

**An exhibitor says they did not get a receipt** → look in Stripe for the
payment, then check the tracker for the Order ID. If the payment exists but the
row does not, you should have received an "ACTION NEEDED" alert email with the
full order details.

**Find an order** → every receipt, email and tracker row carries the same
`EXPO-2026-XXXXXX` Order ID.

**Add someone to the tracker sheet** → share the spreadsheet normally. Do not
remove the service account's Editor access or logging stops.

---

## Local development

```bash
npm install
npm run dev
```

Without env vars the form still works end to end: it skips payment, skips email
and skips logging, so you can develop safely. `npm run build` before pushing.
