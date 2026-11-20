# V2 specification: Quotations and Invoices

## 1. Module and entitlements
- "Invoices & quotes" is an optional module, OFF by default for existing businesses. When off, the app is identical to today and the module code is lazy-loaded (zero cost). Enable it from Settings or from one dismissible Home card. When on: a Documents tab (Quotes, Invoices, Receipts), Invoice and Quote in + New, "Who owes me" and Customers under More, and extra Home cards. Turning it off hides it without deleting data.
- Entitlements layer: a single function can_use(feature) reads the business's plan; during early access it returns true for everything. Monthly usage_counters per business (documents issued). No billing in V2, but gating later must need no refactor.
- Bank accounts and terms are requested at the first invoice, not at signup. Reuse existing bank details.

## 2. Accounting rules
- Business currency only (NGN default), no FX. Quantities allow up to 3 decimals (stored as integer thousandths).
- Rounding: line total = round-half-up(qty × unit price − line discount) to the kobo; the invoice discount applies before VAT; exclusive VAT = round-half-up(taxable × rate); inclusive VAT = round-half-up(gross × rate ÷ (1 + rate)). Totals are sums of rounded parts. Cover with tests.
- Invoices create an amount owed and NO money entry. Money enters the ledger only through record_payment.
- Overpayment is rejected with a clear message. Payment dates cannot precede the invoice date or be in the future (Africa/Lagos).
- An invoice that has any payment cannot be voided. The owner may "Write off balance" (reason required, audit-logged), which closes it as Settled. Voiding a payment receipt creates a reversing entry, reopens the balance and marks the receipt VOID.
- Snapshots: when sent, store the business name, logo, address, TIN/RC, the bank accounts shown, the customer name and address, and the terms on the document. Public pages and PDFs render only the snapshot. Later settings changes affect only new documents. An unpaid invoice can be "Reissued" (void plus a new copy with a new number).
- Overdue is computed from the due date at 23:59:59 Africa/Lagos, never stored by hand. Numbering: separate gap-free counters for receipts, invoices and quotes; a prefix change affects only new documents.
- Statements of account include the opening balance brought forward for the chosen date range, a running balance, invoices as debits, payments as credits and write-offs as separate lines, and must reconcile exactly with the ledger.
- If VAT is enabled, print the business TIN and a VAT line (note in the README that VAT wording needs professional review).

## 3. Invoices
Fields: customer (saved or new), issue date, terms (Due on receipt, 7, 14, 30 days or a custom date), lines (description, qty, unit price, discount), notes, bank accounts to show, optional deposit requested (percentage or fixed, shown as "Amount due now"). Draft then Sent; sending locks the invoice. Status is derived: Draft, Sent, Part-paid, Paid, Settled, Void, plus computed Overdue. Templates match receipts, with stamps (UNPAID, PART PAID, PAID, OVERDUE, VOID). Share by WhatsApp link, Web Share and PDF.

## 4. Payments and receipts
record_payment(debt_id, amount, method, date, reference, idempotency_key) is the only way payments are created. In one transaction it locks the debt row, validates, creates the payment, a linked receipt titled "Payment for INV-0007" showing the remaining balance, the money-in entry and the status update, and writes the audit entry. Parallel calls from two devices must be safe.

## 5. Public pages (/i/{id}, /q/{id}; the existing /r/{id} is kept)
- A separate lightweight bundle: no app-shell code, at most 60 KB JS gzipped, under 2 seconds on throttled 3G.
- Render only the snapshot. Never show a customer's phone or email. noindex, no-referrer, no shared caching. Unknown and expired ids return identical responses.
- 128-bit random ids. The owner can regenerate a document's link, which invalidates the old one immediately.
- The WhatsApp preview shows the business name, document number and amount due, never the customer's name.
- A small "Made with Tallymark" link on public documents, controlled by an entitlement (on by default).
- The invoice page shows status (a PAID stamp lands when settled), bank details with tap-to-copy, a payments summary and a PDF download.

## 6. Customer "I've paid" claims
- The customer enters a name (max 80), an amount (greater than 0 and at most the remaining balance), and at least one of: a reference (max 40) or proof. Proof: jpeg, png, webp or pdf, max 5 MB, verified by magic bytes, metadata stripped, random file name, private bucket.
- Flow: the server verifies the bot check, creates the pending claim, and returns a single-use upload token bound to that claim that expires in 5 minutes. The customer then sees a confirmation with a claim reference.
- Limits: 3 pending claims per invoice; 5 submissions per hour and 20 per day per IP.
- A claim never changes paid status and never creates a money entry. The invoice only shows "Payment reported, awaiting confirmation".
- The owner reviews the proof and chooses Confirm (amount editable; runs record_payment and issues the receipt) or Reject (private reason; the customer sees a neutral message). Warn on a likely duplicate (same amount or reference within 7 days on that invoice).
- Notifications: opt-in Web Push (PWA) for new claims and quote responses. The payload contains no personal data (for example "New payment report on INV-0007"). VAPID keys in Secrets; remove dead subscriptions; in-app badge as the fallback.
- Proof files are deleted 90 days after the decision by a scheduled job; claim metadata is kept.
- Kill switches: environment flags DISABLE_PUBLIC_CLAIMS and DISABLE_PUBLIC_QUOTE_ACTIONS make those endpoints return 503 instantly.

## 7. Quotations
Same fields as invoices plus a validity date (default 14 days, expiry computed). Numbering QUO-. Statuses: Draft, Sent, Accepted, Declined, Expired, Converted. Sent quotes are immutable; revise by void plus copy. Public Accept and Decline (customer name, timestamp and hashed IP recorded) limited to 10 per hour per IP with a bot check. Convert to invoice copies the customer, lines and terms, links the two documents, and works once.

## 8. Receivables tools ("Who owes me")
Extend the existing list: filter by source (invoice, quick credit, part-paid receipt), ageing buckets (not yet due, 1–7, 8–30, 30+ days), total outstanding. WhatsApp reminders through wa.me with gentle and firm editable wording and the public link; log each reminder and warn if one was sent within 3 days. Customer statement as a vector PDF shared by WhatsApp or Web Share. A Customers directory with documents and balances.

## 9. Reports and analytics
"Sold" (including invoiced amounts by issue date) and "Received" (actual money in) are always shown separately. Add invoice ageing, quote-to-invoice conversion, and CSV exports (invoices, quotes, payments) with CSV-injection protection. First-party anonymous events with no personal data: module_enabled, invoice_created, invoice_sent, payment_recorded, claim_submitted, claim_confirmed, quote_sent, quote_accepted, quote_converted, reminder_sent.

## 10. Quality bars
- PDFs are vector with embedded fonts (selectable text, correct ₦), typically under 150 KB, never screenshots of HTML.
- The module adds at most 40 KB gzipped to the app, lazy-loaded. Lighthouse 90 or higher on mobile for public pages.
- Audit log entries for: invoice issued, voided, written off; payment recorded or reversed; claim decisions; bank detail changes; link regeneration; module toggles.
- Export and delete-account flows include all new data.
