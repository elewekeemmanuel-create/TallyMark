import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.TALLYMARK_DATA_DIR
  ? path.resolve(process.env.TALLYMARK_DATA_DIR)
  : process.env.VERCEL
  ? path.join(os.tmpdir(), 'tallymark-data')
  : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const EXPENSE_PROOFS_DIR = path.join(DATA_DIR, 'expense-proofs');
if (!fs.existsSync(EXPENSE_PROOFS_DIR)) {
  fs.mkdirSync(EXPENSE_PROOFS_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'tallymark.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    auth_provider TEXT NOT NULL DEFAULT 'google',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    logo_data_url TEXT,
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    brand_color TEXT NOT NULL DEFAULT '#064E3B',
    receipt_prefix TEXT NOT NULL DEFAULT 'RCT-',
    next_sequence INTEGER NOT NULL DEFAULT 1,
    currency TEXT NOT NULL DEFAULT 'NGN',
    vat_enabled INTEGER NOT NULL DEFAULT 0,
    vat_mode TEXT NOT NULL DEFAULT 'exclusive',
    vat_rate_bps INTEGER NOT NULL DEFAULT 750,
    opening_cash_kobo INTEGER NOT NULL DEFAULT 0,
    default_template TEXT NOT NULL DEFAULT 'modern',
    close_day_reminder_time TEXT NOT NULL DEFAULT '19:00',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS catalog_items (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    unit_price_kobo INTEGER NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_catalog_business ON catalog_items(business_id, use_count DESC);

  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    public_id TEXT NOT NULL UNIQUE,
    sequence_number INTEGER NOT NULL,
    receipt_number TEXT NOT NULL,
    receipt_kind TEXT NOT NULL DEFAULT 'SALE',
    parent_receipt_id TEXT REFERENCES receipts(id),
    parent_receipt_number TEXT,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    items_json TEXT NOT NULL,
    subtotal_kobo INTEGER NOT NULL,
    discount_total_kobo INTEGER NOT NULL DEFAULT 0,
    vat_enabled INTEGER NOT NULL DEFAULT 0,
    vat_mode TEXT NOT NULL DEFAULT 'exclusive',
    vat_rate_bps INTEGER NOT NULL DEFAULT 750,
    vat_kobo INTEGER NOT NULL DEFAULT 0,
    total_kobo INTEGER NOT NULL,
    initial_paid_kobo INTEGER NOT NULL,
    amount_paid_kobo INTEGER NOT NULL,
    balance_due_kobo INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    sold_by TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    template TEXT NOT NULL DEFAULT 'modern',
    status TEXT NOT NULL DEFAULT 'PAID',
    void_reason TEXT,
    voided_at TEXT,
    voided_by TEXT,
    issued_date_lagos TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    UNIQUE(business_id, sequence_number)
  );
  CREATE INDEX IF NOT EXISTS idx_receipts_business_date ON receipts(business_id, issued_date_lagos DESC, sequence_number DESC);
  CREATE INDEX IF NOT EXISTS idx_receipts_parent ON receipts(parent_receipt_id);

  CREATE TABLE IF NOT EXISTS credit_sales (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    item_note TEXT NOT NULL DEFAULT '',
    total_kobo INTEGER NOT NULL,
    amount_paid_kobo INTEGER NOT NULL DEFAULT 0,
    balance_due_kobo INTEGER NOT NULL,
    due_date TEXT,
    sold_by TEXT NOT NULL DEFAULT '',
    receipt_id TEXT REFERENCES receipts(id),
    status TEXT NOT NULL DEFAULT 'UNPAID',
    entry_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credit_sales_business ON credit_sales(business_id, entry_date DESC);

  CREATE TABLE IF NOT EXISTS creditors (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    supplier_name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    amount_kobo INTEGER NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'UNPAID',
    paid_at TEXT,
    paid_method TEXT,
    expense_id TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_creditors_business ON creditors(business_id, status, due_date);

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entry_date TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL,
    category TEXT NOT NULL,
    payee TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    proof_path TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    ledger_entry_id TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses(business_id, entry_date DESC, created_at DESC);

  CREATE TABLE IF NOT EXISTS expense_revisions (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    previous_json TEXT NOT NULL,
    next_json TEXT,
    reason TEXT NOT NULL DEFAULT '',
    changed_at TEXT NOT NULL,
    changed_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS day_closures (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    close_date TEXT NOT NULL,
    opening_cash_kobo INTEGER NOT NULL,
    expected_cash_kobo INTEGER NOT NULL,
    counted_cash_kobo INTEGER NOT NULL,
    variance_kobo INTEGER NOT NULL,
    total_sales_kobo INTEGER NOT NULL DEFAULT 0,
    quick_sales_kobo INTEGER NOT NULL DEFAULT 0,
    receipt_sales_kobo INTEGER NOT NULL DEFAULT 0,
    credit_sales_kobo INTEGER NOT NULL DEFAULT 0,
    payments_received_kobo INTEGER NOT NULL DEFAULT 0,
    expenses_kobo INTEGER NOT NULL DEFAULT 0,
    net_kobo INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    closed_at TEXT NOT NULL,
    closed_by TEXT NOT NULL,
    UNIQUE(business_id, close_date)
  );
  CREATE INDEX IF NOT EXISTS idx_day_closures_business ON day_closures(business_id, close_date DESC);

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entry_type TEXT NOT NULL,
    entry_kind TEXT NOT NULL DEFAULT 'RECEIPT',
    amount_kobo INTEGER NOT NULL,
    cash_received_kobo INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT,
    receipt_id TEXT REFERENCES receipts(id),
    credit_sale_id TEXT REFERENCES credit_sales(id),
    expense_id TEXT REFERENCES expenses(id),
    parent_entry_id TEXT,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    sold_by TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    is_correction INTEGER NOT NULL DEFAULT 0,
    correction_reason TEXT NOT NULL DEFAULT '',
    entry_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_business_date ON ledger_entries(business_id, entry_date DESC, created_at DESC);

  CREATE TABLE IF NOT EXISTS public_receipts (
    public_id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
    receipt_number TEXT NOT NULL,
    receipt_kind TEXT NOT NULL,
    parent_receipt_number TEXT,
    business_name TEXT NOT NULL,
    business_logo_data_url TEXT,
    business_address TEXT NOT NULL DEFAULT '',
    business_phone TEXT NOT NULL DEFAULT '',
    business_email TEXT NOT NULL DEFAULT '',
    brand_color TEXT NOT NULL DEFAULT '#064E3B',
    currency TEXT NOT NULL DEFAULT 'NGN',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    items_json TEXT NOT NULL,
    subtotal_kobo INTEGER NOT NULL,
    discount_total_kobo INTEGER NOT NULL DEFAULT 0,
    vat_enabled INTEGER NOT NULL DEFAULT 0,
    vat_mode TEXT NOT NULL DEFAULT 'exclusive',
    vat_rate_bps INTEGER NOT NULL DEFAULT 750,
    vat_kobo INTEGER NOT NULL DEFAULT 0,
    total_kobo INTEGER NOT NULL,
    amount_paid_kobo INTEGER NOT NULL,
    balance_due_kobo INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    sold_by TEXT NOT NULL DEFAULT '',
    template TEXT NOT NULL DEFAULT 'modern',
    status TEXT NOT NULL,
    void_reason TEXT,
    voided_at TEXT,
    issued_date_lagos TEXT NOT NULL,
    issued_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '/',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at DESC);
`);

// Safe additive column migrations for existing Phase 1 databases
function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'password_hash', 'TEXT');
ensureColumn('businesses', 'signature_data_url', 'TEXT');
ensureColumn('public_receipts', 'business_signature_data_url', 'TEXT');
ensureColumn('businesses', 'close_day_reminder_time', "TEXT NOT NULL DEFAULT '19:00'");
ensureColumn('businesses', 'tin_rc', "TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'bank_accounts_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('businesses', 'modules_enabled_json', 'TEXT NOT NULL DEFAULT \'{"invoicesQuotes":false}\'');
ensureColumn('businesses', 'plan', "TEXT NOT NULL DEFAULT 'early_access'");
ensureColumn('businesses', 'invoice_prefix', "TEXT NOT NULL DEFAULT 'INV-'");
ensureColumn('businesses', 'next_invoice_sequence', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('businesses', 'quote_prefix', "TEXT NOT NULL DEFAULT 'QUO-'");
ensureColumn('businesses', 'next_quote_sequence', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('businesses', 'default_payment_terms_days', 'INTEGER NOT NULL DEFAULT 7');
ensureColumn('businesses', 'default_invoice_notes', "TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'v2_promo_dismissed', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('customers', 'address', "TEXT NOT NULL DEFAULT ''");
ensureColumn('customers', 'email', "TEXT NOT NULL DEFAULT ''");
ensureColumn('customers', 'notes', "TEXT NOT NULL DEFAULT ''");
ensureColumn('ledger_entries', 'entry_kind', "TEXT NOT NULL DEFAULT 'RECEIPT'");
ensureColumn('ledger_entries', 'credit_sale_id', 'TEXT REFERENCES credit_sales(id)');
ensureColumn('ledger_entries', 'expense_id', 'TEXT REFERENCES expenses(id)');
ensureColumn('ledger_entries', 'invoice_id', 'TEXT');
ensureColumn('ledger_entries', 'payment_id', 'TEXT');
ensureColumn('ledger_entries', 'customer_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('ledger_entries', 'customer_phone', "TEXT NOT NULL DEFAULT ''");
ensureColumn('ledger_entries', 'is_correction', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('ledger_entries', 'correction_reason', "TEXT NOT NULL DEFAULT ''");

// V2 Additive Tables (mirrors supabase/migrations/005_v2_quotations_invoices.sql)
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    public_id TEXT NOT NULL UNIQUE,
    sequence_number INTEGER,
    invoice_number TEXT,
    idempotency_key TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    issue_date TEXT NOT NULL,
    terms_kind TEXT NOT NULL DEFAULT 'net_7',
    due_date TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'NGN',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    customer_address TEXT NOT NULL DEFAULT '',
    subtotal_kobo INTEGER NOT NULL DEFAULT 0,
    line_discount_total_kobo INTEGER NOT NULL DEFAULT 0,
    invoice_discount_kobo INTEGER NOT NULL DEFAULT 0,
    vat_enabled INTEGER NOT NULL DEFAULT 0,
    vat_mode TEXT NOT NULL DEFAULT 'exclusive',
    vat_rate_bps INTEGER NOT NULL DEFAULT 750,
    vat_kobo INTEGER NOT NULL DEFAULT 0,
    total_kobo INTEGER NOT NULL DEFAULT 0,
    deposit_type TEXT NOT NULL DEFAULT 'none',
    deposit_value INTEGER NOT NULL DEFAULT 0,
    amount_due_now_kobo INTEGER NOT NULL DEFAULT 0,
    amount_paid_kobo INTEGER NOT NULL DEFAULT 0,
    written_off_kobo INTEGER NOT NULL DEFAULT 0,
    balance_due_kobo INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    bank_account_ids_json TEXT NOT NULL DEFAULT '[]',
    template TEXT NOT NULL DEFAULT 'modern',
    snapshot_json TEXT,
    source_quote_id TEXT,
    reissued_from_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    sent_at TEXT,
    void_reason TEXT,
    voided_at TEXT,
    write_off_reason TEXT,
    written_off_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    UNIQUE(business_id, sequence_number),
    UNIQUE(business_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_business_date ON invoices(business_id, issue_date DESC, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_source_quote_unique ON invoices(source_quote_id) WHERE source_quote_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS invoice_lines (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    qty_thousandths INTEGER NOT NULL,
    unit_price_kobo INTEGER NOT NULL,
    discount_kobo INTEGER NOT NULL DEFAULT 0,
    gross_kobo INTEGER NOT NULL DEFAULT 0,
    line_total_kobo INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id, position);

  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    public_id TEXT NOT NULL UNIQUE,
    sequence_number INTEGER,
    quote_number TEXT,
    idempotency_key TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    issue_date TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    terms_kind TEXT NOT NULL DEFAULT 'net_7',
    currency TEXT NOT NULL DEFAULT 'NGN',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    customer_address TEXT NOT NULL DEFAULT '',
    subtotal_kobo INTEGER NOT NULL DEFAULT 0,
    line_discount_total_kobo INTEGER NOT NULL DEFAULT 0,
    invoice_discount_kobo INTEGER NOT NULL DEFAULT 0,
    vat_enabled INTEGER NOT NULL DEFAULT 0,
    vat_mode TEXT NOT NULL DEFAULT 'exclusive',
    vat_rate_bps INTEGER NOT NULL DEFAULT 750,
    vat_kobo INTEGER NOT NULL DEFAULT 0,
    total_kobo INTEGER NOT NULL DEFAULT 0,
    deposit_type TEXT NOT NULL DEFAULT 'none',
    deposit_value INTEGER NOT NULL DEFAULT 0,
    amount_due_now_kobo INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    bank_account_ids_json TEXT NOT NULL DEFAULT '[]',
    template TEXT NOT NULL DEFAULT 'modern',
    snapshot_json TEXT,
    converted_invoice_id TEXT UNIQUE REFERENCES invoices(id) ON DELETE SET NULL,
    revised_from_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
    sent_at TEXT,
    decision_name TEXT,
    decision_note TEXT,
    decision_at TEXT,
    decision_ip_hash TEXT,
    void_reason TEXT,
    voided_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    UNIQUE(business_id, sequence_number),
    UNIQUE(business_id, idempotency_key)
  );

  CREATE TABLE IF NOT EXISTS quote_lines (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    qty_thousandths INTEGER NOT NULL,
    unit_price_kobo INTEGER NOT NULL,
    discount_kobo INTEGER NOT NULL DEFAULT 0,
    gross_kobo INTEGER NOT NULL DEFAULT 0,
    line_total_kobo INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS debts (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    reference_number TEXT NOT NULL DEFAULT '',
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    issue_date TEXT NOT NULL,
    due_date TEXT,
    total_kobo INTEGER NOT NULL,
    amount_paid_kobo INTEGER NOT NULL DEFAULT 0,
    written_off_kobo INTEGER NOT NULL DEFAULT 0,
    balance_due_kobo INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_type, source_id)
  );
  CREATE INDEX IF NOT EXISTS idx_debts_business_status ON debts(business_id, status, due_date);

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    receipt_id TEXT REFERENCES receipts(id) ON DELETE SET NULL,
    ledger_entry_id TEXT REFERENCES ledger_entries(id) ON DELETE SET NULL,
    amount_kobo INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    is_voided INTEGER NOT NULL DEFAULT 0,
    void_reason TEXT,
    voided_at TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    UNIQUE(business_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_payments_debt ON payments(debt_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS payment_claims (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    claim_ref TEXT NOT NULL UNIQUE,
    payer_name TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    proof_path TEXT,
    proof_mime TEXT,
    proof_size_bytes INTEGER,
    proof_deleted_at TEXT,
    upload_token_hash TEXT,
    upload_token_expires_at TEXT,
    upload_token_used_at TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    decision_reason TEXT,
    decided_at TEXT,
    decided_by TEXT,
    payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
    ip_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_reminders (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    tone TEXT NOT NULL DEFAULT 'gentle',
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    sent_at TEXT NOT NULL,
    sent_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_business ON audit_log(business_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS usage_counters (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    month_key TEXT NOT NULL,
    receipts_issued INTEGER NOT NULL DEFAULT 0,
    invoices_issued INTEGER NOT NULL DEFAULT 0,
    quotes_issued INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE(business_id, month_key)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth_secret TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (bucket_key, window_start)
  );
`);

// Database-level SQLite triggers enforcing closed-day immutability (mirrors PostgreSQL triggers)
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_sqlite_closed_day_ledger_insert
  BEFORE INSERT ON ledger_entries
  WHEN EXISTS (
    SELECT 1 FROM day_closures
    WHERE business_id = NEW.business_id AND close_date = NEW.entry_date
  ) AND NOT (NEW.is_correction = 1 AND NEW.entry_type = 'ADJUSTMENT')
  BEGIN
    SELECT RAISE(ABORT, 'CLOSED_DAY_MUTATION_BLOCKED');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sqlite_closed_day_ledger_update
  BEFORE UPDATE ON ledger_entries
  WHEN EXISTS (
    SELECT 1 FROM day_closures
    WHERE business_id = OLD.business_id AND close_date = OLD.entry_date
  ) AND NOT (
    OLD.receipt_id IS NULL AND NEW.receipt_id IS NOT NULL
    AND NEW.amount_kobo = OLD.amount_kobo AND NEW.cash_received_kobo = OLD.cash_received_kobo
  )
  BEGIN
    SELECT RAISE(ABORT, 'CLOSED_DAY_MUTATION_BLOCKED');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sqlite_closed_day_ledger_delete
  BEFORE DELETE ON ledger_entries
  WHEN EXISTS (
    SELECT 1 FROM day_closures
    WHERE business_id = OLD.business_id AND close_date = OLD.entry_date
  )
  BEGIN
    SELECT RAISE(ABORT, 'CLOSED_DAY_MUTATION_BLOCKED');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sqlite_closed_day_expense_insert
  BEFORE INSERT ON expenses
  WHEN EXISTS (
    SELECT 1 FROM day_closures
    WHERE business_id = NEW.business_id AND close_date = NEW.entry_date
  )
  BEGIN
    SELECT RAISE(ABORT, 'CLOSED_DAY_MUTATION_BLOCKED');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sqlite_closed_day_expense_update
  BEFORE UPDATE ON expenses
  WHEN EXISTS (
    SELECT 1 FROM day_closures
    WHERE business_id = OLD.business_id AND close_date = OLD.entry_date
  ) OR EXISTS (
    SELECT 1 FROM day_closures
    WHERE business_id = NEW.business_id AND close_date = NEW.entry_date
  )
  BEGIN
    SELECT RAISE(ABORT, 'CLOSED_DAY_MUTATION_BLOCKED');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sqlite_closed_day_expense_delete
  BEFORE DELETE ON expenses
  WHEN EXISTS (
    SELECT 1 FROM day_closures
    WHERE business_id = OLD.business_id AND close_date = OLD.entry_date
  )
  BEGIN
    SELECT RAISE(ABORT, 'CLOSED_DAY_MUTATION_BLOCKED');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_sqlite_public_receipt_signature_snapshot
  AFTER INSERT ON public_receipts
  WHEN NEW.business_signature_data_url IS NULL
  BEGIN
    UPDATE public_receipts
    SET business_signature_data_url = (
      SELECT b.signature_data_url
      FROM receipts r
      JOIN businesses b ON b.id = r.business_id
      WHERE r.id = NEW.receipt_id
    )
    WHERE public_id = NEW.public_id;
  END;
`);

export function isDayClosed(businessId: string, date: string): boolean {
  const row = db
    .prepare('SELECT id FROM day_closures WHERE business_id = ? AND close_date = ?')
    .get(businessId, date);
  return Boolean(row);
}

let txDepth = 0;

export function runTransaction<T>(fn: () => T): T {
  const isRoot = txDepth === 0;
  const sp = `sp_${txDepth}`;
  if (isRoot) {
    db.exec('BEGIN IMMEDIATE');
  } else {
    db.exec(`SAVEPOINT ${sp}`);
  }
  txDepth += 1;
  try {
    const result = fn();
    txDepth -= 1;
    if (isRoot) {
      db.exec('COMMIT');
    } else {
      db.exec(`RELEASE SAVEPOINT ${sp}`);
    }
    return result;
  } catch (err) {
    txDepth -= 1;
    try {
      if (isRoot) {
        db.exec('ROLLBACK');
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
        db.exec(`RELEASE SAVEPOINT ${sp}`);
      }
    } catch {
      // ignore rollback error if already rolled back
    }
    throw err;
  }
}

export function logError(context: string, err: unknown, meta?: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      context,
      message: err instanceof Error ? err.message : String(err),
      ...meta,
    })
  );
}
