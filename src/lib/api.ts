import {
  buildCashBookDayView,
  buildCsv,
  calculateCloseDayVariance,
  getEntrySignedFlow,
  groupDebtsByCustomer,
  shiftLagosDate,
} from '../shared/cashbook';
import { formatKobo, getLagosDateString, type CurrencyCode } from '../shared/money';
import type { PaymentMethod } from '../shared/schemas';
import type { ConfirmVoiceEntryInput, VoiceDraftItem } from '../shared/voiceDraft';
import type {
  BusinessProfile,
  CashBookDayView,
  CashBookRow,
  CatalogItemSuggestion,
  CreditSaleRecord,
  CreditorRecord,
  CustomerSuggestion,
  DayClosureRecord,
  DebtorCustomerGroup,
  ExpenseRecord,
  ExpenseRevisionRecord,
  HomeSummary,
  LedgerEntryRecord,
  PublicReceiptRecord,
  ReceiptLineItem,
  ReceiptRecord,
  ReportsSummary,
  UserProfile,
} from '../shared/types';
import { isSupabaseConfigured, supabase } from './supabase';

const TOKEN_STORAGE_KEY = 'tallymark_session_token';

export function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage restrictions
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  closedDate?: string;
  constructor(message: string, status: number, code?: string, closedDate?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.closedDate = closedDate;
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getStoredSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const effectiveTimeout = timeoutMs ?? (path.startsWith('/api/voice/parse') ? 65_000 : 20_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
      credentials: 'include',
      signal: init.signal || controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new ApiError(
        'Request timed out — check your network connection and tap Retry.',
        408,
        'TIMEOUT'
      );
    }
    throw new ApiError(
      'Unable to reach the server. Check your internet connection — your draft stays saved on this device.',
      0,
      'OFFLINE'
    );
  }
  clearTimeout(timer);

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new ApiError(
      data?.error || `Request failed (${res.status})`,
      res.status,
      data?.code,
      data?.closedDate
    );
  }
  return data as T;
}

function mapSupaBusiness(row: any): BusinessProfile {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupaReceipt(row: any): ReceiptRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    publicId: row.public_id,
    sequenceNumber: Number(row.sequence_number),
    receiptNumber: row.receipt_number,
    receiptKind: row.receipt_kind,
    parentReceiptId: row.parent_receipt_id || null,
    parentReceiptNumber: row.parent_receipt_number || null,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    items: (typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json) as ReceiptLineItem[],
    subtotalKobo: Number(row.subtotal_kobo),
    discountTotalKobo: Number(row.discount_total_kobo),
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode,
    vatRateBps: Number(row.vat_rate_bps),
    vatKobo: Number(row.vat_kobo),
    totalKobo: Number(row.total_kobo),
    initialPaidKobo: Number(row.initial_paid_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    paymentMethod: row.payment_method,
    note: row.note || '',
    soldBy: row.sold_by || '',
    source: row.source,
    template: row.template,
    status: row.status,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    issuedDateLagos: row.issued_date_lagos,
    issuedAt: row.issued_at,
    createdBy: row.created_by,
  };
}

