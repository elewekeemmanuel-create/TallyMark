import { api, ApiError, getStoredSessionToken } from '../lib/api';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { formatKobo, getLagosDateString, type CurrencyCode } from '../shared/money';
import { buildCsv, getEntrySignedFlow } from '../shared/cashbook';
import type { BusinessProfile, LedgerEntryRecord, ReceiptRecord } from '../shared/types';
import {
  computeAgeingBucket,
  computeCustomerStatement,
  isInvoiceOverdue,
  isQuoteExpired,
  isRemindedWithin3Days,
  type AgeingBucket,
  type DepositType,
  type PaymentTermsKind,
  type StatementInvoiceInput,
  type StatementPaymentInput,
} from '../shared/v2/money';
import type {
  AgeingBucketFilter,
  AgeingBucketTotals,
  BankAccount,
  CustomerDirectoryItem,
  CustomerStatementRecord,
  DebtRecord,
  InvoiceLineRecord,
  InvoiceRecord,
  PaymentClaimRecord,
  PaymentRecord,
  PaymentReminderRecord,
  PublicInvoiceRecord,
  PushStatusRecord,
  QuoteRecord,
  ReceivableItem,
  ReceivableSourceFilter,
  V2CsvExportType,
  V2ReportsSummary,
} from '../shared/v2/types';

async function v2Request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getStoredSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(path, { ...init, headers, credentials: 'include' });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
  }
  return data as T;
}

