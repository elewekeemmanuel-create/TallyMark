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
| `TALLYMARK_DATA_DIR` | Server | Optional directory path for standalone SQLite database and private expense proof files (default: `./data`). |

---

## Supabase Migrations & Storage Setup

If deploying against a hosted Supabase project, run the numbered SQL migration files in `supabase/migrations/` in order inside the Supabase SQL Editor:

1. `supabase/migrations/001_phase1_schema.sql` — Core tables (`businesses`, `customers`, `catalog_items`, `receipts`, `public_receipts`, `ledger_entries`), RLS policies, and atomic receipt RPCs (`issue_receipt`, `receive_balance`, `void_receipt`, `get_public_receipt`).
2. `supabase/migrations/002_phase2_cashbook.sql` — Cash book extensions (`credit_sales`, `creditors`, `expenses`, `expense_revisions`, `day_closures`), private `expense-proofs` storage bucket policies, and `record_credit_payment` / `issue_receipt_for_quick_sale` RPCs.
3. `supabase/migrations/003_phase4_analytics.sql` — First-party privacy-safe `analytics_events` table.
4. `supabase/migrations/004_phase5_hardening.sql` — Revokes direct table select on `public_receipts` (forcing single-lookup via `get_public_receipt(p_public_id)`), tightens `expense-proofs` owner-folder storage policies, enforces closed-day guards inside RPCs, and allows `void_receipt` after day close as a visible correction entry.

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
