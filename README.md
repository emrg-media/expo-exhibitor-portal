# Event Planner Expo — Booth Services Portal

Public page where exhibitors order electricity, Wi-Fi, and lead retrieval for their booth,
pay by card, and get an instant emailed receipt. Replaces the manual credit-card PDF forms.

- Pricing and date tiers: `src/lib/pricing.ts` (all confirm-with-Jessica values at the top)
- Order + emails: `src/app/api/order/route.ts`
- Receipt PDF: `src/lib/ReceiptPDF.tsx`
- Preview any date with `?preview=YYYY-MM-DD` to see the lead-retrieval tiers gray out.

Stripe checkout is the last step, added once keys are provided.