function mapSupaBusiness(row: any): BusinessProfile {
  const mods = row.modules_enabled || {};
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    logoDataUrl: row.logo_data_url || null,
    address: row.address || '',
    phone: row.phone || '',
    email: row.email || '',
    brandColor: row.brand_color || '#064E3B',
    receiptPrefix: row.receipt_prefix || 'RCT-',
    nextSequence: Number(row.next_sequence),
    currency: (row.currency || 'NGN') as CurrencyCode,
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    vatRateBps: Number(row.vat_rate_bps ?? 750),
    openingCashKobo: Number(row.opening_cash_kobo ?? 0),
    defaultTemplate: row.default_template || 'modern',
    closeDayReminderTime: row.close_day_reminder_time || '19:00',
    tinRc: row.tin_rc || '',
    bankAccounts: Array.isArray(row.bank_accounts) ? row.bank_accounts : [],
    modulesEnabled: {
      invoicesQuotes: Boolean(mods.invoices_quotes ?? mods.invoicesQuotes ?? false),
    },
    plan: row.plan || 'early_access',
    invoicePrefix: row.invoice_prefix || 'INV-',
    nextInvoiceSequence: Number(row.next_invoice_sequence ?? 1),
    quotePrefix: row.quote_prefix || 'QUO-',
    nextQuoteSequence: Number(row.next_quote_sequence ?? 1),
    defaultPaymentTermsDays: Number(row.default_payment_terms_days ?? 7),
    defaultInvoiceNotes: row.default_invoice_notes || '',
    v2PromoDismissed: Boolean(row.v2_promo_dismissed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupaInvoice(row: any, lines: InvoiceLineRecord[], debtId: string | null): InvoiceRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id || null,
    publicId: row.public_id,
    sequenceNumber: row.sequence_number ?? null,
    invoiceNumber: row.invoice_number || null,
    idempotencyKey: row.idempotency_key || null,
    status: row.status,
    isOverdue: isInvoiceOverdue(row.status, row.due_date, Number(row.balance_due_kobo)),
    issueDate: row.issue_date,
    termsKind: row.terms_kind as PaymentTermsKind,
    dueDate: row.due_date,
    currency: (row.currency || 'NGN') as CurrencyCode,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    customerEmail: row.customer_email || '',
    customerAddress: row.customer_address || '',
    lines,
    subtotalKobo: Number(row.subtotal_kobo),
    lineDiscountTotalKobo: Number(row.line_discount_total_kobo),
    invoiceDiscountKobo: Number(row.invoice_discount_kobo),
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    vatRateBps: Number(row.vat_rate_bps ?? 750),
    vatKobo: Number(row.vat_kobo),
    totalKobo: Number(row.total_kobo),
    depositType: (row.deposit_type || 'none') as DepositType,
    depositValue: Number(row.deposit_value ?? 0),
    amountDueNowKobo: Number(row.amount_due_now_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    writtenOffKobo: Number(row.written_off_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    notes: row.notes || '',
    bankAccountIds: Array.isArray(row.bank_account_ids) ? row.bank_account_ids : [],
    template: row.template || 'modern',
    snapshot: row.snapshot_json || null,
    sourceQuoteId: row.source_quote_id || null,
    reissuedFromId: row.reissued_from_id || null,
    sentAt: row.sent_at || null,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    writeOffReason: row.write_off_reason || null,
    writtenOffAt: row.written_off_at || null,
    debtId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function mapSupaLines(rows: any[]): InvoiceLineRecord[] {
  return (rows || []).map((r) => ({
    id: r.id,
    position: Number(r.position ?? 0),
    description: r.description,
    qtyThousandths: Number(r.qty_thousandths),
    unitPriceKobo: Number(r.unit_price_kobo),
    discountKobo: Number(r.discount_kobo),
    grossKobo: Number(r.gross_kobo),
    lineTotalKobo: Number(r.line_total_kobo),
  }));
}

function mapSupaPayment(row: any, receiptNumber?: string | null, receiptPublicId?: string | null): PaymentRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    debtId: row.debt_id,
    invoiceId: row.invoice_id || null,
    receiptId: row.receipt_id || null,
    receiptNumber: receiptNumber ?? row.receipt_number ?? null,
    receiptPublicId: receiptPublicId ?? row.receipt_public_id ?? null,
    ledgerEntryId: row.ledger_entry_id || null,
    amountKobo: Number(row.amount_kobo),
    paymentMethod: row.payment_method,
    paymentDate: row.payment_date,
    reference: row.reference || '',
    idempotencyKey: row.idempotency_key,
    isVoided: Boolean(row.is_voided),
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export interface V2Summary {
  unpaidTotalKobo: number;
  unpaidCount: number;
  overdueCount: number;
  overdueTotalKobo: number;
  draftCount: number;
  pendingClaimsCount: number;
}

export interface SaveQuotePayload {
  customerId?: string | null;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  issueDate?: string;
  validUntil?: string | null;
  termsKind: PaymentTermsKind;
  lines: Array<{
    description: string;
    qtyThousandths: number;
    unitPriceKobo: number;
    discountKobo?: number;
  }>;
  invoiceDiscountKobo?: number;
  depositType?: DepositType;
  depositValue?: number;
  notes?: string;
  bankAccountIds?: string[];
  template?: 'modern' | 'classic' | 'compact';
  idempotencyKey?: string;
  sendNow?: boolean;
}

export const v2Api = {
  async getSummary(): Promise<{ summary: V2Summary }> {
    if (isSupabaseConfigured && supabase) {
      const [{ data, error }, { count: pendingCount }] = await Promise.all([
        supabase.from('invoices').select('status, due_date, balance_due_kobo'),
        supabase
          .from('payment_claims')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'PENDING'),
      ]);
      if (error) throw new ApiError(error.message, 400);
      let unpaidTotalKobo = 0;
      let unpaidCount = 0;
      let overdueCount = 0;
      let overdueTotalKobo = 0;
      let draftCount = 0;
      for (const r of data || []) {
        if (r.status === 'DRAFT') {
          draftCount += 1;
        } else if ((r.status === 'SENT' || r.status === 'PART_PAID') && Number(r.balance_due_kobo) > 0) {
          const bal = Number(r.balance_due_kobo);
          unpaidCount += 1;
          unpaidTotalKobo += bal;
          if (isInvoiceOverdue(r.status, r.due_date, bal)) {
            overdueCount += 1;
            overdueTotalKobo += bal;
          }
        }
      }
      return {
        summary: {
          unpaidTotalKobo,
          unpaidCount,
          overdueCount,
          overdueTotalKobo,
          draftCount,
          pendingClaimsCount: Number(pendingCount || 0),
        },
      };
    }
    return v2Request('/api/v2/summary');
  },

  async updateBillingSettings(payload: {
    tinRc?: string;
    bankAccounts?: BankAccount[];
    invoicePrefix?: string;
    quotePrefix?: string;
    defaultPaymentTermsDays?: number;
    defaultInvoiceNotes?: string;
  }): Promise<{ business: BusinessProfile }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_update_billing_settings', {
        p_tin_rc: payload.tinRc ?? null,
        p_bank_accounts: payload.bankAccounts ?? null,
        p_invoice_prefix: payload.invoicePrefix ?? null,
        p_quote_prefix: payload.quotePrefix ?? null,
        p_default_payment_terms_days: payload.defaultPaymentTermsDays ?? null,
        p_default_invoice_notes: payload.defaultInvoiceNotes ?? null,
      });
      if (error) throw new ApiError(error.message, 400);
      return { business: mapSupaBusiness(data) };
    }
    return v2Request('/api/v2/settings/billing', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async listInvoices(params?: { status?: string; q?: string }): Promise<{ invoices: InvoiceRecord[] }> {
    if (isSupabaseConfigured && supabase) {
      const { data: rows, error } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new ApiError(error.message, 400);
      const ids = (rows || []).map((r: any) => r.id);
      const [linesRes, debtsRes] = ids.length
        ? await Promise.all([
            supabase.from('invoice_lines').select('*').in('invoice_id', ids).order('position', { ascending: true }),
            supabase.from('debts').select('id, source_id').eq('source_type', 'INVOICE').in('source_id', ids),
          ])
        : [{ data: [] }, { data: [] }];

      const linesByInv = new Map<string, InvoiceLineRecord[]>();
      for (const l of mapSupaLines(linesRes.data || [])) {
        const raw = (linesRes.data || []).find((x: any) => x.id === l.id);
        const invId = raw?.invoice_id;
        if (!invId) continue;
        const arr = linesByInv.get(invId) || [];
        arr.push(l);
        linesByInv.set(invId, arr);
      }
      const debtByInv = new Map<string, string>();
      for (const d of debtsRes.data || []) {
        debtByInv.set(d.source_id, d.id);
      }

      let mapped = (rows || []).map((r: any) =>
        mapSupaInvoice(r, linesByInv.get(r.id) || [], debtByInv.get(r.id) || null)
      );
      if (params?.status === 'OVERDUE') {
        mapped = mapped.filter((i) => i.isOverdue);
      } else if (params?.status && params.status !== 'ALL') {
        mapped = mapped.filter((i) => i.status === params.status);
      }
      if (params?.q?.trim()) {
        const needle = params.q.trim().toLowerCase();
        mapped = mapped.filter((i) =>
          `${i.invoiceNumber || ''} ${i.customerName} ${i.notes}`.toLowerCase().includes(needle)
        );
      }
      return { invoices: mapped };
    }

    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.q) qs.set('q', params.q);
    return v2Request(`/api/v2/invoices${qs.toString() ? `?${qs.toString()}` : ''}`);
  },

  async getInvoice(id: string): Promise<{ invoice: InvoiceRecord; payments: PaymentRecord[] }> {
    if (isSupabaseConfigured && supabase) {
      const [{ data: inv, error }, { data: lines }, { data: debt }, { data: pays }] =
        await Promise.all([
          supabase.from('invoices').select('*').eq('id', id).single(),
          supabase.from('invoice_lines').select('*').eq('invoice_id', id).order('position', { ascending: true }),
          supabase.from('debts').select('id').eq('source_type', 'INVOICE').eq('source_id', id).maybeSingle(),
          supabase.from('payments').select('*').eq('invoice_id', id).order('created_at', { ascending: false }),
        ]);
      if (error || !inv) throw new ApiError(error?.message || 'Invoice not found', 404);

      const receiptIds = (pays || []).map((p: any) => p.receipt_id).filter(Boolean);
      const rcptMap = new Map<string, { receipt_number: string; public_id: string }>();
      if (receiptIds.length) {
        const { data: rcpts } = await supabase
          .from('receipts')
          .select('id, receipt_number, public_id')
          .in('id', receiptIds);
        for (const r of rcpts || []) {
          rcptMap.set(r.id, { receipt_number: r.receipt_number, public_id: r.public_id });
        }
      }

      return {
        invoice: mapSupaInvoice(inv, mapSupaLines(lines || []), debt?.id || null),
        payments: (pays || []).map((p: any) => {
          const r = p.receipt_id ? rcptMap.get(p.receipt_id) : undefined;
          return mapSupaPayment(p, r?.receipt_number, r?.public_id);
        }),
      };
    }
    return v2Request(`/api/v2/invoices/${encodeURIComponent(id)}`);
  },

  async saveInvoice(
    payload: {
      invoiceId?: string | null;
      customerId?: string | null;
      customerName: string;
      customerPhone?: string;
      customerEmail?: string;
      customerAddress?: string;
      issueDate?: string;
      termsKind: PaymentTermsKind;
      dueDate?: string | null;
      lines: Array<{
        description: string;
        qtyThousandths: number;
        unitPriceKobo: number;
        discountKobo?: number;
      }>;
      invoiceDiscountKobo?: number;
      depositType?: DepositType;
      depositValue?: number;
      notes?: string;
      bankAccountIds?: string[];
      template?: string;
      idempotencyKey?: string;
      sendNow?: boolean;
    }
  ): Promise<{ invoice: InvoiceRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { data: draft, error } = await supabase.rpc('v2_save_invoice_draft', {
        p_invoice_id: payload.invoiceId || null,
        p_customer_id: payload.customerId || null,
        p_customer_name: payload.customerName,
        p_customer_phone: payload.customerPhone || '',
        p_customer_email: payload.customerEmail || '',
        p_customer_address: payload.customerAddress || '',
        p_issue_date: payload.issueDate || getLagosDateString(),
        p_terms_kind: payload.termsKind,
        p_due_date: payload.dueDate || null,
        p_lines: payload.lines,
        p_invoice_discount_kobo: payload.invoiceDiscountKobo || 0,
        p_deposit_type: payload.depositType || 'none',
        p_deposit_value: payload.depositValue || 0,
        p_notes: payload.notes || '',
        p_bank_account_ids: payload.bankAccountIds || [],
        p_template: payload.template || '',
        p_idempotency_key: payload.idempotencyKey || null,
      });
      if (error) throw new ApiError(error.message, 400);

      let finalId = draft.id as string;
      if (payload.sendNow && draft.status === 'DRAFT') {
        const { data: sent, error: sendErr } = await supabase.rpc('v2_send_invoice', {
          p_invoice_id: finalId,
        });
        if (sendErr) throw new ApiError(sendErr.message, 400);
        finalId = sent.id;
      }
      const fetched = await this.getInvoice(finalId);
      return { invoice: fetched.invoice };
    }

    if (payload.invoiceId) {
      return v2Request(`/api/v2/invoices/${encodeURIComponent(payload.invoiceId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    }
    return v2Request('/api/v2/invoices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async sendInvoice(id: string): Promise<{ invoice: InvoiceRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('v2_send_invoice', { p_invoice_id: id });
      if (error) throw new ApiError(error.message, 400);
      const fetched = await this.getInvoice(id);
      return { invoice: fetched.invoice };
    }
    return v2Request(`/api/v2/invoices/${encodeURIComponent(id)}/send`, { method: 'POST' });
  },

  async voidInvoice(id: string, reason: string): Promise<{ invoice: InvoiceRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('v2_void_invoice', { p_invoice_id: id, p_reason: reason });
      if (error) throw new ApiError(error.message, 400);
      const fetched = await this.getInvoice(id);
      return { invoice: fetched.invoice };
    }
    return v2Request(`/api/v2/invoices/${encodeURIComponent(id)}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async reissueInvoice(id: string, reason?: string): Promise<{ invoice: InvoiceRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_reissue_invoice', {
        p_invoice_id: id,
        p_reason: reason || 'Reissued with corrections',
      });
      if (error) throw new ApiError(error.message, 400);
      const fetched = await this.getInvoice(data.id);
      return { invoice: fetched.invoice };
    }
    return v2Request(`/api/v2/invoices/${encodeURIComponent(id)}/reissue`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Reissued with corrections' }),
    });
  },

  async writeOffInvoice(id: string, reason: string): Promise<{ invoice: InvoiceRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('v2_write_off_invoice', {
        p_invoice_id: id,
        p_reason: reason,
      });
      if (error) throw new ApiError(error.message, 400);
      const fetched = await this.getInvoice(id);
      return { invoice: fetched.invoice };
    }
    return v2Request(`/api/v2/invoices/${encodeURIComponent(id)}/write-off`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async regenerateInvoiceLink(id: string): Promise<{ invoice: InvoiceRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('v2_regenerate_invoice_link', { p_invoice_id: id });
      if (error) throw new ApiError(error.message, 400);
      const fetched = await this.getInvoice(id);
      return { invoice: fetched.invoice };
    }
    return v2Request(`/api/v2/invoices/${encodeURIComponent(id)}/regenerate-link`, {
      method: 'POST',
    });
  },

  async recordPayment(payload: {
    debtId: string;
    amountKobo: number;
    paymentMethod: string;
    paymentDate: string;
    reference?: string;
    idempotencyKey: string;
  }): Promise<{
    payment: PaymentRecord;
    receipt: ReceiptRecord | null;
    debt: DebtRecord | null;
    idempotentReplay: boolean;
  }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('record_payment', {
        p_debt_id: payload.debtId,
        p_amount_kobo: payload.amountKobo,
        p_method: payload.paymentMethod,
        p_payment_date: payload.paymentDate,
        p_reference: payload.reference || '',
        p_idempotency_key: payload.idempotencyKey,
      });
      if (error) throw new ApiError(error.message, 400);
      const r = data?.receipt;
      return {
        payment: mapSupaPayment(data?.payment, r?.receipt_number, r?.public_id),
        receipt: r || null,
        debt: data?.debt || null,
        idempotentReplay: Boolean(data?.idempotentReplay),
      };
    }
    return v2Request('/api/v2/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async voidPaymentByReceipt(receiptId: string, reason: string): Promise<{ ok: boolean }> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('v2_void_payment_receipt', {
        p_receipt_id: receiptId,
        p_reason: reason,
      });
      if (error) throw new ApiError(error.message, 400);
      return { ok: true };
    }
    await v2Request(`/api/v2/payments/void-by-receipt/${encodeURIComponent(receiptId)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return { ok: true };
  },

  async getPublicInvoice(publicId: string): Promise<{ invoice: PublicInvoiceRecord }> {
    return v2Request(`/api/v2/public/invoices/${encodeURIComponent(publicId)}`);
  },

  // ---- SLICE 2: PAYMENT CLAIMS & WEB PUSH ----
  async listClaims(params?: {
    status?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'ALL';
    invoiceId?: string;
  }): Promise<{ claims: PaymentClaimRecord[] }> {
    if (isSupabaseConfigured && supabase) {
      let query = supabase
        .from('payment_claims')
        .select(
          `*, invoices:invoice_id (invoice_number, customer_name, total_kobo, balance_due_kobo, currency, status)`
        )
        .order('created_at', { ascending: false })
        .limit(200);
      if (params?.status && params.status !== 'ALL') {
        query = query.eq('status', params.status);
      }
      if (params?.invoiceId) {
        query = query.eq('invoice_id', params.invoiceId);
      }
      const { data: rows, error } = await query;
      if (error) throw new ApiError(error.message, 400);

      const list = (rows || []).map((r: any) => {
        const inv = r.invoices || {};
        return {
          id: r.id,
          businessId: r.business_id,
          invoiceId: r.invoice_id,
          invoiceNumber: inv.invoice_number || null,
          invoiceCustomerName: inv.customer_name || '',
          invoiceTotalKobo: Number(inv.total_kobo ?? 0),
          invoiceBalanceDueKobo: Number(inv.balance_due_kobo ?? 0),
          invoiceCurrency: (inv.currency || 'NGN') as CurrencyCode,
          invoiceStatus: inv.status || 'SENT',
          claimRef: r.claim_ref,
          payerName: r.payer_name,
          amountKobo: Number(r.amount_kobo),
          reference: r.reference || '',
          hasProof: Boolean(r.proof_path && !r.proof_deleted_at),
          proofMime: r.proof_mime || null,
          proofSizeBytes: r.proof_size_bytes !== null ? Number(r.proof_size_bytes) : null,
          proofDeletedAt: r.proof_deleted_at || null,
          status: r.status,
          decisionReason: r.decision_reason || null,
          decidedAt: r.decided_at || null,
          decidedBy: r.decided_by || null,
          paymentId: r.payment_id || null,
          duplicateWarning: null as PaymentClaimRecord['duplicateWarning'],
          createdAt: r.created_at,
        };
      });

      // Compute 7-day duplicate warnings client-side in Supabase direct mode
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      for (const c of list) {
        const cMs = Date.parse(c.createdAt) || Date.now();
        const refNorm = c.reference.trim().toLowerCase();
        const matches = list.filter((o) => {
          if (o.id === c.id || o.invoiceId !== c.invoiceId || o.status === 'REJECTED') return false;
          const oMs = Date.parse(o.createdAt) || 0;
          if (Math.abs(cMs - oMs) > sevenDaysMs) return false;
          const sameAmt = o.amountKobo === c.amountKobo;
          const sameRef = Boolean(refNorm && o.reference.trim().toLowerCase() === refNorm);
          return sameAmt || sameRef;
        });
        if (matches.length > 0) {
          c.duplicateWarning = {
            reason:
              'Same amount or reference already seen on this invoice within 7 days. Check your bank statement before confirming.',
            matchingClaimRefs: matches.map((m) => m.claimRef),
            matchingPaymentIds: [],
          };
        }
      }

      return { claims: list };
    }

    const qs = new URLSearchParams();
    if (params?.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params?.invoiceId) qs.set('invoiceId', params.invoiceId);
    return v2Request(`/api/v2/claims${qs.toString() ? `?${qs.toString()}` : ''}`);
  },

  async getClaimProofUrl(claimId: string): Promise<{
    url: string;
    mime: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }> {
    if (isSupabaseConfigured && supabase) {
      const { data: row, error } = await supabase
        .from('payment_claims')
        .select('proof_path, proof_mime, proof_size_bytes, proof_deleted_at')
        .eq('id', claimId)
        .single();
      if (error || !row?.proof_path || row.proof_deleted_at) {
        throw new ApiError('Proof file is no longer available', 404);
      }
      const { data: signed, error: signErr } = await supabase.storage
        .from('claim-proofs')
        .createSignedUrl(row.proof_path, 120);
      if (signErr || !signed?.signedUrl) {
        throw new ApiError('Unable to create signed proof link', 500);
      }
      return {
        url: signed.signedUrl,
        mime: row.proof_mime || 'application/octet-stream',
        sizeBytes: Number(row.proof_size_bytes || 0),
        expiresInSeconds: 120,
      };
    }
    return v2Request(`/api/v2/claims/${encodeURIComponent(claimId)}/proof-url`);
  },

  async confirmClaim(
    claimId: string,
    payload: {
      amountKobo?: number;
      paymentMethod?: string;
      paymentDate?: string;
      reference?: string;
      idempotencyKey?: string;
    } = {}
  ): Promise<{
    claim: PaymentClaimRecord;
    payment: PaymentRecord;
    receipt: ReceiptRecord | null;
    debt: DebtRecord | null;
  }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_confirm_claim', {
        p_claim_id: claimId,
        p_amount_kobo: payload.amountKobo ?? null,
        p_method: payload.paymentMethod || 'Transfer',
        p_payment_date: payload.paymentDate || getLagosDateString(),
        p_reference: payload.reference ?? null,
        p_idempotency_key: payload.idempotencyKey || `claim-confirm-${claimId}`,
      });
      if (error) throw new ApiError(error.message, 400);
      const r = data?.receipt;
      return {
        claim: data?.claim,
        payment: mapSupaPayment(data?.payment, r?.receipt_number, r?.public_id),
        receipt: r || null,
        debt: data?.debt || null,
      };
    }
    return v2Request(`/api/v2/claims/${encodeURIComponent(claimId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async rejectClaim(claimId: string, reason: string): Promise<{ claim: PaymentClaimRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_reject_claim', {
        p_claim_id: claimId,
        p_reason: reason,
      });
      if (error) throw new ApiError(error.message, 400);
      return { claim: data };
    }
    return v2Request(`/api/v2/claims/${encodeURIComponent(claimId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async getPushStatus(): Promise<PushStatusRecord> {
    return v2Request('/api/v2/push/status');
  },

  async subscribePush(subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }): Promise<{ subscribed: boolean }> {
    return v2Request('/api/v2/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    });
  },

  async unsubscribePush(endpoint: string): Promise<{ unsubscribed: boolean }> {
    return v2Request('/api/v2/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });
  },

  // =========================================================================
  // SLICE 3: QUOTATIONS
  // =========================================================================
  async listQuotes(params?: { status?: string; q?: string }): Promise<{ quotes: QuoteRecord[] }> {
    if (isSupabaseConfigured && supabase) {
      const { data: rows, error } = await supabase
        .from('quotes')
        .select('*, quote_lines(*)')
        .order('created_at', { ascending: false });
      if (error) throw new ApiError(error.message, 400);

      const list: QuoteRecord[] = (rows || []).map((row: any) => {
        const lines: InvoiceLineRecord[] = (row.quote_lines || [])
          .sort((a: any, b: any) => Number(a.position) - Number(b.position))
          .map((l: any) => ({
            id: l.id,
            position: Number(l.position),
            description: l.description,
            qtyThousandths: Number(l.qty_thousandths),
            unitPriceKobo: Number(l.unit_price_kobo),
            discountKobo: Number(l.discount_kobo),
            grossKobo: Number(l.gross_kobo),
            lineTotalKobo: Number(l.line_total_kobo),
          }));
        return mapSupaQuote(row, lines);
      });

      const status = params?.status || '';
      const q = (params?.q || '').trim().toLowerCase();
      return {
        quotes: list.filter((item) => {
          if (status === 'EXPIRED' && !item.isExpired) return false;
          if (status === 'SENT' && (item.status !== 'SENT' || item.isExpired)) return false;
          if (status && status !== 'ALL' && status !== 'EXPIRED' && status !== 'SENT' && item.status !== status) {
            return false;
          }
          if (q && !`${item.quoteNumber || ''} ${item.customerName} ${item.notes}`.toLowerCase().includes(q)) {
            return false;
          }
          return true;
        }),
      };
    }

    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.q) qs.set('q', params.q);
    return v2Request(`/api/v2/quotes${qs.toString() ? `?${qs.toString()}` : ''}`);
  },

  async getQuote(id: string): Promise<{ quote: QuoteRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { data: row, error } = await supabase
        .from('quotes')
        .select('*, quote_lines(*)')
        .eq('id', id)
        .single();
      if (error || !row) throw new ApiError(error?.message || 'Quote not found', 404);
      const lines: InvoiceLineRecord[] = (row.quote_lines || [])
        .sort((a: any, b: any) => Number(a.position) - Number(b.position))
        .map((l: any) => ({
          id: l.id,
          position: Number(l.position),
          description: l.description,
          qtyThousandths: Number(l.qty_thousandths),
          unitPriceKobo: Number(l.unit_price_kobo),
          discountKobo: Number(l.discount_kobo),
          grossKobo: Number(l.gross_kobo),
          lineTotalKobo: Number(l.line_total_kobo),
        }));
      let convertedInvoiceNumber: string | null = null;
      if (row.converted_invoice_id) {
        const { data: inv } = await supabase
          .from('invoices')
          .select('invoice_number')
          .eq('id', row.converted_invoice_id)
          .maybeSingle();
        convertedInvoiceNumber = inv?.invoice_number || null;
      }
      return { quote: mapSupaQuote(row, lines, convertedInvoiceNumber) };
    }
    return v2Request(`/api/v2/quotes/${encodeURIComponent(id)}`);
  },

  async createQuote(payload: SaveQuotePayload): Promise<{ quote: QuoteRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_save_quote_draft', {
        p_quote_id: null,
        p_customer_id: payload.customerId || null,
        p_customer_name: payload.customerName,
        p_customer_phone: payload.customerPhone || '',
        p_customer_email: payload.customerEmail || '',
        p_customer_address: payload.customerAddress || '',
        p_issue_date: payload.issueDate || getLagosDateString(),
        p_valid_until: payload.validUntil || null,
        p_terms_kind: payload.termsKind,
        p_lines: payload.lines,
        p_invoice_discount_kobo: payload.invoiceDiscountKobo ?? 0,
        p_deposit_type: payload.depositType || 'none',
        p_deposit_value: payload.depositValue ?? 0,
        p_notes: payload.notes || '',
        p_bank_account_ids: payload.bankAccountIds || [],
        p_template: payload.template || null,
        p_idempotency_key: payload.idempotencyKey || null,
      });
      if (error) throw new ApiError(error.message, 400);
      if (payload.sendNow) {
        const { error: sendErr } = await supabase.rpc('v2_send_quote', { p_quote_id: data.id });
        if (sendErr) throw new ApiError(sendErr.message, 400);
      }
      return this.getQuote(data.id);
    }
    return v2Request('/api/v2/quotes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateQuote(id: string, payload: SaveQuotePayload): Promise<{ quote: QuoteRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_save_quote_draft', {
        p_quote_id: id,
        p_customer_id: payload.customerId || null,
        p_customer_name: payload.customerName,
        p_customer_phone: payload.customerPhone || '',
        p_customer_email: payload.customerEmail || '',
        p_customer_address: payload.customerAddress || '',
        p_issue_date: payload.issueDate || getLagosDateString(),
        p_valid_until: payload.validUntil || null,
        p_terms_kind: payload.termsKind,
        p_lines: payload.lines,
        p_invoice_discount_kobo: payload.invoiceDiscountKobo ?? 0,
        p_deposit_type: payload.depositType || 'none',
        p_deposit_value: payload.depositValue ?? 0,
        p_notes: payload.notes || '',
        p_bank_account_ids: payload.bankAccountIds || [],
        p_template: payload.template || null,
        p_idempotency_key: null,
      });
      if (error) throw new ApiError(error.message, 400);
      if (payload.sendNow) {
        const { error: sendErr } = await supabase.rpc('v2_send_quote', { p_quote_id: data.id });
        if (sendErr) throw new ApiError(sendErr.message, 400);
      }
      return this.getQuote(id);
    }
    return v2Request(`/api/v2/quotes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async sendQuote(id: string): Promise<{ quote: QuoteRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('v2_send_quote', { p_quote_id: id });
      if (error) throw new ApiError(error.message, 400);
      return this.getQuote(id);
    }
    return v2Request(`/api/v2/quotes/${encodeURIComponent(id)}/send`, { method: 'POST' });
  },

  async voidQuote(id: string, reason: string): Promise<{ quote: QuoteRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('v2_void_quote', { p_quote_id: id, p_reason: reason });
      if (error) throw new ApiError(error.message, 400);
      return this.getQuote(id);
    }
    return v2Request(`/api/v2/quotes/${encodeURIComponent(id)}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async reviseQuote(id: string, reason?: string): Promise<{ quote: QuoteRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_revise_quote', {
        p_quote_id: id,
        p_reason: reason || 'Revised with updated pricing',
      });
      if (error) throw new ApiError(error.message, 400);
      return this.getQuote(data.id);
    }
    return v2Request(`/api/v2/quotes/${encodeURIComponent(id)}/revise`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async regenerateQuoteLink(id: string): Promise<{ quote: QuoteRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('v2_regenerate_quote_link', { p_quote_id: id });
      if (error) throw new ApiError(error.message, 400);
      return this.getQuote(id);
    }
    return v2Request(`/api/v2/quotes/${encodeURIComponent(id)}/regenerate-link`, {
      method: 'POST',
    });
  },

  async convertQuoteToInvoice(
    id: string,
    sendNow = false
  ): Promise<{ quote: QuoteRecord; invoice: InvoiceRecord }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_convert_quote_to_invoice', {
        p_quote_id: id,
        p_send_now: sendNow,
      });
      if (error) throw new ApiError(error.message, 409);
      api.trackAnalyticsEvent('quote_converted', '/app/quotes');
      const [qRes, invRes] = await Promise.all([
        this.getQuote(id),
        this.getInvoice(data.invoice.id),
      ]);
      return { quote: qRes.quote, invoice: invRes.invoice };
    }
    return v2Request(`/api/v2/quotes/${encodeURIComponent(id)}/convert`, {
      method: 'POST',
      body: JSON.stringify({ sendNow }),
    });
  },

  // =========================================================================
  // SLICE 4: RECEIVABLES, REMINDERS, CUSTOMERS DIRECTORY, STATEMENTS & REPORTS
  // =========================================================================

  async getReceivables(params?: {
    source?: ReceivableSourceFilter;
    bucket?: AgeingBucketFilter;
    q?: string;
  }): Promise<{ items: ReceivableItem[]; summary: AgeingBucketTotals; asOfDate: string }> {
    if (isSupabaseConfigured && supabase) {
      const todayLagos = getLagosDateString();
      try {
        await supabase.rpc('v2_sync_legacy_debts');
      } catch {
        // Fallback if migration 008 not yet applied
      }
      const [{ data: debtRows, error: dErr }, { data: invRows }, { data: rctRows }, { data: remRows }] =
        await Promise.all([
          supabase
            .from('debts')
            .select('*')
            .in('status', ['OPEN', 'PART_PAID'])
            .gt('balance_due_kobo', 0)
            .order('due_date', { ascending: true }),
          supabase.from('invoices').select('id, public_id'),
          supabase.from('receipts').select('id, public_id'),
          supabase.from('payment_reminders').select('*').order('sent_at', { ascending: false }),
        ]);
      if (dErr) throw new ApiError(dErr.message, 400);

      const invPublicMap = new Map<string, string>();
      for (const r of invRows || []) invPublicMap.set(r.id, r.public_id);
      const rctPublicMap = new Map<string, string>();
      for (const r of rctRows || []) rctPublicMap.set(r.id, r.public_id);

      const remByDebt = new Map<string, { lastAt: string; lastTone: 'gentle' | 'firm'; count: number }>();
      for (const rm of remRows || []) {
        const existing = remByDebt.get(rm.debt_id);
        if (!existing) {
          remByDebt.set(rm.debt_id, {
            lastAt: rm.sent_at,
            lastTone: rm.tone === 'firm' ? 'firm' : 'gentle',
            count: 1,
          });
        } else {
          existing.count += 1;
        }
      }

      const now = new Date();
      const allItems: ReceivableItem[] = (debtRows || []).map((row: any) => {
        const ageing = computeAgeingBucket(row.due_date || null, row.issue_date, todayLagos);
        const publicId =
          row.source_type === 'INVOICE'
            ? invPublicMap.get(row.source_id) || null
            : row.source_type === 'RECEIPT'
            ? rctPublicMap.get(row.source_id) || null
            : null;
        const publicPath =
          row.source_type === 'INVOICE' && publicId
            ? `/i/${publicId}`
            : row.source_type === 'RECEIPT' && publicId
            ? `/r/${publicId}`
            : null;
        const remInfo = remByDebt.get(row.id);

        return {
          debtId: row.id,
          sourceType: row.source_type,
          sourceId: row.source_id,
          referenceNumber: row.reference_number || '',
          publicId,
          publicPath,
          customerId: row.customer_id || null,
          customerName: row.customer_name || 'Walk-in Customer',
          customerPhone: row.customer_phone || '',
          issueDate: row.issue_date,
          dueDate: row.due_date || null,
          effectiveDueDate: ageing.effectiveDueDate,
          daysOverdue: ageing.daysOverdue,
          ageingBucket: ageing.bucket,
          totalKobo: Number(row.total_kobo),
          amountPaidKobo: Number(row.amount_paid_kobo),
          writtenOffKobo: Number(row.written_off_kobo),
          balanceDueKobo: Number(row.balance_due_kobo),
          status: row.status === 'PART_PAID' ? 'PART_PAID' : 'OPEN',
          lastReminderAt: remInfo?.lastAt || null,
          lastReminderTone: remInfo?.lastTone || null,
          reminderCount: remInfo?.count || 0,
          remindedWithin3Days: isRemindedWithin3Days(remInfo?.lastAt || null, now),
        };
      });

      const sourceFilter = params?.source || 'ALL';
      const bucketFilter = params?.bucket || 'ALL';
      const q = (params?.q || '').trim().toLowerCase();

      const sourceMatched = allItems.filter((item) => {
        if (sourceFilter !== 'ALL' && item.sourceType !== sourceFilter) return false;
        if (q && !`${item.customerName} ${item.customerPhone} ${item.referenceNumber}`.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      });

      const summary = makeEmptyAgeing();
      for (const item of sourceMatched) {
        accumAgeing(summary, item.ageingBucket, item.balanceDueKobo);
      }

      const items = sourceMatched
        .filter((item) => bucketFilter === 'ALL' || item.ageingBucket === bucketFilter)
        .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceDueKobo - a.balanceDueKobo);

      return { items, summary, asOfDate: todayLagos };
    }

    const qs = new URLSearchParams();
    if (params?.source && params.source !== 'ALL') qs.set('source', params.source);
    if (params?.bucket && params.bucket !== 'ALL') qs.set('bucket', params.bucket);
    if (params?.q) qs.set('q', params.q);
    return v2Request(`/api/v2/receivables${qs.toString() ? `?${qs.toString()}` : ''}`);
  },

  async logReminder(payload: {
    debtId: string;
    tone: 'gentle' | 'firm';
    channel?: 'whatsapp';
  }): Promise<{
    reminder: PaymentReminderRecord;
    warnedRecent: boolean;
    previousReminderAt: string | null;
  }> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('v2_log_reminder', {
        p_debt_id: payload.debtId,
        p_tone: payload.tone,
        p_channel: payload.channel || 'whatsapp',
      });
      if (error) throw new ApiError(error.message, 400);
      api.trackAnalyticsEvent('reminder_sent', '/app/debtors');
      return data as any;
    }
    return v2Request('/api/v2/reminders', {
      method: 'POST',
      body: JSON.stringify({
        debtId: payload.debtId,
        tone: payload.tone,
        channel: payload.channel || 'whatsapp',
      }),
    });
  },

  async getCustomers(q?: string): Promise<{ customers: CustomerDirectoryItem[] }> {
    if (isSupabaseConfigured && supabase) {
      const [{ data: custs, error }, { data: invs }, { data: quotes }, { data: rcts }, { data: css }, { data: debts }] =
        await Promise.all([
          supabase.from('customers').select('*').order('updated_at', { ascending: false }),
          supabase.from('invoices').select('id, customer_id, customer_name, status, total_kobo, amount_paid_kobo, updated_at'),
          supabase.from('quotes').select('id, customer_id, customer_name, updated_at'),
          supabase.from('receipts').select('id, customer_name, customer_phone, receipt_kind, status, total_kobo, amount_paid_kobo, issued_at').neq('status', 'VOID'),
          supabase.from('credit_sales').select('id, customer_name, customer_phone, status, total_kobo, amount_paid_kobo, created_at').neq('status', 'VOID'),
          supabase.from('debts').select('id, customer_id, customer_name, customer_phone, balance_due_kobo').in('status', ['OPEN', 'PART_PAID']).gt('balance_due_kobo', 0),
        ]);
      if (error) throw new ApiError(error.message, 400);

      const needle = (q || '').trim().toLowerCase();
      const items: CustomerDirectoryItem[] = (custs || []).map((c: any) => {
        const nameL = String(c.name || '').trim().toLowerCase();
        const phoneC = String(c.phone || '').trim();
        const match = (cid: string | null, nm: string, ph?: string) =>
          Boolean(
            (cid && cid === c.id) ||
              (!cid && nameL && String(nm || '').trim().toLowerCase() === nameL) ||
              (!cid && phoneC && ph && String(ph).trim() === phoneC)
          );
        const cInvs = (invs || []).filter((i: any) => match(i.customer_id, i.customer_name));
        const cQuotes = (quotes || []).filter((qt: any) => match(qt.customer_id, qt.customer_name));
        const cRcts = (rcts || []).filter((r: any) => r.receipt_kind === 'SALE' && match(null, r.customer_name, r.customer_phone));
        const cCs = (css || []).filter((cs: any) => match(null, cs.customer_name, cs.customer_phone));
        const cDebts = (debts || []).filter((d: any) => match(d.customer_id, d.customer_name, d.customer_phone));

        let totalBilledKobo = 0;
        let totalPaidKobo = 0;
        let lastActivityAt = c.updated_at || c.created_at;
        for (const i of cInvs) {
          if (i.status !== 'DRAFT' && i.status !== 'VOID') {
            totalBilledKobo += Number(i.total_kobo);
            totalPaidKobo += Number(i.amount_paid_kobo);
          }
          if (i.updated_at && i.updated_at > lastActivityAt) lastActivityAt = i.updated_at;
        }
        for (const r of cRcts) {
          totalBilledKobo += Number(r.total_kobo);
          totalPaidKobo += Number(r.amount_paid_kobo);
        }
        for (const cs of cCs) {
          totalBilledKobo += Number(cs.total_kobo);
          totalPaidKobo += Number(cs.amount_paid_kobo);
        }
        const balanceOwedKobo = cDebts.reduce((s: number, d: any) => s + Number(d.balance_due_kobo), 0);
        return {
          id: c.id,
          businessId: c.business_id,
          name: c.name,
          phone: c.phone || '',
          email: c.email || '',
          address: c.address || '',
          notes: c.notes || '',
          invoiceCount: cInvs.length,
          quoteCount: cQuotes.length,
          receiptCount: cRcts.length,
          creditSaleCount: cCs.length,
          openDebtCount: cDebts.length,
          totalBilledKobo,
          totalPaidKobo,
          balanceOwedKobo,
          lastActivityAt,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        };
      });

      return {
        customers: items
          .filter((c) => !needle || `${c.name} ${c.phone} ${c.email} ${c.address}`.toLowerCase().includes(needle))
          .sort((a, b) => b.balanceOwedKobo - a.balanceOwedKobo || b.lastActivityAt.localeCompare(a.lastActivityAt)),
      };
    }

    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    return v2Request(`/api/v2/customers${qs}`);
  },

  async getCustomerDetail(id: string): Promise<{
    customer: {
      id: string;
      businessId: string;
      name: string;
      phone: string;
      email: string;
      address: string;
      notes: string;
      balanceOwedKobo: number;
      createdAt: string;
      updatedAt: string;
    };
    invoices: Array<{
      id: string;
      invoiceNumber: string | null;
      publicId: string;
      status: string;
      issueDate: string;
      dueDate: string;
      totalKobo: number;
      amountPaidKobo: number;
      writtenOffKobo: number;
      balanceDueKobo: number;
      currency: CurrencyCode;
    }>;
    quotes: Array<{
      id: string;
      quoteNumber: string | null;
      publicId: string;
      status: string;
      isExpired: boolean;
      issueDate: string;
      validUntil: string;
      totalKobo: number;
      currency: CurrencyCode;
    }>;
    receipts: Array<{
      id: string;
      receiptNumber: string;
      receiptKind: string;
      publicId: string;
      status: string;
      issuedDateLagos: string;
      totalKobo: number;
      amountPaidKobo: number;
      balanceDueKobo: number;
    }>;
    creditSales: Array<{
      id: string;
      itemNote: string;
      entryDate: string;
      dueDate: string | null;
      status: string;
      totalKobo: number;
      amountPaidKobo: number;
      balanceDueKobo: number;
    }>;
    payments: Array<{
      id: string;
      debtId: string;
      invoiceId: string | null;
      receiptId: string | null;
      receiptNumber: string | null;
      debtReference: string;
      amountKobo: number;
      paymentMethod: string;
      paymentDate: string;
      reference: string;
      isVoided: boolean;
      createdAt: string;
    }>;
    reminders: Array<{
      id: string;
      debtId: string;
      referenceNumber: string;
      tone: 'gentle' | 'firm';
      channel: string;
      sentAt: string;
    }>;
  }> {
    if (isSupabaseConfigured && supabase) {
      const { data: c, error } = await supabase.from('customers').select('*').eq('id', id).single();
      if (error || !c) throw new ApiError('Customer not found', 404);
      const nameL = String(c.name || '').trim().toLowerCase();
      const phoneC = String(c.phone || '').trim();
      const match = (cid: string | null, nm: string, ph?: string) =>
        Boolean(
          (cid && cid === c.id) ||
            (!cid && nameL && String(nm || '').trim().toLowerCase() === nameL) ||
            (!cid && phoneC && ph && String(ph).trim() === phoneC)
        );
      const [{ data: invs }, { data: quotes }, { data: rcts }, { data: css }, { data: debts }, { data: pays }, { data: rems }] =
        await Promise.all([
          supabase.from('invoices').select('*').order('issue_date', { ascending: false }),
          supabase.from('quotes').select('*').order('issue_date', { ascending: false }),
          supabase.from('receipts').select('*').order('issued_date_lagos', { ascending: false }),
          supabase.from('credit_sales').select('*').order('entry_date', { ascending: false }),
          supabase.from('debts').select('*'),
          supabase.from('payments').select('*, receipts(receipt_number)').order('payment_date', { ascending: false }),
          supabase.from('payment_reminders').select('*').order('sent_at', { ascending: false }),
        ]);

      const cInvs = (invs || []).filter((i: any) => match(i.customer_id, i.customer_name));
      const cQuotes = (quotes || []).filter((q: any) => match(q.customer_id, q.customer_name));
      const cRcts = (rcts || []).filter((r: any) => match(null, r.customer_name, r.customer_phone));
      const cCs = (css || []).filter((cs: any) => match(null, cs.customer_name, cs.customer_phone));
      const cDebts = (debts || []).filter((d: any) => match(d.customer_id, d.customer_name, d.customer_phone));
      const debtIdSet = new Set(cDebts.map((d: any) => d.id));
      const debtRefMap = new Map<string, string>(cDebts.map((d: any) => [d.id, d.reference_number || '']));

      const balanceOwedKobo = cDebts
        .filter((d: any) => (d.status === 'OPEN' || d.status === 'PART_PAID') && Number(d.balance_due_kobo) > 0)
        .reduce((s: number, d: any) => s + Number(d.balance_due_kobo), 0);

      return {
        customer: {
          id: c.id,
          businessId: c.business_id,
          name: c.name,
          phone: c.phone || '',
          email: c.email || '',
          address: c.address || '',
          notes: c.notes || '',
          balanceOwedKobo,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        },
        invoices: cInvs.map((i: any) => ({
          id: i.id,
          invoiceNumber: i.invoice_number,
          publicId: i.public_id,
          status: i.status,
          issueDate: i.issue_date,
          dueDate: i.due_date,
          totalKobo: Number(i.total_kobo),
          amountPaidKobo: Number(i.amount_paid_kobo),
          writtenOffKobo: Number(i.written_off_kobo),
          balanceDueKobo: Number(i.balance_due_kobo),
          currency: (i.currency || 'NGN') as CurrencyCode,
        })),
        quotes: cQuotes.map((q: any) => ({
          id: q.id,
          quoteNumber: q.quote_number,
          publicId: q.public_id,
          status: q.status,
          isExpired: isQuoteExpired(q.status, q.valid_until),
          issueDate: q.issue_date,
          validUntil: q.valid_until,
          totalKobo: Number(q.total_kobo),
          currency: (q.currency || 'NGN') as CurrencyCode,
        })),
        receipts: cRcts.map((r: any) => ({
          id: r.id,
          receiptNumber: r.receipt_number,
          receiptKind: r.receipt_kind,
          publicId: r.public_id,
          status: r.status,
          issuedDateLagos: r.issued_date_lagos,
          totalKobo: Number(r.total_kobo),
          amountPaidKobo: Number(r.amount_paid_kobo),
          balanceDueKobo: Number(r.balance_due_kobo),
        })),
        creditSales: cCs.map((cs: any) => ({
          id: cs.id,
          itemNote: cs.item_note || '',
          entryDate: cs.entry_date,
          dueDate: cs.due_date || null,
          status: cs.status,
          totalKobo: Number(cs.total_kobo),
          amountPaidKobo: Number(cs.amount_paid_kobo),
          balanceDueKobo: Number(cs.balance_due_kobo),
        })),
        payments: (pays || [])
          .filter((p: any) => debtIdSet.has(p.debt_id))
          .map((p: any) => ({
            id: p.id,
            debtId: p.debt_id,
            invoiceId: p.invoice_id || null,
            receiptId: p.receipt_id || null,
            receiptNumber: p.receipts?.receipt_number || null,
            debtReference: debtRefMap.get(p.debt_id) || '',
            amountKobo: Number(p.amount_kobo),
            paymentMethod: p.payment_method,
            paymentDate: p.payment_date,
            reference: p.reference || '',
            isVoided: Boolean(p.is_voided),
            createdAt: p.created_at,
          })),
        reminders: (rems || [])
          .filter((rm: any) => debtIdSet.has(rm.debt_id))
          .slice(0, 30)
          .map((rm: any) => ({
            id: rm.id,
            debtId: rm.debt_id,
            referenceNumber: debtRefMap.get(rm.debt_id) || '',
            tone: rm.tone === 'firm' ? 'firm' : 'gentle',
            channel: rm.channel || 'whatsapp',
            sentAt: rm.sent_at,
          })),
      };
    }

    return v2Request(`/api/v2/customers/${encodeURIComponent(id)}`);
  },

  async updateCustomer(
    id: string,
    payload: { name: string; phone?: string; email?: string; address?: string; notes?: string }
  ) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('customers')
        .update({
          name: payload.name.trim(),
          phone: (payload.phone || '').trim(),
          email: (payload.email || '').trim(),
          address: (payload.address || '').trim(),
          notes: (payload.notes || '').trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error || !data) throw new ApiError(error?.message || 'Unable to update customer', 400);
      return { customer: data };
    }
    return v2Request(`/api/v2/customers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async getCustomerStatement(
    customerId: string,
    fromDate: string,
    toDate: string
  ): Promise<{ statement: CustomerStatementRecord }> {
    if (isSupabaseConfigured && supabase) {
      const [{ business }, detail] = await Promise.all([
        api.getMe(),
        this.getCustomerDetail(customerId),
      ]);
      if (!business) throw new ApiError('Business not found', 404);

      const docs: StatementInvoiceInput[] = [];
      const pays: StatementPaymentInput[] = [];

      for (const inv of detail.invoices) {
        if (inv.status === 'DRAFT' || inv.status === 'VOID') continue;
        docs.push({
          id: inv.id,
          referenceNumber: inv.invoiceNumber || 'Invoice',
          issueDate: inv.issueDate,
          totalKobo: inv.totalKobo,
          writtenOffKobo: inv.writtenOffKobo,
          writtenOffDate: inv.writtenOffKobo > 0 ? inv.issueDate : null,
          status: inv.status,
          sourceType: 'INVOICE',
        });
      }
      for (const p of detail.payments) {
        if (p.isVoided) continue;
        pays.push({
          id: p.id,
          referenceNumber: p.reference || p.debtReference,
          receiptNumber: p.receiptNumber,
          paymentDate: p.paymentDate,
          amountKobo: p.amountKobo,
          paymentMethod: p.paymentMethod,
          isVoided: false,
          createdAt: p.createdAt,
        });
      }
      for (const cs of detail.creditSales) {
        if (cs.status === 'VOID') continue;
        docs.push({
          id: cs.id,
          referenceNumber: cs.itemNote ? `Credit (${cs.itemNote.slice(0, 24)})` : `Credit ${cs.entryDate}`,
          issueDate: cs.entryDate,
          totalKobo: cs.totalKobo,
          writtenOffKobo: 0,
          writtenOffDate: null,
          status: cs.status,
          sourceType: 'CREDIT_SALE',
        });
      }

      const computed = computeCustomerStatement({
        fromDate,
        toDate,
        documents: docs,
        payments: pays,
      });

      return {
        statement: {
          business: {
            name: business.name,
            logoDataUrl: business.logoDataUrl,
            address: business.address,
            phone: business.phone,
            email: business.email,
            tinRc: business.tinRc || '',
            brandColor: business.brandColor,
            currency: business.currency,
          },
          customer: {
            id: detail.customer.id,
            name: detail.customer.name,
            phone: detail.customer.phone,
            email: detail.customer.email,
            address: detail.customer.address,
          },
          generatedDateLagos: getLagosDateString(),
          ...computed,
        },
      };
    }

    const qs = new URLSearchParams({ from: fromDate, to: toDate });
    return v2Request(`/api/v2/customers/${encodeURIComponent(customerId)}/statement?${qs.toString()}`);
  },

  async getV2Reports(dateFrom: string, dateTo: string): Promise<{ report: V2ReportsSummary }> {
    if (isSupabaseConfigured && supabase) {
      const todayLagos = getLagosDateString();
      const [{ data: ledRows }, { data: invRows }, { data: openInvRows }, { data: qRows }] =
        await Promise.all([
          supabase
            .from('ledger_entries')
            .select('*')
            .gte('entry_date', dateFrom)
            .lte('entry_date', dateTo),
          supabase
            .from('invoices')
            .select('status, total_kobo, issue_date')
            .gte('issue_date', dateFrom)
            .lte('issue_date', dateTo)
            .not('status', 'in', '("DRAFT","VOID")'),
          supabase
            .from('invoices')
            .select('issue_date, due_date, balance_due_kobo')
            .in('status', ['SENT', 'PART_PAID'])
            .gt('balance_due_kobo', 0),
          supabase
            .from('quotes')
            .select('status, valid_until, total_kobo, converted_invoice_id')
            .gte('issue_date', dateFrom)
            .lte('issue_date', dateTo)
            .not('status', 'in', '("DRAFT","VOID")'),
        ]);

      let directSalesKobo = 0;
      let receivedTotalKobo = 0;
      let expensesTotalKobo = 0;

      for (const r of ledRows || []) {
        const entry: LedgerEntryRecord = {
          id: r.id,
          businessId: r.business_id,
          entryType: r.entry_type,
          entryKind: r.entry_kind || 'RECEIPT',
          amountKobo: Number(r.amount_kobo),
          cashReceivedKobo: Number(r.cash_received_kobo ?? 0),
          paymentMethod: r.payment_method || null,
          receiptId: r.receipt_id || null,
          creditSaleId: r.credit_sale_id || null,
          expenseId: r.expense_id || null,
          parentEntryId: r.parent_entry_id || null,
          customerName: r.customer_name || '',
          customerPhone: r.customer_phone || '',
          note: r.note || '',
          soldBy: r.sold_by || '',
          source: r.source || 'manual',
          isCorrection: Boolean(r.is_correction),
          correctionReason: r.correction_reason || '',
          entryDate: r.entry_date,
          createdAt: r.created_at,
          createdBy: r.created_by,
        };
        const flow = getEntrySignedFlow(entry);
        receivedTotalKobo += flow.moneyInKobo;
        expensesTotalKobo += flow.moneyOutKobo;
        if (entry.entryType === 'SALE') {
          directSalesKobo += entry.amountKobo;
        } else if (
          entry.entryType === 'ADJUSTMENT' &&
          entry.entryKind === 'VOID_REVERSAL' &&
          !r.invoice_id &&
          !r.payment_id
        ) {
          directSalesKobo += entry.amountKobo;
        }
      }

      const invoicedSalesKobo = (invRows || []).reduce((s: number, i: any) => s + Number(i.total_kobo), 0);
      const invoiceAgeing = makeEmptyAgeing();
      for (const inv of openInvRows || []) {
        const ag = computeAgeingBucket(inv.due_date, inv.issue_date, todayLagos);
        accumAgeing(invoiceAgeing, ag.bucket, Number(inv.balance_due_kobo));
      }

      let quotesSent = 0;
      let quotesAccepted = 0;
      let quotesDeclined = 0;
      let quotesExpired = 0;
      let quotesConverted = 0;
      let quotedTotalKobo = 0;
      let convertedTotalKobo = 0;
      for (const q of qRows || []) {
        quotesSent += 1;
        quotedTotalKobo += Number(q.total_kobo);
        if (q.status === 'CONVERTED' || q.converted_invoice_id) {
          quotesConverted += 1;
          convertedTotalKobo += Number(q.total_kobo);
        } else if (q.status === 'ACCEPTED') {
          quotesAccepted += 1;
        } else if (q.status === 'DECLINED') {
          quotesDeclined += 1;
        } else if (q.status === 'SENT' && isQuoteExpired(q.status, q.valid_until)) {
          quotesExpired += 1;
        }
      }

      return {
        report: {
          dateFrom,
          dateTo,
          soldTotalKobo: directSalesKobo + invoicedSalesKobo,
          invoicedSalesKobo,
          directSalesKobo,
          receivedTotalKobo,
          expensesTotalKobo,
          netCashFlowKobo: receivedTotalKobo - expensesTotalKobo,
          invoiceAgeing,
          quoteConversion: {
            quotesSent,
            quotesAccepted,
            quotesDeclined,
            quotesExpired,
            quotesConverted,
            conversionRatePct:
              quotesSent > 0 ? Math.round((quotesConverted / quotesSent) * 1000) / 10 : 0,
            quotedTotalKobo,
            convertedTotalKobo,
          },
        },
      };
    }

    const qs = new URLSearchParams({ dateFrom, dateTo });
    return v2Request(`/api/v2/reports?${qs.toString()}`);
  },

  async downloadV2Csv(
    type: V2CsvExportType,
    dateFrom: string,
    dateTo: string,
    businessCurrency: CurrencyCode = 'NGN'
  ): Promise<void> {
    let csvText = '';
    if (isSupabaseConfigured && supabase) {
      if (type === 'invoices') {
        const { data } = await supabase
          .from('invoices')
          .select('*')
          .gte('issue_date', dateFrom)
          .lte('issue_date', dateTo)
          .order('issue_date', { ascending: true });
        csvText = buildCsv(
          ['Issue Date', 'Due Date', 'Invoice #', 'Customer', 'Phone', 'Status', 'Subtotal', 'Discount', 'VAT', 'Total', 'Paid', 'Written Off', 'Balance Due', 'Notes'],
          (data || []).map((r: any) => [
            r.issue_date,
            r.due_date,
            r.invoice_number || 'DRAFT',
            r.customer_name || '',
            r.customer_phone || '',
            r.status,
            formatKobo(Number(r.subtotal_kobo), businessCurrency),
            formatKobo(Number(r.line_discount_total_kobo) + Number(r.invoice_discount_kobo), businessCurrency),
            formatKobo(Number(r.vat_kobo), businessCurrency),
            formatKobo(Number(r.total_kobo), businessCurrency),
            formatKobo(Number(r.amount_paid_kobo), businessCurrency),
            formatKobo(Number(r.written_off_kobo), businessCurrency),
            formatKobo(Number(r.balance_due_kobo), businessCurrency),
            r.notes || '',
          ])
        );
      } else if (type === 'quotes') {
        const { data } = await supabase
          .from('quotes')
          .select('*')
          .gte('issue_date', dateFrom)
          .lte('issue_date', dateTo)
          .order('issue_date', { ascending: true });
        csvText = buildCsv(
          ['Issue Date', 'Valid Until', 'Quote #', 'Customer', 'Phone', 'Status', 'Total', 'Decision By', 'Notes'],
          (data || []).map((r: any) => [
            r.issue_date,
            r.valid_until,
            r.quote_number || 'DRAFT',
            r.customer_name || '',
            r.customer_phone || '',
            isQuoteExpired(r.status, r.valid_until) ? 'EXPIRED' : r.status,
            formatKobo(Number(r.total_kobo), businessCurrency),
            r.decision_name || '',
            r.notes || '',
          ])
        );
      } else {
        const { data } = await supabase
          .from('payments')
          .select('*, receipts(receipt_number), debts(source_type, reference_number, customer_name)')
          .gte('payment_date', dateFrom)
          .lte('payment_date', dateTo)
          .order('payment_date', { ascending: true });
        csvText = buildCsv(
          ['Payment Date', 'Receipt #', 'Source', 'Document #', 'Customer', 'Method', 'Amount', 'Reference', 'Status'],
          (data || []).map((r: any) => [
            r.payment_date,
            r.receipts?.receipt_number || '',
            r.debts?.source_type || '',
            r.debts?.reference_number || '',
            r.debts?.customer_name || '',
            r.payment_method,
            formatKobo(Number(r.amount_kobo), businessCurrency),
            r.reference || '',
            r.is_voided ? 'VOID' : 'POSTED',
          ])
        );
      }
    } else {
      const headers = new Headers();
      const token = getStoredSessionToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const qs = new URLSearchParams({ dateFrom, dateTo });
      const res = await fetch(`/api/v2/exports/${encodeURIComponent(type)}?${qs.toString()}`, {
        headers,
        credentials: 'include',
      });
      if (!res.ok) throw new ApiError('Unable to export CSV', res.status);
      csvText = await res.text();
    }

    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tallymark-${type}-${getLagosDateString()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

function makeEmptyAgeing(): AgeingBucketTotals {
  return {
    notYetDueKobo: 0,
    notYetDueCount: 0,
    days1To7Kobo: 0,
    days1To7Count: 0,
    days8To30Kobo: 0,
    days8To30Count: 0,
    days30PlusKobo: 0,
    days30PlusCount: 0,
    totalOutstandingKobo: 0,
    totalOpenCount: 0,
  };
}

function accumAgeing(totals: AgeingBucketTotals, bucket: AgeingBucket, balanceKobo: number) {
  totals.totalOutstandingKobo += balanceKobo;
  totals.totalOpenCount += 1;
  if (bucket === 'not_yet_due') {
    totals.notYetDueKobo += balanceKobo;
    totals.notYetDueCount += 1;
  } else if (bucket === '1_7') {
    totals.days1To7Kobo += balanceKobo;
    totals.days1To7Count += 1;
  } else if (bucket === '8_30') {
    totals.days8To30Kobo += balanceKobo;
    totals.days8To30Count += 1;
  } else {
    totals.days30PlusKobo += balanceKobo;
    totals.days30PlusCount += 1;
  }
}

function mapSupaQuote(
  row: any,
  lines: InvoiceLineRecord[],
  convertedInvoiceNumber: string | null = null
): QuoteRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id || null,
    publicId: row.public_id,
    sequenceNumber: row.sequence_number ?? null,
    quoteNumber: row.quote_number || null,
    idempotencyKey: row.idempotency_key || null,
    status: row.status,
    isExpired: isQuoteExpired(row.status, row.valid_until),
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    termsKind: row.terms_kind as PaymentTermsKind,
    currency: (row.currency || 'NGN') as CurrencyCode,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    customerEmail: row.customer_email || '',
    customerAddress: row.customer_address || '',
    lines,
    subtotalKobo: Number(row.subtotal_kobo),
    lineDiscountTotalKobo: Number(row.line_discount_total_kobo),
    invoiceDiscountKobo: Number(row.invoice_discount_kobo),
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    vatRateBps: Number(row.vat_rate_bps ?? 750),
    vatKobo: Number(row.vat_kobo),
    totalKobo: Number(row.total_kobo),
    depositType: (row.deposit_type || 'none') as DepositType,
    depositValue: Number(row.deposit_value ?? 0),
    amountDueNowKobo: Number(row.amount_due_now_kobo),
    notes: row.notes || '',
    bankAccountIds: Array.isArray(row.bank_account_ids) ? row.bank_account_ids : [],
    template: row.template || 'modern',
    snapshot: row.snapshot_json || null,
    convertedInvoiceId: row.converted_invoice_id || null,
    convertedInvoiceNumber,
    revisedFromId: row.revised_from_id || null,
    sentAt: row.sent_at || null,
    decisionName: row.decision_name || null,
    decisionNote: row.decision_note || null,
    decisionAt: row.decision_at || null,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}