function mapSupaPublicReceipt(row: any): PublicReceiptRecord {
  return {
    publicId: row.public_id,
    receiptNumber: row.receipt_number,
    receiptKind: row.receipt_kind,
    parentReceiptNumber: row.parent_receipt_number || null,
    businessName: row.business_name,
    businessLogoDataUrl: row.business_logo_data_url || null,
    businessAddress: row.business_address || '',
    businessPhone: row.business_phone || '',
    businessEmail: row.business_email || '',
    brandColor: row.brand_color || '#064E3B',
    currency: (row.currency || 'NGN') as CurrencyCode,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    items: (typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json) as ReceiptLineItem[],
    subtotalKobo: Number(row.subtotal_kobo),
    discountTotalKobo: Number(row.discount_total_kobo),
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode,
    vatRateBps: Number(row.vat_rate_bps),
    vatKobo: Number(row.vat_kobo),
    totalKobo: Number(row.total_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    paymentMethod: row.payment_method,
    note: row.note || '',
    soldBy: row.sold_by || '',
    template: row.template,
    status: row.status,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    issuedDateLagos: row.issued_date_lagos,
    issuedAt: row.issued_at,
  };
}

function mapSupaLedger(row: any): LedgerEntryRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    entryType: row.entry_type,
    entryKind: row.entry_kind || 'RECEIPT',
    amountKobo: Number(row.amount_kobo),
    cashReceivedKobo: Number(row.cash_received_kobo),
    paymentMethod: row.payment_method || null,
    receiptId: row.receipt_id || null,
    receiptNumber: row.receipts?.receipt_number || row.receipt_number || null,
    creditSaleId: row.credit_sale_id || null,
    expenseId: row.expense_id || null,
    parentEntryId: row.parent_entry_id || null,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    note: row.note || '',
    soldBy: row.sold_by || '',
    source: row.source || 'manual',
    isCorrection: Boolean(row.is_correction),
    correctionReason: row.correction_reason || '',
    entryDate: row.entry_date,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapSupaCreditSale(row: any): CreditSaleRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || '',
    itemNote: row.item_note || '',
    totalKobo: Number(row.total_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    dueDate: row.due_date || null,
    soldBy: row.sold_by || '',
    receiptId: row.receipt_id || null,
    status: row.status,
    entryDate: row.entry_date,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapSupaCreditor(row: any): CreditorRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    supplierName: row.supplier_name,
    phone: row.phone || '',
    description: row.description || '',
    amountKobo: Number(row.amount_kobo),
    dueDate: row.due_date || null,
    status: row.status,
    paidAt: row.paid_at || null,
    paidMethod: row.paid_method || null,
    expenseId: row.expense_id || null,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapSupaExpense(row: any): ExpenseRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    entryDate: row.entry_date,
    amountKobo: Number(row.amount_kobo),
    category: row.category,
    payee: row.payee || '',
    paymentMethod: row.payment_method || 'Cash',
    note: row.note || '',
    proofPath: row.proof_path || null,
    proofUrl: row.proof_path || null,
    source: row.source || 'manual',
    ledgerEntryId: row.ledger_entry_id || null,
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function mapSupaClosure(row: any): DayClosureRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    closeDate: row.close_date,
    openingCashKobo: Number(row.opening_cash_kobo),
    expectedCashKobo: Number(row.expected_cash_kobo),
    countedCashKobo: Number(row.counted_cash_kobo),
    varianceKobo: Number(row.variance_kobo),
    totalSalesKobo: Number(row.total_sales_kobo),
    quickSalesKobo: Number(row.quick_sales_kobo),
    receiptSalesKobo: Number(row.receipt_sales_kobo),
    creditSalesKobo: Number(row.credit_sales_kobo),
    paymentsReceivedKobo: Number(row.payments_received_kobo),
    expensesKobo: Number(row.expenses_kobo),
    netKobo: Number(row.net_kobo),
    note: row.note || '',
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

async function getSupabaseBusiness(): Promise<BusinessProfile> {
  if (!supabase) throw new ApiError('Supabase not configured', 500);
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) throw new ApiError('Authentication required', 401);
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_id', userRes.user.id)
    .maybeSingle();
  if (error) throw new ApiError(error.message, 400);
  if (!data) throw new ApiError('Business onboarding required', 404);
  return mapSupaBusiness(data);
}

export const api = {
  getAuthConfig() {
    if (isSupabaseConfigured) {
      return Promise.resolve({
        googleOAuthConfigured: true,
        directEmailSignInEnabled: false,
        supabaseMode: true,
      });
    }
    return request<{
      googleOAuthConfigured: boolean;
      directEmailSignInEnabled?: boolean;
      supabaseMode?: boolean;
    }>('/api/auth/config');
  },
  getGoogleAuthUrl() {
    return request<{ url: string }>('/api/auth/google/url');
  },
  signInWithGoogle(email: string, name?: string) {
    return request<{ user: UserProfile; business: BusinessProfile | null; sessionToken: string }>(
      '/api/auth/google',
      {
        method: 'POST',
        body: JSON.stringify({ email, name }),
      }
    );
  },
  requestMagicLink(email: string, name?: string) {
    return request<{ ok: boolean; expiresAt: string; magicLinkUrl: string; token: string }>(
      '/api/auth/magic-link',
      {
        method: 'POST',
        body: JSON.stringify({ email, name }),
      }
    );
  },
  verifyMagicLink(token: string) {
    return request<{ user: UserProfile; business: BusinessProfile | null; sessionToken: string }>(
      '/api/auth/magic-link/verify',
      {
        method: 'POST',
        body: JSON.stringify({ token }),
      }
    );
  },
  async getMe() {
    if (isSupabaseConfigured && supabase) {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new ApiError('Authentication required', 401);
      const u = userRes.user;
      const user: UserProfile = {
        id: u.id,
        email: u.email || '',
        name: (u.user_metadata?.full_name as string) || (u.user_metadata?.name as string) || '',
        authProvider: u.app_metadata?.provider === 'google' ? 'google' : 'magic_link',
        createdAt: u.created_at || new Date().toISOString(),
      };
      const { data: bizRow, error: bizErr } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', u.id)
        .maybeSingle();
      if (bizErr) throw new ApiError(bizErr.message, 400);
      return { user, business: bizRow ? mapSupaBusiness(bizRow) : null };
    }
    return request<{ user: UserProfile; business: BusinessProfile | null }>('/api/auth/me');
  },
  async logout() {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
      return { ok: true };
    }
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  async saveBusiness(payload: Record<string, unknown>) {
    if (isSupabaseConfigured && supabase) {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) throw new ApiError('Authentication required', 401);
      const rowPayload = {
        owner_id: userRes.user.id,
        name: payload.name,
        logo_data_url: payload.logoDataUrl ?? null,
        address: payload.address ?? '',
        phone: payload.phone ?? '',
        email: payload.email ?? '',
        brand_color: payload.brandColor ?? '#064E3B',
        receipt_prefix: payload.receiptPrefix ?? 'RCT-',
        currency: payload.currency ?? 'NGN',
        vat_enabled: Boolean(payload.vatEnabled),
        vat_mode: payload.vatMode ?? 'exclusive',
        opening_cash_kobo: Number(payload.openingCashKobo ?? 0),
        default_template: payload.defaultTemplate ?? 'modern',
        close_day_reminder_time: payload.closeDayReminderTime ?? '19:00',
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('businesses')
        .upsert(rowPayload, { onConflict: 'owner_id' })
        .select('*')
        .single();
      if (error) throw new ApiError(error.message, 400);
      return { business: mapSupaBusiness(data) };
    }
    return request<{ business: BusinessProfile }>('/api/business', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateBusiness(payload: Record<string, unknown>) {
    if (isSupabaseConfigured && supabase) {
      return api.saveBusiness(payload);
    }
    return request<{ business: BusinessProfile }>('/api/business', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async getSuggestions() {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const [custRes, itemRes] = await Promise.all([
        supabase
          .from('customers')
          .select('id, name, phone')
          .eq('business_id', biz.id)
          .order('updated_at', { ascending: false })
          .limit(100),
        supabase
          .from('catalog_items')
          .select('id, description, unit_price_kobo, use_count')
          .eq('business_id', biz.id)
          .order('use_count', { ascending: false })
          .limit(100),
      ]);
      return {
        customers: (custRes.data || []) as CustomerSuggestion[],
        items: (itemRes.data || []).map((i: any) => ({
          id: i.id,
          description: i.description,
          unitPriceKobo: Number(i.unit_price_kobo),
          useCount: Number(i.use_count),
        })) as CatalogItemSuggestion[],
      };
    }
    return request<{ customers: CustomerSuggestion[]; items: CatalogItemSuggestion[] }>(
      '/api/suggestions'
    );
  },
  async getHome() {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const todayLagos = getLagosDateString();
      const yesterdayLagos = shiftLagosDate(todayLagos, -1);
      const [rctRes, csRes, ledRes, cloRes] = await Promise.all([
        supabase.from('receipts').select('*').eq('business_id', biz.id).order('sequence_number', { ascending: false }),
        supabase.from('credit_sales').select('*').eq('business_id', biz.id).order('entry_date', { ascending: false }),
        supabase.from('ledger_entries').select('*').eq('business_id', biz.id).order('created_at', { ascending: true }),
        supabase.from('day_closures').select('*').eq('business_id', biz.id),
      ]);
      if (rctRes.error) throw new ApiError(rctRes.error.message, 400);
      const receipts = (rctRes.data || []).map(mapSupaReceipt);
      const creditSales = (csRes.data || []).map(mapSupaCreditSale);
      const entries = (ledRes.data || []).map(mapSupaLedger);
      const closures = (cloRes.data || []).map(mapSupaClosure);

      const todayView = buildCashBookDayView({
        date: todayLagos,
        businessOpeningCashKobo: biz.openingCashKobo,
        allEntries: entries,
        closures,
      });
      const debtorGroups = groupDebtsByCustomer({ todayDateLagos: todayLagos, receipts, creditSales });
      const todayActiveReceipts = receipts.filter((r) => r.issuedDateLagos === todayLagos && r.status !== 'VOID');

      return {
        summary: {
          todayDateLagos: todayLagos,
          yesterdayDateLagos: yesterdayLagos,
          yesterdayClosed: closures.some((c) => c.closeDate === yesterdayLagos),
          yesterdayHasActivity: entries.some((e) => e.entryDate === yesterdayLagos),
          todayReceiptsCount: todayActiveReceipts.length,
          todayMoneyReceivedKobo: todayView.moneyInTotalKobo,
          todaySalesTotalKobo:
            todayView.receiptSalesKobo + todayView.quickSalesKobo + todayView.creditSalesGivenKobo,
          todayExpensesKobo: todayView.moneyOutTotalKobo,
          todayNetKobo: todayView.netKobo,
          cashInHandKobo: todayView.closingCashInHandKobo,
          outstandingTotalKobo: debtorGroups.reduce((s, g) => s + g.totalOwedKobo, 0),
          outstandingCount: debtorGroups.reduce((s, g) => s + g.openCount, 0),
          totalReceiptsCount: receipts.length,
        } satisfies HomeSummary,
        recentReceipts: receipts.slice(0, 6),
        outstandingReceipts: receipts
          .filter((r) => r.receiptKind === 'SALE' && r.status === 'PART_PAID' && r.balanceDueKobo > 0)
          .slice(0, 8),
        debtorsPreview: debtorGroups.slice(0, 5),
        todayEntries: todayView.rows.slice(-6).reverse(),
      };
    }
    return request<{
      summary: HomeSummary;
      recentReceipts: ReceiptRecord[];
      outstandingReceipts: ReceiptRecord[];
      debtorsPreview?: DebtorCustomerGroup[];
      todayEntries?: CashBookRow[];
    }>('/api/home');
  },
  async getReceipts(params: {
    q?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    customer?: string;
  } = {}) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      let query = supabase
        .from('receipts')
        .select('*')
        .eq('business_id', biz.id)
        .order('sequence_number', { ascending: false })
        .limit(200);
      if (params.status && params.status !== 'ALL') {
        query = query.eq('status', params.status);
      }
      if (params.dateFrom) query = query.gte('issued_date_lagos', params.dateFrom);
      if (params.dateTo) query = query.lte('issued_date_lagos', params.dateTo);
      const { data, error } = await query;
      if (error) throw new ApiError(error.message, 400);
      let list = (data || []).map(mapSupaReceipt);
      if (params.customer) {
        const c = params.customer.toLowerCase();
        list = list.filter((r) => r.customerName.toLowerCase().includes(c));
      }
      if (params.q) {
        const q = params.q.toLowerCase();
        list = list.filter(
          (r) =>
            r.receiptNumber.toLowerCase().includes(q) ||
            r.customerName.toLowerCase().includes(q) ||
            r.customerPhone.toLowerCase().includes(q) ||
            r.soldBy.toLowerCase().includes(q) ||
            r.items.some((i) => i.description.toLowerCase().includes(q))
        );
      }
      return { receipts: list };
    }
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    if (params.customer) qs.set('customer', params.customer);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ receipts: ReceiptRecord[] }>(`/api/receipts${suffix}`);
  },
  async getReceipt(id: string) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data, error } = await supabase
        .from('receipts')
        .select('*')
        .eq('id', id)
        .eq('business_id', biz.id)
        .single();
      if (error || !data) throw new ApiError('Receipt not found', 404);
      const { data: children } = await supabase
        .from('receipts')
        .select('*')
        .eq('parent_receipt_id', id)
        .eq('business_id', biz.id)
        .order('sequence_number', { ascending: true });
      return {
        receipt: mapSupaReceipt(data),
        linkedPayments: (children || []).map(mapSupaReceipt),
      };
    }
    return request<{ receipt: ReceiptRecord; linkedPayments: ReceiptRecord[] }>(
      `/api/receipts/${encodeURIComponent(id)}`
    );
  },
  async createReceipt(payload: Record<string, unknown>) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('issue_receipt', {
        p_customer_name: payload.customerName ?? '',
        p_customer_phone: payload.customerPhone ?? '',
        p_items: payload.items ?? [],
        p_payment_method: payload.paymentMethod ?? 'Cash',
        p_amount_paid_kobo: payload.amountPaidKobo ?? 0,
        p_note: payload.note ?? '',
        p_sold_by: payload.soldBy ?? '',
        p_issued_date_lagos: payload.issuedDateLagos ?? getLagosDateString(),
        p_template: payload.template ?? null,
        p_source: payload.source ?? 'manual',
      });
      if (error) throw new ApiError(error.message, 400);
      return { receipt: mapSupaReceipt(data) };
    }
    return request<{ receipt: ReceiptRecord }>('/api/rpc/issue_receipt', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async receiveBalance(id: string, payload: Record<string, unknown>) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('receive_balance', {
        p_parent_receipt_id: id,
        p_amount_kobo: payload.amountKobo,
        p_payment_method: payload.paymentMethod ?? 'Cash',
        p_note: payload.note ?? '',
        p_sold_by: payload.soldBy ?? '',
        p_issued_date_lagos: payload.issuedDateLagos ?? getLagosDateString(),
        p_template: payload.template ?? null,
      });
      if (error) throw new ApiError(error.message, 400);
      return {
        receipt: mapSupaReceipt((data as any).receipt),
        parentReceipt: mapSupaReceipt((data as any).parentReceipt),
      };
    }
    return request<{ receipt: ReceiptRecord; parentReceipt: ReceiptRecord }>(
      `/api/receipts/${encodeURIComponent(id)}/receive-balance`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },
  async voidReceipt(id: string, reason: string) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('void_receipt', {
        p_receipt_id: id,
        p_reason: reason,
      });
      if (error) throw new ApiError(error.message, 400);
      return { receipt: mapSupaReceipt(data) };
    }
    return request<{ receipt: ReceiptRecord }>(`/api/receipts/${encodeURIComponent(id)}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
  async getPublicReceipt(publicId: string) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('get_public_receipt', {
        p_public_id: publicId,
      });
      if (error) throw new ApiError(error.message, 404);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new ApiError('Receipt not found', 404);
      return { receipt: mapSupaPublicReceipt(row) };
    }
    return request<{ receipt: PublicReceiptRecord }>(
      `/api/rpc/get_public_receipt/${encodeURIComponent(publicId)}`
    );
  },

  // ============ PHASE 2: QUICK SALES, CREDIT SALES, DEBTORS, CREDITORS ============

  async createQuickSale(payload: {
    amountKobo: number;
    note?: string;
    paymentMethod: PaymentMethod;
    customerName?: string;
    customerPhone?: string;
    soldBy?: string;
    entryDate?: string;
    source?: 'manual' | 'voice' | 'quick_sale';
  }) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('ledger_entries')
        .insert({
          business_id: biz.id,
          entry_type: 'SALE',
          entry_kind: 'QUICK_SALE',
          amount_kobo: payload.amountKobo,
          cash_received_kobo: payload.amountKobo,
          payment_method: payload.paymentMethod,
          customer_name: payload.customerName || '',
          customer_phone: payload.customerPhone || '',
          note: payload.note || 'Quick sale',
          sold_by: payload.soldBy || '',
          source: payload.source || 'quick_sale',
          entry_date: payload.entryDate || getLagosDateString(),
          created_by: userRes.user!.id,
        })
        .select('*')
        .single();
      if (error) throw new ApiError(error.message, 400);
      return { entry: mapSupaLedger(data) };
    }
    return request<{ entry: LedgerEntryRecord }>('/api/sales/quick', {
      method: 'POST',
      body: JSON.stringify({
        amountKobo: payload.amountKobo,
        itemNote: payload.note || '',
        paymentMethod: payload.paymentMethod,
        customerName: payload.customerName || '',
        customerPhone: payload.customerPhone || '',
        soldBy: payload.soldBy || '',
        entryDate: payload.entryDate,
        source: payload.source === 'voice' ? 'voice' : 'manual',
      }),
    });
  },

  async issueReceiptFromQuickSale(entryId: string) {
    if (isSupabaseConfigured && supabase) {
      // Uses existing entry fields to issue receipt cleanly
      const { data: entryRow, error: eErr } = await supabase
        .from('ledger_entries')
        .select('*')
        .eq('id', entryId)
        .single();
      if (eErr || !entryRow) throw new ApiError('Quick sale entry not found', 404);
      const res = await api.createReceipt({
        customerName: entryRow.customer_name || '',
        customerPhone: entryRow.customer_phone || '',
        items: [
          {
            description: entryRow.note || 'Store purchase',
            qty: 1,
            unitPriceKobo: Number(entryRow.amount_kobo),
            discountKobo: 0,
          },
        ],
        paymentMethod: entryRow.payment_method || 'Cash',
        amountPaidKobo: Number(entryRow.amount_kobo),
        note: entryRow.note || '',
        soldBy: entryRow.sold_by || '',
        issuedDateLagos: entryRow.entry_date,
      });
      await supabase.from('ledger_entries').update({ receipt_id: res.receipt.id }).eq('id', entryId);
      return res;
    }
    return request<{ receipt: ReceiptRecord }>(`/api/ledger/${encodeURIComponent(entryId)}/issue-receipt`, {
      method: 'POST',
    });
  },

  async createCreditSale(payload: {
    customerName: string;
    customerPhone?: string;
    amountKobo: number;
    itemNote?: string;
    dueDate?: string;
    soldBy?: string;
    entryDate?: string;
  }) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data: userRes } = await supabase.auth.getUser();
      const entryDate = payload.entryDate || getLagosDateString();
      const { data: cs, error: csErr } = await supabase
        .from('credit_sales')
        .insert({
          business_id: biz.id,
          customer_name: payload.customerName,
          customer_phone: payload.customerPhone || '',
          item_note: payload.itemNote || '',
          total_kobo: payload.amountKobo,
          amount_paid_kobo: 0,
          balance_due_kobo: payload.amountKobo,
          due_date: payload.dueDate || null,
          sold_by: payload.soldBy || '',
          status: 'UNPAID',
          entry_date: entryDate,
          created_by: userRes.user!.id,
        })
        .select('*')
        .single();
      if (csErr) throw new ApiError(csErr.message, 400);
      await supabase.from('ledger_entries').insert({
        business_id: biz.id,
        entry_type: 'SALE',
        entry_kind: 'CREDIT_SALE',
        amount_kobo: payload.amountKobo,
        cash_received_kobo: 0,
        payment_method: 'Other',
        credit_sale_id: cs.id,
        customer_name: payload.customerName,
        customer_phone: payload.customerPhone || '',
        note: payload.itemNote || `Credit sale to ${payload.customerName}`,
        sold_by: payload.soldBy || '',
        source: 'manual',
        entry_date: entryDate,
        created_by: userRes.user!.id,
      });
      return { creditSale: mapSupaCreditSale(cs) };
    }
    return request<{ creditSale: CreditSaleRecord }>('/api/sales/credit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getDebtors() {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const todayLagos = getLagosDateString();
      const [rctRes, csRes] = await Promise.all([
        supabase.from('receipts').select('*').eq('business_id', biz.id).order('sequence_number', { ascending: false }),
        supabase.from('credit_sales').select('*').eq('business_id', biz.id).order('entry_date', { ascending: false }),
      ]);
      const receipts = (rctRes.data || []).map(mapSupaReceipt);
      const creditSales = (csRes.data || []).map(mapSupaCreditSale);
      const debtors = groupDebtsByCustomer({ todayDateLagos: todayLagos, receipts, creditSales });
      return {
        debtors,
        totalOwedKobo: debtors.reduce((s, d) => s + d.totalOwedKobo, 0),
        recentDebtPayments: receipts
          .filter((r) => r.receiptKind === 'BALANCE_PAYMENT' && r.status !== 'VOID')
          .slice(0, 20),
      };
    }
    return request<{
      debtors: DebtorCustomerGroup[];
      totalOwedKobo: number;
      recentDebtPayments: ReceiptRecord[];
    }>('/api/debtors');
  },

  async recordDebtPayment(payload: {
    debtKind: 'RECEIPT' | 'CREDIT_SALE';
    debtId: string;
    amountKobo: number;
    paymentMethod: PaymentMethod;
    note?: string;
    soldBy?: string;
    issuedDateLagos?: string;
    template?: 'modern' | 'classic' | 'compact';
  }) {
    if (isSupabaseConfigured && supabase) {
      if (payload.debtKind === 'RECEIPT') {
        return api.receiveBalance(payload.debtId, payload);
      }
      const { data, error } = await supabase.rpc('record_credit_payment', {
        p_credit_sale_id: payload.debtId,
        p_amount_kobo: payload.amountKobo,
        p_payment_method: payload.paymentMethod,
        p_note: payload.note ?? '',
        p_sold_by: payload.soldBy ?? '',
        p_issued_date_lagos: payload.issuedDateLagos ?? getLagosDateString(),
        p_template: payload.template ?? null,
      });
      if (error) throw new ApiError(error.message, 400);
      return {
        receipt: mapSupaReceipt((data as any).receipt),
        creditSale: mapSupaCreditSale((data as any).creditSale),
      };
    }
    return request<{
      receipt: ReceiptRecord;
      parentReceipt?: ReceiptRecord;
      creditSale?: CreditSaleRecord;
    }>('/api/debts/record-payment', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getCreditors() {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data, error } = await supabase
        .from('creditors')
        .select('*')
        .eq('business_id', biz.id)
        .order('status', { ascending: true })
        .order('due_date', { ascending: true });
      if (error) throw new ApiError(error.message, 400);
      return { creditors: (data || []).map(mapSupaCreditor) };
    }
    return request<{ creditors: CreditorRecord[] }>('/api/creditors');
  },

  async createCreditor(payload: {
    supplierName: string;
    phone?: string;
    description?: string;
    amountKobo: number;
    dueDate?: string;
  }) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('creditors')
        .insert({
          business_id: biz.id,
          supplier_name: payload.supplierName,
          phone: payload.phone || '',
          description: payload.description || '',
          amount_kobo: payload.amountKobo,
          due_date: payload.dueDate || null,
          status: 'UNPAID',
          created_by: userRes.user!.id,
        })
        .select('*')
        .single();
      if (error) throw new ApiError(error.message, 400);
      return { creditor: mapSupaCreditor(data) };
    }
    return request<{ creditor: CreditorRecord }>('/api/creditors', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async markCreditorPaid(
    id: string,
    payload: {
      paymentMethod: PaymentMethod;
      recordAsExpense: boolean;
      entryDate?: string;
      note?: string;
    }
  ) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data: row } = await supabase.from('creditors').select('*').eq('id', id).single();
      if (!row) throw new ApiError('Creditor not found', 404);
      let expenseId: string | null = null;
      if (payload.recordAsExpense) {
        const exp = await api.createExpense({
          entryDate: payload.entryDate || getLagosDateString(),
          amountKobo: Number(row.amount_kobo),
          category: 'Stock',
          payee: row.supplier_name,
          paymentMethod: payload.paymentMethod,
          note: payload.note || `Supplier payment: ${row.supplier_name}`,
        });
        expenseId = exp.expense.id;
      }
      const { data, error } = await supabase
        .from('creditors')
        .update({
          status: 'PAID',
          paid_at: new Date().toISOString(),
          paid_method: payload.paymentMethod,
          expense_id: expenseId,
        })
        .eq('id', id)
        .eq('business_id', biz.id)
        .select('*')
        .single();
      if (error) throw new ApiError(error.message, 400);
      return { creditor: mapSupaCreditor(data) };
    }
    return request<{ creditor: CreditorRecord }>(`/api/creditors/${encodeURIComponent(id)}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteCreditor(id: string) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('creditors').delete().eq('id', id);
      if (error) throw new ApiError(error.message, 400);
      return { ok: true };
    }
    return request<{ ok: boolean }>(`/api/creditors/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // ============ PHASE 2: EXPENSES & PRIVATE PROOF STORAGE ============

  async uploadExpenseProof(dataUrl: string) {
    if (isSupabaseConfigured && supabase) {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) throw new ApiError('Authentication required', 401);
      const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) throw new ApiError('Upload a valid PNG, JPG, or WEBP image', 400);
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      const path = `${userRes.user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('expense-proofs')
        .upload(path, bytes, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: false });
      if (error) throw new ApiError(error.message, 400);
      return { proofPath: path, proofUrl: path };
    }
    return request<{ proofPath: string; proofUrl: string }>('/api/expenses/proof', {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    });
  },

  async fetchAuthenticatedProofBlobUrl(proofPathOrUrl: string): Promise<string> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.storage
        .from('expense-proofs')
        .createSignedUrl(proofPathOrUrl, 120);
      if (error || !data?.signedUrl) throw new ApiError('Unable to load proof image', 403);
      return data.signedUrl;
    }
    const headers = new Headers();
    const token = getStoredSessionToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(proofPathOrUrl, {
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
      if (!res.ok) throw new ApiError('Unable to load proof image', res.status);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } finally {
      clearTimeout(timer);
    }
  },

  async getExpenses(params: {
    q?: string;
    category?: string;
    paymentMethod?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      let query = supabase
        .from('expenses')
        .select('*')
        .eq('business_id', biz.id)
        .eq('is_deleted', false)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (params.category && params.category !== 'ALL') query = query.ilike('category', params.category);
      if (params.paymentMethod && params.paymentMethod !== 'ALL') {
        query = query.eq('payment_method', params.paymentMethod);
      }
      if (params.dateFrom) query = query.gte('entry_date', params.dateFrom);
      if (params.dateTo) query = query.lte('entry_date', params.dateTo);
      const [expRes, cloRes] = await Promise.all([
        query,
        supabase.from('day_closures').select('close_date').eq('business_id', biz.id),
      ]);
      if (expRes.error) throw new ApiError(expRes.error.message, 400);
      const closed = new Set((cloRes.data || []).map((c: any) => c.close_date));
      let list = (expRes.data || []).map(mapSupaExpense).map((e) => ({
        ...e,
        isClosedDay: closed.has(e.entryDate),
      }));
      if (params.q) {
        const q = params.q.toLowerCase();
        list = list.filter(
          (e) =>
            e.category.toLowerCase().includes(q) ||
            e.payee.toLowerCase().includes(q) ||
            e.note.toLowerCase().includes(q)
        );
      }
      return { expenses: list };
    }
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category && params.category !== 'ALL') qs.set('category', params.category);
    if (params.paymentMethod && params.paymentMethod !== 'ALL') {
      qs.set('paymentMethod', params.paymentMethod);
    }
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ expenses: ExpenseRecord[] }>(`/api/expenses${suffix}`);
  },

  async getExpenseRevisions(id: string) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('expense_revisions')
        .select('*')
        .eq('expense_id', id)
        .order('changed_at', { ascending: false });
      if (error) throw new ApiError(error.message, 400);
      return {
        revisions: (data || []).map((r: any) => ({
          id: r.id,
          expenseId: r.expense_id,
          businessId: r.business_id,
          action: r.action,
          previousJson: typeof r.previous_json === 'string' ? r.previous_json : JSON.stringify(r.previous_json),
          nextJson: r.next_json ? (typeof r.next_json === 'string' ? r.next_json : JSON.stringify(r.next_json)) : null,
          reason: r.reason || '',
          changedAt: r.changed_at,
          changedBy: r.changed_by,
        })) as ExpenseRevisionRecord[],
      };
    }
    return request<{ revisions: ExpenseRevisionRecord[] }>(
      `/api/expenses/${encodeURIComponent(id)}/revisions`
    );
  },

  async createExpense(payload: {
    entryDate?: string;
    amountKobo: number;
    category: string;
    payee?: string;
    paymentMethod: PaymentMethod;
    note?: string;
    proofPath?: string | null;
    source?: 'manual' | 'voice' | 'quick_sale';
  }) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data: userRes } = await supabase.auth.getUser();
      const entryDate = payload.entryDate || getLagosDateString();
      const { data: exp, error } = await supabase
        .from('expenses')
        .insert({
          business_id: biz.id,
          entry_date: entryDate,
          amount_kobo: payload.amountKobo,
          category: payload.category,
          payee: payload.payee || '',
          payment_method: payload.paymentMethod,
          note: payload.note || '',
          proof_path: payload.proofPath || null,
          source: payload.source || 'manual',
          created_by: userRes.user!.id,
        })
        .select('*')
        .single();
      if (error) throw new ApiError(error.message, error.message.includes('closed') ? 409 : 400);
      const { data: led } = await supabase
        .from('ledger_entries')
        .insert({
          business_id: biz.id,
          entry_type: 'EXPENSE',
          entry_kind: 'EXPENSE',
          amount_kobo: payload.amountKobo,
          cash_received_kobo: 0,
          payment_method: payload.paymentMethod,
          expense_id: exp.id,
          customer_name: payload.payee || '',
          note: `${payload.category}${payload.payee ? ` · ${payload.payee}` : ''}${payload.note ? ` — ${payload.note}` : ''}`,
          source: payload.source || 'manual',
          entry_date: entryDate,
          created_by: userRes.user!.id,
        })
        .select('id')
        .single();
      if (led?.id) {
        await supabase.from('expenses').update({ ledger_entry_id: led.id }).eq('id', exp.id);
      }
      return { expense: mapSupaExpense(exp) };
    }
    return request<{ expense: ExpenseRecord }>('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateExpense(
    id: string,
    payload: Partial<{
      entryDate: string;
      amountKobo: number;
      category: string;
      payee: string;
      paymentMethod: PaymentMethod;
      note: string;
      proofPath: string | null;
      reason: string;
    }>
  ) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('expenses')
        .update({
          ...(payload.entryDate ? { entry_date: payload.entryDate } : {}),
          ...(payload.amountKobo !== undefined ? { amount_kobo: payload.amountKobo } : {}),
          ...(payload.category ? { category: payload.category } : {}),
          ...(payload.payee !== undefined ? { payee: payload.payee } : {}),
          ...(payload.paymentMethod ? { payment_method: payload.paymentMethod } : {}),
          ...(payload.note !== undefined ? { note: payload.note } : {}),
          ...(payload.proofPath !== undefined ? { proof_path: payload.proofPath } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new ApiError(error.message, error.message.includes('closed') ? 409 : 400);
      return { expense: mapSupaExpense(data) };
    }
    return request<{ expense: ExpenseRecord }>(`/api/expenses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteExpense(id: string) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('expenses')
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new ApiError(error.message, error.message.includes('closed') ? 409 : 400);
      return { ok: true };
    }
    return request<{ ok: boolean }>(`/api/expenses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // ============ PHASE 2: CASH BOOK, CLOSE DAY & CORRECTIONS ============

  async getCashBook(date?: string) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const todayLagos = getLagosDateString();
      const target = date || todayLagos;
      const yesterdayLagos = shiftLagosDate(todayLagos, -1);
      const [ledRes, cloRes] = await Promise.all([
        supabase
          .from('ledger_entries')
          .select('*, receipts(receipt_number)')
          .eq('business_id', biz.id)
          .order('created_at', { ascending: true }),
        supabase.from('day_closures').select('*').eq('business_id', biz.id).order('close_date', { ascending: false }),
      ]);
      if (ledRes.error) throw new ApiError(ledRes.error.message, 400);
      const allEntries = (ledRes.data || []).map(mapSupaLedger);
      const closures = (cloRes.data || []).map(mapSupaClosure);
      const dayView = buildCashBookDayView({
        date: target,
        businessOpeningCashKobo: biz.openingCashKobo,
        allEntries,
        closures,
      });
      return {
        dayView,
        closures: closures.slice(0, 30),
        todayDateLagos: todayLagos,
        yesterdayDateLagos: yesterdayLagos,
        yesterdayClosed: closures.some((c) => c.closeDate === yesterdayLagos),
        yesterdayHasActivity: allEntries.some((e) => e.entryDate === yesterdayLagos),
      };
    }
    const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
    return request<{
      dayView: CashBookDayView;
      closures: DayClosureRecord[];
      todayDateLagos: string;
      yesterdayDateLagos: string;
      yesterdayClosed: boolean;
      yesterdayHasActivity: boolean;
    }>(`/api/cashbook${suffix}`);
  },

  async closeDay(payload: { closeDate: string; countedCashKobo: number; note?: string }) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data: userRes } = await supabase.auth.getUser();
      const cb = await api.getCashBook(payload.closeDate);
      const dv = cb.dayView;
      const variance = calculateCloseDayVariance(dv.closingCashInHandKobo, payload.countedCashKobo);
      const totalSales = dv.receiptSalesKobo + dv.quickSalesKobo + dv.creditSalesGivenKobo;
      const { data, error } = await supabase
        .from('day_closures')
        .insert({
          business_id: biz.id,
          close_date: payload.closeDate,
          opening_cash_kobo: dv.openingCashKobo,
          expected_cash_kobo: dv.closingCashInHandKobo,
          counted_cash_kobo: payload.countedCashKobo,
          variance_kobo: variance,
          total_sales_kobo: totalSales,
          quick_sales_kobo: dv.quickSalesKobo,
          receipt_sales_kobo: dv.receiptSalesKobo,
          credit_sales_kobo: dv.creditSalesGivenKobo,
          payments_received_kobo: dv.paymentsReceivedKobo,
          expenses_kobo: dv.moneyOutTotalKobo,
          net_kobo: dv.netKobo,
          note: payload.note || '',
          closed_by: userRes.user!.id,
        })
        .select('*')
        .single();
      if (error) throw new ApiError(error.message, 409);
      const closure = mapSupaClosure(data);
      return { closure, dayView: { ...dv, isClosed: true, closure } };
    }
    return request<{ closure: DayClosureRecord; dayView: CashBookDayView }>('/api/cashbook/close', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async postCorrectionEntry(payload: {
    entryDate: string;
    direction: 'IN' | 'OUT';
    amountKobo: number;
    paymentMethod: PaymentMethod;
    reason: string;
    soldBy?: string;
    expenseId?: string | null;
  }) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data: userRes } = await supabase.auth.getUser();
      const signed = payload.direction === 'IN' ? payload.amountKobo : -payload.amountKobo;
      const { data, error } = await supabase
        .from('ledger_entries')
        .insert({
          business_id: biz.id,
          entry_type: 'ADJUSTMENT',
          entry_kind: 'CORRECTION',
          amount_kobo: signed,
          cash_received_kobo: signed,
          payment_method: payload.paymentMethod,
          expense_id: payload.expenseId || null,
          note: `Correction (${payload.direction === 'IN' ? '+' : '−'}): ${payload.reason}`,
          sold_by: payload.soldBy || '',
          source: 'manual',
          is_correction: true,
          correction_reason: payload.reason,
          entry_date: payload.entryDate,
          created_by: userRes.user!.id,
        })
        .select('*')
        .single();
      if (error) throw new ApiError(error.message, 400);
      return { entry: mapSupaLedger(data) };
    }
    return request<{ entry: LedgerEntryRecord }>('/api/cashbook/correction', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // ============ PHASE 2: REPORTS & CSV EXPORTS ============

  async getReports(dateFrom: string, dateTo: string) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const [ledRes, expRes, rctRes, csRes] = await Promise.all([
        supabase
          .from('ledger_entries')
          .select('*')
          .eq('business_id', biz.id)
          .gte('entry_date', dateFrom)
          .lte('entry_date', dateTo)
          .order('entry_date', { ascending: true }),
        supabase
          .from('expenses')
          .select('*')
          .eq('business_id', biz.id)
          .eq('is_deleted', false)
          .gte('entry_date', dateFrom)
          .lte('entry_date', dateTo),
        supabase
          .from('receipts')
          .select('balance_due_kobo')
          .eq('business_id', biz.id)
          .eq('receipt_kind', 'SALE')
          .eq('status', 'PART_PAID'),
        supabase
          .from('credit_sales')
          .select('balance_due_kobo')
          .eq('business_id', biz.id)
          .in('status', ['UNPAID', 'PART_PAID']),
      ]);
      const ledgerRows = (ledRes.data || []).map(mapSupaLedger);
      const expenseRows = (expRes.data || []).map(mapSupaExpense);

      let receiptSalesKobo = 0;
      let quickSalesKobo = 0;
      let creditSalesGivenKobo = 0;
      let paymentsReceivedKobo = 0;
      let moneyInTotalKobo = 0;
      let expensesTotalKobo = 0;
      const methodMap = new Map<string, { inKobo: number; outKobo: number }>();
      const soldByMap = new Map<string, { salesKobo: number; count: number }>();
      const customerMap = new Map<string, { totalKobo: number; count: number }>();
      const dailyMap = new Map<string, { moneyInKobo: number; expensesKobo: number }>();

      for (const entry of ledgerRows) {
        const { moneyInKobo, moneyOutKobo } = getEntrySignedFlow(entry);
        const method = entry.paymentMethod || 'Cash';
        moneyInTotalKobo += moneyInKobo;
        expensesTotalKobo += moneyOutKobo;
        const m = methodMap.get(method) || { inKobo: 0, outKobo: 0 };
        m.inKobo += moneyInKobo;
        m.outKobo += moneyOutKobo;
        methodMap.set(method, m);
        const d = dailyMap.get(entry.entryDate) || { moneyInKobo: 0, expensesKobo: 0 };
        d.moneyInKobo += moneyInKobo;
        d.expensesKobo += moneyOutKobo;
        dailyMap.set(entry.entryDate, d);

        if (entry.entryType === 'SALE') {
          if (entry.entryKind === 'QUICK_SALE') quickSalesKobo += entry.amountKobo;
          else if (entry.entryKind === 'CREDIT_SALE') creditSalesGivenKobo += entry.amountKobo;
          else receiptSalesKobo += entry.amountKobo;
          const seller = entry.soldBy.trim() || 'Owner / Unassigned';
          const sb = soldByMap.get(seller) || { salesKobo: 0, count: 0 };
          sb.salesKobo += entry.amountKobo;
          sb.count += 1;
          soldByMap.set(seller, sb);
          if (entry.customerName.trim()) {
            const cn = entry.customerName.trim();
            const cm = customerMap.get(cn) || { totalKobo: 0, count: 0 };
            cm.totalKobo += entry.amountKobo;
            cm.count += 1;
            customerMap.set(cn, cm);
          }
        } else if (entry.entryType === 'PAYMENT_RECEIVED') {
          paymentsReceivedKobo += entry.cashReceivedKobo;
        } else if (entry.entryType === 'ADJUSTMENT' && entry.entryKind === 'VOID_REVERSAL') {
          receiptSalesKobo += entry.amountKobo;
        }
      }

      const catMap = new Map<string, { totalKobo: number; count: number }>();
      for (const exp of expenseRows) {
        const c = catMap.get(exp.category) || { totalKobo: 0, count: 0 };
        c.totalKobo += exp.amountKobo;
        c.count += 1;
        catMap.set(exp.category, c);
      }

      const outstandingDebtsKobo =
        (rctRes.data || []).reduce((s: number, r: any) => s + Number(r.balance_due_kobo || 0), 0) +
        (csRes.data || []).reduce((s: number, r: any) => s + Number(r.balance_due_kobo || 0), 0);

      const report: ReportsSummary = {
        dateFrom,
        dateTo,
        salesTotalKobo: receiptSalesKobo + quickSalesKobo + creditSalesGivenKobo,
        receiptSalesKobo,
        quickSalesKobo,
        creditSalesGivenKobo,
        paymentsReceivedKobo,
        moneyInTotalKobo,
        expensesTotalKobo,
        netMoneyInMinusOutKobo: moneyInTotalKobo - expensesTotalKobo,
        outstandingDebtsKobo,
        byPaymentMethod: Array.from(methodMap.entries()).map(([method, v]) => ({
          method,
          inKobo: v.inKobo,
          outKobo: v.outKobo,
          netKobo: v.inKobo - v.outKobo,
        })),
        byExpenseCategory: Array.from(catMap.entries())
          .map(([category, v]) => ({ category, totalKobo: v.totalKobo, count: v.count }))
          .sort((a, b) => b.totalKobo - a.totalKobo),
        bySoldBy: Array.from(soldByMap.entries())
          .map(([soldBy, v]) => ({ soldBy, salesKobo: v.salesKobo, count: v.count }))
          .sort((a, b) => b.salesKobo - a.salesKobo),
        topCustomers: Array.from(customerMap.entries())
          .map(([customerName, v]) => ({ customerName, totalKobo: v.totalKobo, count: v.count }))
          .sort((a, b) => b.totalKobo - a.totalKobo)
          .slice(0, 10),
        dailySeries: Array.from(dailyMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, v]) => ({ date, moneyInKobo: v.moneyInKobo, expensesKobo: v.expensesKobo })),
      };
      return { report };
    }
    const qs = new URLSearchParams({ dateFrom, dateTo });
    return request<{ report: ReportsSummary }>(`/api/reports?${qs.toString()}`);
  },

  async downloadCsv(
    type: 'receipts' | 'expenses' | 'ledger' | 'debtors',
    dateFrom: string,
    dateTo: string,
    businessCurrency: CurrencyCode = 'NGN'
  ) {
    let csvText = '';
    if (isSupabaseConfigured && supabase) {
      if (type === 'receipts') {
        const { receipts } = await api.getReceipts({ dateFrom, dateTo });
        csvText = buildCsv(
          ['Date', 'Receipt #', 'Kind', 'Customer', 'Phone', 'Total', 'Paid', 'Balance Due', 'Method', 'Sold By', 'Status'],
          receipts.map((r) => [
            r.issuedDateLagos,
            r.receiptNumber,
            r.receiptKind,
            r.customerName || 'Walk-in',
            r.customerPhone,
            formatKobo(r.totalKobo, businessCurrency),
            formatKobo(r.amountPaidKobo, businessCurrency),
            formatKobo(r.balanceDueKobo, businessCurrency),
            r.paymentMethod,
            r.soldBy,
            r.status,
          ])
        );
      } else if (type === 'expenses') {
        const { expenses } = await api.getExpenses({ dateFrom, dateTo });
        csvText = buildCsv(
          ['Date', 'Category', 'Payee', 'Amount', 'Method', 'Note'],
          expenses.map((e) => [
            e.entryDate,
            e.category,
            e.payee,
            formatKobo(e.amountKobo, businessCurrency),
            e.paymentMethod,
            e.note,
          ])
        );
      } else if (type === 'debtors') {
        const { debtors } = await api.getDebtors();
        csvText = buildCsv(
          ['Customer', 'Phone', 'Total Owed', 'Oldest Debt Date', 'Age (Days)', 'Open Items'],
          debtors.map((g) => [
            g.customerName,
            g.customerPhone,
            formatKobo(g.totalOwedKobo, businessCurrency),
            g.oldestDebtDate,
            g.oldestDebtAgeDays,
            g.openCount,
          ])
        );
      } else {
        const biz = await getSupabaseBusiness();
        const { data } = await supabase
          .from('ledger_entries')
          .select('*, receipts(receipt_number)')
          .eq('business_id', biz.id)
          .gte('entry_date', dateFrom)
          .lte('entry_date', dateTo)
          .order('entry_date', { ascending: true });
        const entries = (data || []).map(mapSupaLedger);
        csvText = buildCsv(
          ['Date', 'Type', 'Kind', 'Receipt #', 'Customer / Payee', 'Method', 'Money In', 'Money Out', 'Note', 'Sold By'],
          entries.map((e) => {
            const flow = getEntrySignedFlow(e);
            return [
              e.entryDate,
              e.entryType,
              e.entryKind,
              e.receiptNumber || '',
              e.customerName,
              e.paymentMethod || 'Cash',
              formatKobo(flow.moneyInKobo, businessCurrency),
              formatKobo(flow.moneyOutKobo, businessCurrency),
              e.note,
              e.soldBy,
            ];
          })
        );
      }
    } else {
      const headers = new Headers();
      const token = getStoredSessionToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const qs = new URLSearchParams({ type, dateFrom, dateTo });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(`/api/reports/csv?${qs.toString()}`, {
          headers,
          credentials: 'include',
          signal: controller.signal,
        });
        if (!res.ok) throw new ApiError('Unable to export CSV', res.status);
        csvText = await res.text();
      } finally {
        clearTimeout(timer);
      }
    }

    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tallymark-${type}-${getLagosDateString()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  async exportData() {
    if (isSupabaseConfigured && supabase) {
      const { user, business } = await api.getMe();
      if (!business) {
        return {
          exportedAt: new Date().toISOString(),
          user,
          business: null,
          receipts: [],
          ledgerEntries: [],
          creditSales: [],
          creditors: [],
          expenses: [],
          dayClosures: [],
        };
      }
      const [rctRes, ledRes, csRes, crRes, expRes, cloRes] = await Promise.all([
        supabase
          .from('receipts')
          .select('*')
          .eq('business_id', business.id)
          .order('sequence_number', { ascending: true }),
        supabase
          .from('ledger_entries')
          .select('*, receipts(receipt_number)')
          .eq('business_id', business.id)
          .order('entry_date', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase.from('credit_sales').select('*').eq('business_id', business.id),
        supabase.from('creditors').select('*').eq('business_id', business.id),
        supabase.from('expenses').select('*').eq('business_id', business.id),
        supabase
          .from('day_closures')
          .select('*')
          .eq('business_id', business.id)
          .order('close_date', { ascending: false }),
      ]);
      return {
        exportedAt: new Date().toISOString(),
        user,
        business,
        receipts: (rctRes.data || []).map(mapSupaReceipt),
        ledgerEntries: (ledRes.data || []).map(mapSupaLedger),
        creditSales: (csRes.data || []).map(mapSupaCreditSale),
        creditors: (crRes.data || []).map(mapSupaCreditor),
        expenses: (expRes.data || []).map(mapSupaExpense),
        dayClosures: (cloRes.data || []).map(mapSupaClosure),
      };
    }
    return request<Record<string, unknown>>('/api/account/export');
  },
  async parseVoiceTranscript(transcript: string) {
    // Always goes to our Node server endpoint so GEMINI_API_KEY stays strictly server-side
    const headers: Record<string, string> = {};
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        headers.Authorization = `Bearer ${data.session.access_token}`;
      }
    }
    return request<{
      entries: VoiceDraftItem[];
      summaryNote: string;
      model: string;
    }>('/api/voice/parse', {
      method: 'POST',
      headers,
      body: JSON.stringify({ transcript }),
    });
  },

  async confirmVoiceEntries(entries: ConfirmVoiceEntryInput[]) {
    if (isSupabaseConfigured && supabase) {
      const biz = await getSupabaseBusiness();
      const { data: userRes } = await supabase.auth.getUser();
      const todayLagos = getLagosDateString();
      const saved: LedgerEntryRecord[] = [];
      for (const item of entries) {
        const entryDate = item.entryDate || todayLagos;
        if (item.type === 'sale') {
          const { data, error } = await supabase
            .from('ledger_entries')
            .insert({
              business_id: biz.id,
              entry_type: 'SALE',
              entry_kind: 'QUICK_SALE',
              amount_kobo: item.amountKobo,
              cash_received_kobo: item.amountKobo,
              payment_method: item.paymentMethod,
              customer_name: item.customerName || '',
              customer_phone: item.customerPhone || '',
              note: item.note || 'Voice sale',
              sold_by: item.soldBy || '',
              source: 'voice',
              entry_date: entryDate,
              created_by: userRes.user!.id,
            })
            .select('*')
            .single();
          if (error) throw new ApiError(error.message, 400);
          saved.push(mapSupaLedger(data));
        } else if (item.type === 'expense') {
          const cat = item.category?.trim() || 'Other';
          const { data: exp, error: eErr } = await supabase
            .from('expenses')
            .insert({
              business_id: biz.id,
              entry_date: entryDate,
              amount_kobo: item.amountKobo,
              category: cat,
              payee: item.customerName || '',
              payment_method: item.paymentMethod,
              note: item.note || `${cat} expense`,
              source: 'voice',
              created_by: userRes.user!.id,
            })
            .select('*')
            .single();
          if (eErr) throw new ApiError(eErr.message, 400);
          const { data: led, error: lErr } = await supabase
            .from('ledger_entries')
            .insert({
              business_id: biz.id,
              entry_type: 'EXPENSE',
              entry_kind: 'EXPENSE',
              amount_kobo: item.amountKobo,
              cash_received_kobo: 0,
              payment_method: item.paymentMethod,
              expense_id: exp.id,
              customer_name: item.customerName || '',
              note: item.note || `${cat} expense`,
              sold_by: item.soldBy || '',
              source: 'voice',
              entry_date: entryDate,
              created_by: userRes.user!.id,
            })
            .select('*')
            .single();
          if (lErr) throw new ApiError(lErr.message, 400);
          await supabase.from('expenses').update({ ledger_entry_id: led.id }).eq('id', exp.id);
          saved.push(mapSupaLedger(led));
        } else if (item.type === 'credit_sale') {
          const { data: cs, error: csErr } = await supabase
            .from('credit_sales')
            .insert({
              business_id: biz.id,
              customer_name: item.customerName,
              customer_phone: item.customerPhone || '',
              item_note: item.note || '',
              total_kobo: item.amountKobo,
              amount_paid_kobo: 0,
              balance_due_kobo: item.amountKobo,
              sold_by: item.soldBy || '',
              status: 'UNPAID',
              entry_date: entryDate,
              created_by: userRes.user!.id,
            })
            .select('*')
            .single();
          if (csErr) throw new ApiError(csErr.message, 400);
          const { data: led, error: lErr } = await supabase
            .from('ledger_entries')
            .insert({
              business_id: biz.id,
              entry_type: 'SALE',
              entry_kind: 'CREDIT_SALE',
              amount_kobo: item.amountKobo,
              cash_received_kobo: 0,
              payment_method: 'Other',
              credit_sale_id: cs.id,
              customer_name: item.customerName,
              customer_phone: item.customerPhone || '',
              note: item.note || `Credit sale to ${item.customerName}`,
              sold_by: item.soldBy || '',
              source: 'voice',
              entry_date: entryDate,
              created_by: userRes.user!.id,
            })
            .select('*')
            .single();
          if (lErr) throw new ApiError(lErr.message, 400);
          saved.push(mapSupaLedger(led));
        } else {
          const { data: led, error: lErr } = await supabase
            .from('ledger_entries')
            .insert({
              business_id: biz.id,
              entry_type: 'PAYMENT_RECEIVED',
              entry_kind: 'DEBT_PAYMENT',
              amount_kobo: item.amountKobo,
              cash_received_kobo: item.amountKobo,
              payment_method: item.paymentMethod,
              customer_name: item.customerName || '',
              customer_phone: item.customerPhone || '',
              note: item.note || 'Debt payment received',
              sold_by: item.soldBy || '',
              source: 'voice',
              entry_date: entryDate,
              created_by: userRes.user!.id,
            })
            .select('*')
            .single();
          if (lErr) throw new ApiError(lErr.message, 400);
          saved.push(mapSupaLedger(led));
        }
      }
      return { savedCount: saved.length, entries: saved };
    }

    return request<{ savedCount: number; entries: LedgerEntryRecord[] }>('/api/voice/confirm', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    });
  },

  async deleteAccount() {
    if (isSupabaseConfigured && supabase) {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const userId = sessionData.session?.user?.id;
      if (!accessToken || !userId) {
        throw new ApiError('Authentication required', 401);
      }

      let deletedAuthUser = false;
      try {
        const res = await request<{ ok: boolean; deletedAuthUser?: boolean }>('/api/account', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        deletedAuthUser = Boolean(res.deletedAuthUser);
      } catch {
        // Fallback to RLS cascade deletion below
      }

      if (!deletedAuthUser) {
        try {
          const { data: files } = await supabase.storage.from('expense-proofs').list(userId);
          if (files && files.length > 0) {
            await supabase.storage
              .from('expense-proofs')
              .remove(files.map((f) => `${userId}/${f.name}`));
          }
        } catch {
          // ignore storage cleanup errors
        }
        const { error: delBizErr } = await supabase
          .from('businesses')
          .delete()
          .eq('owner_id', userId);
        if (delBizErr) {
          throw new ApiError(delBizErr.message, 400);
        }
      }

      await supabase.auth.signOut();
      return { ok: true };
    }
    return request<{ ok: boolean }>('/api/account', { method: 'DELETE' });
  },

  trackAnalyticsEvent(
    eventName:
      | 'landing_view'
      | 'hero_receipt_updated'
      | 'hero_receipt_stamped'
      | 'hero_template_switched'
      | 'hero_color_switched'
      | 'hero_qr_verified'
      | 'hero_make_yours_clicked'
      | 'cta_get_started_clicked'
      | 'cta_open_app_clicked'
      | 'summary_period_changed'
      | 'faq_toggled',
    path: string = '/'
  ) {
    if (typeof window === 'undefined') return;
    try {
      const cleanPath = path.startsWith('/') ? path.split('?')[0].split('#')[0].slice(0, 120) || '/' : '/';
      fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          eventName,
          path: cleanPath,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {
      // Never block UI on telemetry
    }
  },
};
