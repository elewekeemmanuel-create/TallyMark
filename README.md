# Tallymark

> **Issue the receipt. Keep the book. Know your day.**

Tallymark is a web application and installable PWA built for Nigerian small businesses (`NGN ₦`, `Africa/Lagos` WAT). It replaces paper receipt booklets and handwritten night-time cash books with:

1. **Instant Numbered Receipts** — Gap-free sequential numbering per business, three print/PDF templates (*Modern*, *Classic*, *Compact 80mm thermal*), `PAID` / `PART PAID` / `VOID` stamps, amount in words, QR code & unguessable public verification links (`/r/:publicId`), and one-tap WhatsApp sharing (`wa.me`).
2. **The Digital Cash Book** — Unified daily ledger recording Receipt Sales, 5-second Quick Sales, Credit Sales ("borrowed"), Debt Payments, Supplier Creditors, and Expenses with private proof photos. Tracks physical **Cash in Hand** separately from **Transfer** and **POS / Card** collections, with a **Close Day** cash-count reconciliation lock and visible audit correction entries.
3. **Speak Your Day** — Natural voice or typed daily capture (*"I spent five thousand on transport and twelve thousand on stock, Mama Ngozi owes me eight thousand, and I sold two bags for twenty thousand cash"*), drafted server-side via Gemini with strict Zod validation into an editable review table that never auto-saves without owner confirmation.

---

## Architecture & Database Mode

During Phase 1 setup, Firebase provisioning was declined in favor of **Supabase (PostgreSQL + Auth + Storage + Row-Level Security)** paired with a **Node.js + Express** server and an automatic **SQLite (`better-sqlite3`)** local persistence engine when Supabase environment variables are not set.

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Motion, `vite-plugin-pwa`, lazy-loaded route chunks, and on-demand `pdf-lib` + `@pdf-lib/fontkit` + `qrcode` chunking.
- **Backend (`server.ts`)**: Express server on port `3000` serving `/api/*`, enforcing Content-Security-Policy (CSP) and endpoint rate limiters, dynamically injecting OpenGraph metadata for `/r/:publicId` receipt links, and keeping `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` strictly server-side.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Start full-stack dev server on http://localhost:3000
npm run dev
```

### Verification Commands

```bash
# Type-check the entire project
npm run lint

# Run all automated unit & security integration test suites
node --import tsx --test tests/*.test.ts

# Build production client & PWA service worker into dist/
npm run build

# Run production server (NODE_ENV=production)
NODE_ENV=production npm start
```

---

## Environment Variables (`.env.example`)

| Variable | Scope | Description |
| :--- | :--- | :--- |
| `APP_URL` | Server | Public origin URL used for OAuth callbacks, sitemap, and magic links. |
| `GEMINI_API_KEY` | **Server Secret** | Required for Phase 3 `/api/voice/parse` speech-to-entries drafting. Never exposed to the client bundle. |
| `VITE_SUPABASE_URL` | Client + Server | Optional Supabase project URL. Enables Supabase Auth, Postgres RLS, RPCs, and Storage. |
| `VITE_SUPABASE_ANON_KEY` | Client + Server | Optional Supabase anonymous public key (enforced by Postgres RLS). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server Secret** | Optional Supabase service role key used server-side by `DELETE /api/account` to purge `auth.users` and storage objects. |
| `GOOGLE_CLIENT_ID` | Server | Optional Google OAuth client ID for standalone Express auth mode. |
| `GOOGLE_CLIENT_SECRET` | **Server Secret** | Optional Google OAuth client secret for standalone Express auth mode. |
| `SESSION_SECRET` | **Server Secret** | HMAC secret used to hash session and magic-link tokens in standalone SQLite mode. |
| `VOICE_RATE_LIMIT_MAX` | Server | Per-user max requests to `/api/voice/parse` per 10-minute window (default: `12`). |
| `TALLYMARK_DATA_DIR` | Server | Optional directory path for standalone SQLite database and private expense/claim proof files (default: `./data`). |
| `DISABLE_PUBLIC_CLAIMS` | Server | Set `true` to immediately return `503` on public `"I've paid"` claim submissions and proof uploads. |
| `DISABLE_PUBLIC_QUOTE_ACTIONS` | Server | Set `true` to immediately return `503` on public quote accept/decline actions. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | **Server Secret** | Optional VAPID keypair for opt-in Web Push alerts (never sent with personal data). |
| `RETENTION_CRON_SECRET` | **Server Secret** | Secret header for `POST /api/v2/internal/retention-run` (90-day claim proof purge job). |

---

## Supabase Migrations & Storage Setup

If deploying against a hosted Supabase project, run the numbered SQL migration files in `supabase/migrations/` in order inside the Supabase SQL Editor:

1. `supabase/migrations/001_phase1_schema.sql` — Core tables (`businesses`, `customers`, `catalog_items`, `receipts`, `public_receipts`, `ledger_entries`), RLS policies, and atomic receipt RPCs (`issue_receipt`, `receive_balance`, `void_receipt`, `get_public_receipt`).
2. `supabase/migrations/002_phase2_cashbook.sql` — Cash book extensions (`credit_sales`, `creditors`, `expenses`, `expense_revisions`, `day_closures`), private `expense-proofs` storage bucket policies, and `record_credit_payment` / `issue_receipt_for_quick_sale` RPCs.
3. `supabase/migrations/003_phase4_analytics.sql` — First-party privacy-safe `analytics_events` table.
4. `supabase/migrations/004_phase5_hardening.sql` — Revokes direct table select on `public_receipts` (forcing single-lookup via `get_public_receipt(p_public_id)`), tightens `expense-proofs` owner-folder storage policies, enforces closed-day guards inside RPCs, and allows `void_receipt` after day close as a visible correction entry.
5. `supabase/migrations/005_v2_quotations_invoices.sql` — Additive, idempotent, transactional V2 schema for Quotations, Invoices, unified `debts`, `payments`, `payment_claims`, `payment_reminders`, `audit_log`, `usage_counters`, `push_subscriptions`, `rate_limits`, private `claim-proofs` bucket, RLS on every table (anon revoked), backfill of open V1 balances into `public.debts`, and hardened `SECURITY DEFINER` RPCs (`record_payment`, `v2_send_invoice`, `v2_void_payment_receipt`, `get_public_invoice`, etc.). Tested rollback script: `supabase/migrations/005_v2_quotations_invoices.rollback.sql`.
6. `supabase/migrations/006_v2_slice2_claims_push.sql` — Additive Slice 2 RPCs (`v2_confirm_claim`, `v2_reject_claim`, `v2_purge_expired_claim_proofs`) and updated `get_public_invoice` exposing only safe pending/rejected status flags (never private `decision_reason`). Rollback script: `supabase/migrations/006_v2_slice2_claims_push.rollback.sql`.
7. `supabase/migrations/007_v2_slice3_quotations.sql` — Additive Slice 3 quotation RPCs (`v2_save_quote_draft`, `v2_send_quote`, `v2_void_quote`, `v2_revise_quote`, `v2_regenerate_quote_link`, `v2_convert_quote_to_invoice`, `get_public_quote`, `v2_record_public_quote_decision`) and partial unique index `idx_invoices_source_quote_unique` preventing duplicate conversions under parallel requests. Rollback script: `supabase/migrations/007_v2_slice3_quotations.rollback.sql`.
8. `supabase/migrations/008_v2_slice4_receivables_reports.sql` — Additive Slice 4 receivables & reminders indexes (`idx_payment_reminders_debt_sent`, `idx_debts_business_source_status`) and hardened `SECURITY DEFINER` RPCs (`v2_sync_legacy_debts`, `v2_log_reminder`) for unified "Who owes me" sync and 3-day WhatsApp reminder tracking. Rollback script: `supabase/migrations/008_v2_slice4_receivables_reports.rollback.sql`.

> **VAT Notice**: When VAT is enabled on a business profile, Tallymark prints the business TIN/RC and a VAT line (exclusive or inclusive) on invoices and receipts. VAT wording, invoice disclosures, and tax compliance should be reviewed by a qualified Nigerian tax professional before statutory filing.

---

## Deploying to Vercel

`vercel.json` and `api/index.ts` are included so Vercel deploys both the Vite SPA (`dist/`) and the Express `/api/*` serverless function (for `/api/voice/parse`, `DELETE /api/account`, `/api/analytics`, and auth fallback).

1. **Set Environment Variables** in Vercel (**Project Settings -> Environment Variables**) and **Redeploy**:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` *(required for persistent production auth, receipts, cash book, and storage on Vercel — serverless `/tmp` SQLite is ephemeral across cold starts)*
   - `SUPABASE_SERVICE_ROLE_KEY` *(optional; enables full `auth.users` deletion in `DELETE /api/account`)*
   - `GEMINI_API_KEY` *(required for Phase 3 "Speak Your Day")*
   - `APP_URL` *(your Vercel domain, e.g. `https://your-app.vercel.app`)*
2. **Configure Supabase Redirect URLs**:
   - In Supabase (**Authentication -> URL Configuration**), set **Site URL** to `https://your-app.vercel.app` and add `https://your-app.vercel.app/**` under **Redirect URLs** so Google Sign-In and Email Magic Links redirect back to `/app` cleanly.

---

## Future Automation Architecture (Adding Webhooks & Payment Links Later)

Tallymark V1 is deliberately manual (typed or spoken) so the ledger remains clean and auditable. Because every money movement already flows through a single unified schema (`ledger_entries` + `receipts` + `credit_sales`), payment automation can be plugged in later without redesigning the database:

1. **Payment Links on Part-Paid Receipts & Credit Sales**:
   - Add an optional `payment_link_url` / `provider_reference` column to `receipts` and `credit_sales`, or a dedicated `payment_intents` table keyed by `(business_id, target_kind, target_id, provider_ref, amount_kobo, status)`.
   - On `/r/:publicId` (`PublicReceiptPage`), if `balanceDueKobo > 0` and a payment link is enabled for the business, render a *"Pay Balance"* button pointing to the checkout session.
2. **Incoming Payment Gateway Webhooks (Paystack / Flutterwave / Monnify)**:
   - Mount a raw-body webhook route on the Express server (`POST /api/webhooks/payments/:provider`) that verifies the provider's HMAC signature (`x-paystack-signature` / `verif-hash`) using a server-side secret.
   - Check idempotency against `provider_reference` so duplicate webhook deliveries are ignored.
   - Call the existing atomic database operations:
     - For a new checkout sale: invoke `issue_receipt` with `p_source = 'webhook'` and `p_payment_method = 'Transfer'` (or `'Card'`).
     - For an existing part-paid receipt or customer debt: invoke `receive_balance` or `record_credit_payment` to issue the linked `BALANCE_PAYMENT` receipt, decrement `balance_due_kobo`, and append the `PAYMENT_RECEIVED` row to `ledger_entries` automatically.
3. **Bank Transfer / POS Terminal Alerts**:
   - Incoming virtual-account or POS terminal webhooks can insert proposed rows into a `pending_webhook_entries` queue (similar to Phase 3's voice draft review screen) or auto-match open `PART_PAID` receipts by amount and customer reference.

---

Built by **Emmanuel Eleweke | Emmanuel of ZedTech**
