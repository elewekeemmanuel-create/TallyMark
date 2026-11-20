import { formatKobo, formatLagosDateOnly, koboToWords } from '../shared/money';
import { formatQtyThousandths, formatTermsLabel } from '../shared/v2/money';
import type { PublicInvoiceRecord, PublicQuoteRecord } from '../shared/v2/types';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sanitizeColor(hex: string | undefined | null): string {
  if (hex && /^#[0-9a-fA-F]{3,6}$/.test(hex.trim())) {
    return hex.trim();
  }
  return '#064E3B';
}

function sanitizeLogoDataUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (
    url.startsWith('data:image/png;base64,') ||
    url.startsWith('data:image/jpeg;base64,') ||
    url.startsWith('data:image/jpg;base64,') ||
    url.startsWith('data:image/webp;base64,')
  ) {
    return url;
  }
  return null;
}

function getStamp(inv: PublicInvoiceRecord): { label: string; cls: string } {
  if (inv.status === 'VOID') return { label: 'VOID', cls: 'stamp stamp-danger' };
  if (inv.status === 'PAID') return { label: 'PAID', cls: 'stamp stamp-paid' };
  if (inv.status === 'SETTLED') return { label: 'SETTLED', cls: 'stamp stamp-paid' };
  if (inv.isOverdue) return { label: 'OVERDUE', cls: 'stamp stamp-danger' };
  if (inv.status === 'PART_PAID') return { label: 'PART PAID', cls: 'stamp stamp-part' };
  return { label: 'UNPAID', cls: 'stamp stamp-neutral' };
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', 'true');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    return ok;
  } catch {
    return false;
  }
}

async function fetchPublicInvoice(publicId: string): Promise<PublicInvoiceRecord | null> {
  // Primary: Express / Vercel API route
  try {
    const res = await fetch(`/api/v2/public/invoices/${encodeURIComponent(publicId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const json = await res.json();
        if (json?.invoice?.snapshot) {
          return json.invoice as PublicInvoiceRecord;
        }
      }
    } else if (res.status === 404) {
      // Only fall back to Supabase REST if Express isn't backing this static host
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        return null;
      }
    }
  } catch {
    // Fall through to Supabase REST RPC if configured
  }

  // Fallback for static deployments backed directly by Supabase (no @supabase/supabase-js needed)
  const supaUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supaAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supaUrl || !supaAnon) {
    return null;
  }

  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/get_public_invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        apikey: supaAnon,
        Authorization: `Bearer ${supaAnon}`,
      },
      body: JSON.stringify({ p_public_id: publicId }),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.snapshot) return null;
    return data as PublicInvoiceRecord;
  } catch {
    return null;
  }
}

function renderNotFound(root: HTMLElement) {
  root.replaceChildren();
  const card = el('div', 'state-card');
  card.appendChild(el('h1', 'state-title', 'Document not found'));
  card.appendChild(
    el(
      'p',
      'state-desc',
      'This link is invalid or is no longer active. Ask the business for an updated link.'
    )
  );
  root.appendChild(card);
}

async function fetchPublicQuote(publicId: string): Promise<PublicQuoteRecord | null> {
  try {
    const res = await fetch(`/api/v2/public/quotes/${encodeURIComponent(publicId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const json = await res.json();
        if (json?.quote?.snapshot) {
          return json.quote as PublicQuoteRecord;
        }
      }
    } else if (res.status === 404) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        return null;
      }
    }
  } catch {
    // Fall through to Supabase REST RPC if configured
  }

  const supaUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supaAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supaUrl || !supaAnon) {
    return null;
  }

  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/get_public_quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        apikey: supaAnon,
        Authorization: `Bearer ${supaAnon}`,
      },
      body: JSON.stringify({ p_public_id: publicId }),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.snapshot) return null;
    return data as PublicQuoteRecord;
  } catch {
    return null;
  }
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024;

function parseNairaToKobo(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * 100);
}

async function sha256HexBrowser(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function solveBotChallenge(challenge: string, difficulty: number): Promise<string> {
  const prefix = '0'.repeat(Math.max(1, Math.min(5, difficulty)));
  for (let nonce = 0; nonce < 1_000_000; nonce += 1) {
    const candidate = nonce.toString(36);
    const hex = await sha256HexBrowser(`${challenge}:${candidate}`);
    if (hex.startsWith(prefix)) {
      return candidate;
    }
  }
  throw new Error('Verification timed out. Please try again.');
}

function renderInvoice(root: HTMLElement, invoice: PublicInvoiceRecord, openClaimForm = false) {
  const snap = invoice.snapshot;
  const cur = snap.business.currency || 'NGN';
  const brand = sanitizeColor(snap.business.brandColor);
  document.documentElement.style.setProperty('--brand', brand);
  document.title = `${snap.invoiceNumber} · ${snap.business.name}`;

  root.replaceChildren();

  const canClaim =
    (invoice.status === 'SENT' || invoice.status === 'PART_PAID') && invoice.balanceDueKobo > 0;

  // Top action toolbar
  const toolbar = el('div', 'toolbar no-print');
  const docLabel = el('span', 'caps mono', `${snap.invoiceNumber} · ${snap.business.name}`);
  toolbar.appendChild(docLabel);

  const actions = el('div', 'toolbar-actions');
  if (canClaim) {
    const ivePaidTopBtn = el('button', 'btn btn-primary', "I've paid");
    ivePaidTopBtn.type = 'button';
    ivePaidTopBtn.addEventListener('click', () => {
      const box = document.getElementById('claim-section');
      const formWrap = document.getElementById('claim-form-wrap');
      if (formWrap) formWrap.style.display = 'grid';
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    actions.appendChild(ivePaidTopBtn);
  }

  const pdfBtn = el('button', canClaim ? 'btn' : 'btn btn-primary', 'Download PDF');
  pdfBtn.type = 'button';
  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    pdfBtn.textContent = 'Preparing PDF…';
    try {
      const mod = await import('../v2/pdf');
      await mod.downloadInvoicePdf(invoice);
    } catch {
      pdfBtn.textContent = 'PDF failed — tap to retry';
      pdfBtn.disabled = false;
      return;
    }
    pdfBtn.textContent = 'Download PDF';
    pdfBtn.disabled = false;
  });
  actions.appendChild(pdfBtn);

  const printBtn = el('button', 'btn', 'Print');
  printBtn.type = 'button';
  printBtn.addEventListener('click', () => window.print());
  actions.appendChild(printBtn);

  toolbar.appendChild(actions);
  root.appendChild(toolbar);

  // Payment report status banner (NEVER leaks private rejection reason)
  if (invoice.pendingClaimsCount > 0) {
    const banner = el('div', 'claim-banner no-print');
    banner.setAttribute('data-claim-banner', 'pending');
    banner.appendChild(el('p', 'claim-banner-title', 'Payment reported, awaiting confirmation'));
    const refPart = invoice.latestPendingClaimRef
      ? `Report ${invoice.latestPendingClaimRef} received. `
      : '';
    banner.appendChild(
      el(
        'p',
        'claim-banner-sub',
        `${refPart}Your invoice stays open until ${snap.business.name} confirms the transfer and issues a receipt.`
      )
    );
    root.appendChild(banner);
  } else if (invoice.hasRejectedClaim && canClaim) {
    const banner = el('div', 'claim-banner claim-banner-neutral no-print');
    banner.setAttribute('data-claim-banner', 'neutral');
    banner.appendChild(
      el('p', 'claim-banner-title', 'Previous payment report could not be confirmed')
    );
    banner.appendChild(
      el(
        'p',
        'claim-banner-sub',
        'Check your transfer details and submit a new report below, or contact the business directly.'
      )
    );
    root.appendChild(banner);
  }

  // Paper sheet
  const sheet = el('article', 'sheet');
  const accentBar = el('div', 'accent-bar');
  accentBar.style.backgroundColor = brand;
  sheet.appendChild(accentBar);

  const body = el('div', 'sheet-body');

  // Header row: business identity + invoice number & stamp
  const headerRow = el('div', 'row-between');
  const bizHead = el('div', 'biz-head');
  const safeLogo = sanitizeLogoDataUrl(snap.business.logoDataUrl);
  if (safeLogo) {
    const img = el('img', 'biz-logo');
    img.src = safeLogo;
    img.alt = snap.business.name;
    img.referrerPolicy = 'no-referrer';
    bizHead.appendChild(img);
  }
  const bizText = el('div');
  bizText.appendChild(el('h1', 'biz-name', snap.business.name));
  if (snap.business.address) {
    bizText.appendChild(el('p', 'meta-line', snap.business.address));
  }
  const contact = [snap.business.phone, snap.business.email].filter(Boolean).join(' · ');
  if (contact) {
    bizText.appendChild(el('p', 'meta-line', contact));
  }
  if (snap.business.tinRc) {
    bizText.appendChild(el('p', 'meta-line mono', `TIN / RC: ${snap.business.tinRc}`));
  }
  bizHead.appendChild(bizText);
  headerRow.appendChild(bizHead);

  const rightHead = el('div', 'doc-head-right');
  const invCaps = el('p', 'caps mono', 'INVOICE');
  invCaps.style.color = brand;
  invCaps.style.margin = '0';
  rightHead.appendChild(invCaps);
  rightHead.appendChild(el('p', 'doc-number mono', snap.invoiceNumber));
  const stamp = getStamp(invoice);
  const stampNode = el('span', `${stamp.cls} mono`, stamp.label);
  stampNode.setAttribute('data-stamp', stamp.label);
  rightHead.appendChild(stampNode);
  headerRow.appendChild(rightHead);
  body.appendChild(headerRow);

  body.appendChild(el('div', 'divider'));

  // Bill To (NEVER includes customer phone or email) + Dates
  const billGrid = el('div', 'bill-grid');
  const billCol = el('div');
  billCol.appendChild(el('div', 'caps mono', 'Bill To'));
  billCol.appendChild(el('p', 'cust-name', snap.customer.name));
  if (snap.customer.address) {
    billCol.appendChild(el('p', 'meta-line', snap.customer.address));
  }
  billGrid.appendChild(billCol);

  const datesCol = el('div', 'dates-box');
  const dateRows: Array<[string, string]> = [
    ['Issue date', formatLagosDateOnly(snap.issueDate)],
    ['Due date', formatLagosDateOnly(snap.dueDate)],
    ['Terms', formatTermsLabel(snap.termsKind, snap.dueDate)],
  ];
  for (const [k, v] of dateRows) {
    const kv = el('div', 'kv');
    kv.appendChild(el('span', 'kv-label', k));
    kv.appendChild(el('span', 'mono', v));
    datesCol.appendChild(kv);
  }
  billGrid.appendChild(datesCol);
  body.appendChild(billGrid);

  // Line items table
  const table = el('table');
  const thead = el('thead');
  const headTr = el('tr');
  headTr.appendChild(el('th', '', 'Description'));
  headTr.appendChild(el('th', 'num', 'Qty'));
  headTr.appendChild(el('th', 'num', 'Unit price'));
  headTr.appendChild(el('th', 'num', 'Amount'));
  thead.appendChild(headTr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const line of snap.lines) {
    const tr = el('tr');
    const tdDesc = el('td');
    tdDesc.appendChild(el('span', 'line-desc', line.description));
    if (line.discountKobo > 0) {
      tdDesc.appendChild(
        el('span', 'line-disc', `Discount: -${formatKobo(line.discountKobo, cur)}`)
      );
    }
    tr.appendChild(tdDesc);
    tr.appendChild(el('td', 'num mono', formatQtyThousandths(line.qtyThousandths)));
    tr.appendChild(el('td', 'num mono', formatKobo(line.unitPriceKobo, cur)));
    tr.appendChild(el('td', 'num mono', formatKobo(line.lineTotalKobo, cur)));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);

  // Totals block
  const totals = el('div', 'totals-wrap');
  const addTotal = (label: string, val: string, extraCls = '') => {
    const row = el('div', `total-row ${extraCls}`.trim());
    row.appendChild(el('span', extraCls ? '' : 'kv-label', label));
    row.appendChild(el('span', 'mono', val));
    totals.appendChild(row);
  };

  addTotal('Subtotal', formatKobo(snap.subtotalKobo, cur));
  if (snap.lineDiscountTotalKobo > 0) {
    addTotal('Line discounts', `-${formatKobo(snap.lineDiscountTotalKobo, cur)}`);
  }
  if (snap.invoiceDiscountKobo > 0) {
    addTotal('Invoice discount', `-${formatKobo(snap.invoiceDiscountKobo, cur)}`);
  }
  if (snap.vatEnabled && snap.vatKobo > 0) {
    const rate = (snap.vatRateBps / 100).toFixed(1).replace(/\.0$/, '');
    const vatLabel = snap.vatMode === 'inclusive' ? `VAT (${rate}% incl.)` : `VAT (${rate}%)`;
    addTotal(vatLabel, formatKobo(snap.vatKobo, cur));
  }
  addTotal('Invoice Total', formatKobo(snap.totalKobo, cur), 'total-row-strong');
  if (
    snap.depositType !== 'none' &&
    snap.amountDueNowKobo < snap.totalKobo &&
    invoice.amountPaidKobo === 0 &&
    invoice.balanceDueKobo > 0
  ) {
    addTotal('Amount due now', formatKobo(snap.amountDueNowKobo, cur), 'total-row-accent');
  }
  if (invoice.amountPaidKobo > 0) {
    addTotal('Amount paid', formatKobo(invoice.amountPaidKobo, cur));
  }
  if (invoice.writtenOffKobo > 0) {
    addTotal('Written off', formatKobo(invoice.writtenOffKobo, cur));
  }
  addTotal("What's left", formatKobo(invoice.balanceDueKobo, cur), 'total-row-accent');
  body.appendChild(totals);

  body.appendChild(el('p', 'words', `In words: ${koboToWords(snap.totalKobo, cur)}`));

  // Bank Details (from snapshot ONLY) with Tap-to-Copy
  if (snap.bankAccounts && snap.bankAccounts.length > 0 && invoice.status !== 'VOID') {
    const bankCard = el('section', 'card-section');
    bankCard.appendChild(el('div', 'caps mono', 'Payment details (Bank transfer)'));
    for (const bank of snap.bankAccounts) {
      const item = el('div', 'bank-item');
      const info = el('div');
      info.appendChild(el('div', 'bank-acct mono', bank.accountNumber));
      info.appendChild(el('div', 'meta-line', `${bank.bankName} · ${bank.accountName}`));
      item.appendChild(info);

      const copyBtn = el('button', 'copy-btn no-print', 'Copy account');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', async () => {
        const ok = await copyText(bank.accountNumber);
        copyBtn.textContent = ok ? 'Copied' : bank.accountNumber;
        setTimeout(() => {
          copyBtn.textContent = 'Copy account';
        }, 2000);
      });
      item.appendChild(copyBtn);
      bankCard.appendChild(item);
    }
    body.appendChild(bankCard);
  }

  // Customer "I've paid" section (logged out; NEVER marks paid or creates ledger entry)
  if (canClaim) {
    const claimBox = el('section', 'claim-box no-print');
    claimBox.id = 'claim-section';

    const head = el('div', 'claim-head');
    const headText = el('div');
    headText.appendChild(el('div', 'caps mono', 'Already transferred?'));
    headText.appendChild(
      el(
        'p',
        'meta-line',
        `Send your transfer reference or receipt photo so ${snap.business.name} can confirm your payment.`
      )
    );
    head.appendChild(headText);

    const toggleBtn = el('button', 'btn btn-primary', "I've paid");
    toggleBtn.type = 'button';
    head.appendChild(toggleBtn);
    claimBox.appendChild(head);

    const form = el('form', 'claim-form');
    form.id = 'claim-form-wrap';
    form.style.display = openClaimForm ? 'grid' : 'none';

    toggleBtn.addEventListener('click', () => {
      form.style.display = form.style.display === 'none' ? 'grid' : 'none';
    });

    const errNode = el('p', 'form-err');
    errNode.style.display = 'none';
    form.appendChild(errNode);

    const showErr = (msg: string) => {
      errNode.textContent = msg;
      errNode.style.display = 'block';
    };

    // Row 1: Payer name + Amount paid
    const grid1 = el('div', 'field-grid');

    const nameField = el('div', 'field');
    const nameLabel = el('label', '', 'Your name');
    nameLabel.htmlFor = 'claim-payer-name';
    const nameInput = el('input');
    nameInput.id = 'claim-payer-name';
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.required = true;
    nameInput.placeholder = 'Name on transfer account';
    nameInput.value = snap.customer.name || '';
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    grid1.appendChild(nameField);

    const amtField = el('div', 'field');
    const amtLabel = el('label', '', `Amount paid (${cur})`);
    amtLabel.htmlFor = 'claim-amount';
    const amtInput = el('input');
    amtInput.id = 'claim-amount';
    amtInput.type = 'number';
    amtInput.step = '0.01';
    amtInput.min = '1';
    amtInput.max = (invoice.balanceDueKobo / 100).toFixed(2);
    amtInput.required = true;
    amtInput.value = (invoice.balanceDueKobo / 100).toFixed(2);
    amtField.appendChild(amtLabel);
    amtField.appendChild(amtInput);
    grid1.appendChild(amtField);
    form.appendChild(grid1);

    // Row 2: Transfer reference + Proof file
    const grid2 = el('div', 'field-grid');

    const refField = el('div', 'field');
    const refLabel = el('label', '', 'Transfer reference');
    refLabel.htmlFor = 'claim-ref';
    const refInput = el('input');
    refInput.id = 'claim-ref';
    refInput.type = 'text';
    refInput.maxLength = 40;
    refInput.placeholder = 'Session ID or bank reference';
    refField.appendChild(refLabel);
    refField.appendChild(refInput);
    refField.appendChild(el('p', 'field-hint', 'Required if you do not attach proof.'));
    grid2.appendChild(refField);

    const fileField = el('div', 'field');
    const fileLabel = el('label', '', 'Payment proof (photo or PDF)');
    fileLabel.htmlFor = 'claim-proof';
    const fileInput = el('input');
    fileInput.id = 'claim-proof';
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp,application/pdf';
    fileField.appendChild(fileLabel);
    fileField.appendChild(fileInput);
    fileField.appendChild(el('p', 'field-hint', 'JPEG, PNG, WebP, or PDF up to 5 MB.'));
    grid2.appendChild(fileField);
    form.appendChild(grid2);

    // Hidden honeypot
    const hpInput = el('input', 'hp-field');
    hpInput.type = 'text';
    hpInput.name = 'website';
    hpInput.tabIndex = -1;
    hpInput.autocomplete = 'off';
    hpInput.setAttribute('aria-hidden', 'true');
    form.appendChild(hpInput);

    const submitBtn = el('button', 'btn btn-primary', 'Send payment report');
    submitBtn.type = 'submit';
    form.appendChild(submitBtn);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errNode.style.display = 'none';

      const payerName = nameInput.value.trim();
      const amountKobo = parseNairaToKobo(amtInput.value);
      const reference = refInput.value.trim();
      const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

      if (!payerName) {
        showErr('Enter your name so the business can match your payment.');
        return;
      }
      if (amountKobo <= 0) {
        showErr('Enter the amount you paid.');
        return;
      }
      if (amountKobo > invoice.balanceDueKobo) {
        showErr(
          `Amount cannot be more than what's left (${formatKobo(invoice.balanceDueKobo, cur)}).`
        );
        return;
      }
      if (!reference && !file) {
        showErr('Enter your transfer reference or attach a photo/PDF of your transfer receipt.');
        return;
      }
      if (file && file.size > MAX_PROOF_BYTES) {
        showErr('Proof file is too large. Maximum size is 5 MB.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying…';

      try {
        // 1. Obtain and solve lightweight bot check
        const chalRes = await fetch('/api/v2/public/bot-challenge', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        const chalJson = await chalRes.json().catch(() => ({}));
        if (!chalRes.ok || !chalJson.challenge) {
          throw new Error(chalJson.error || 'Unable to verify right now. Please try again.');
        }

        const solution = await solveBotChallenge(
          String(chalJson.challenge),
          Number(chalJson.difficulty || 3)
        );

        submitBtn.textContent = file ? 'Uploading proof…' : 'Sending report…';

        // 2. Create payment claim (never marks invoice paid)
        const claimRes = await fetch(
          `/api/v2/public/invoices/${encodeURIComponent(invoice.publicId)}/claims`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            body: JSON.stringify({
              payerName,
              amountKobo,
              reference,
              hasProof: Boolean(file),
              botChallenge: chalJson.challenge,
              botSolution: solution,
              website: hpInput.value,
            }),
          }
        );
        const claimJson = await claimRes.json().catch(() => ({}));
        if (!claimRes.ok) {
          throw new Error(claimJson.error || 'Could not submit payment report. Please try again.');
        }

        // 3. Upload proof binary using single-use 5-minute token bound to this claim
        if (file && claimJson.uploadToken && claimJson.claimId) {
          const uploadRes = await fetch(
            `/api/v2/public/claims/${encodeURIComponent(claimJson.claimId)}/proof`,
            {
              method: 'POST',
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'x-upload-token': claimJson.uploadToken,
              },
              cache: 'no-store',
              credentials: 'omit',
              referrerPolicy: 'no-referrer',
              body: file,
            }
          );
          const uploadJson = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) {
            throw new Error(
              uploadJson.error ||
                'Your report was recorded, but the proof file was rejected. Choose a valid JPEG, PNG, WebP, or PDF.'
            );
          }
        }

        // 4. Refresh invoice view showing "Payment reported, awaiting confirmation"
        const updated: PublicInvoiceRecord = {
          ...invoice,
          pendingClaimsCount: invoice.pendingClaimsCount + 1,
          latestPendingClaimRef: claimJson.claimRef || invoice.latestPendingClaimRef || null,
        };
        renderInvoice(root, updated, false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err: any) {
        showErr(err?.message || 'Unable to submit payment report right now.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send payment report';
      }
    });

    claimBox.appendChild(form);
    body.appendChild(claimBox);
  }

  // Payments received summary
  if (invoice.payments && invoice.payments.length > 0) {
    const payCard = el('section', 'card-section');
    payCard.appendChild(el('div', 'caps mono', 'Payments received'));
    for (const p of invoice.payments) {
      const item = el('div', 'pay-item');
      const leftText = [
        formatLagosDateOnly(p.paymentDate),
        p.paymentMethod,
        p.receiptNumber || '',
      ]
        .filter(Boolean)
        .join(' · ');
      item.appendChild(el('span', '', leftText));
      item.appendChild(el('span', 'mono', formatKobo(p.amountKobo, cur)));
      payCard.appendChild(item);
    }
    body.appendChild(payCard);
  }

  // Notes
  if (snap.notes) {
    const notesBox = el('section', 'card-section');
    notesBox.appendChild(el('div', 'caps mono', 'Notes'));
    notesBox.appendChild(el('p', 'notes-text', snap.notes));
    body.appendChild(notesBox);
  }

  sheet.appendChild(body);
  root.appendChild(sheet);

  // Small subtle link gated by entitlement
  if (snap.showBranding) {
    const foot = el('p', 'footer-brand no-print');
    foot.appendChild(document.createTextNode('Made with '));
    const link = el('a', '', 'Tallymark');
    link.href = '/';
    link.rel = 'noopener noreferrer';
    foot.appendChild(link);
    root.appendChild(foot);
  }
}

function getQuoteStamp(quote: PublicQuoteRecord): { label: string; cls: string } {
  if (quote.status === 'VOID') return { label: 'VOID', cls: 'stamp stamp-danger' };
  if (quote.status === 'ACCEPTED') return { label: 'ACCEPTED', cls: 'stamp stamp-paid' };
  if (quote.status === 'CONVERTED') return { label: 'CONVERTED', cls: 'stamp stamp-paid' };
  if (quote.status === 'DECLINED') return { label: 'DECLINED', cls: 'stamp stamp-danger' };
  if (quote.isExpired) return { label: 'EXPIRED', cls: 'stamp stamp-part' };
  return { label: 'QUOTATION', cls: 'stamp stamp-neutral' };
}

function formatDecisionTimestamp(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-NG', {
      timeZone: 'Africa/Lagos',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function renderQuote(root: HTMLElement, quote: PublicQuoteRecord) {
  const snap = quote.snapshot;
  const cur = snap.business.currency || 'NGN';
  const brand = sanitizeColor(snap.business.brandColor);
  document.documentElement.style.setProperty('--brand', brand);
  document.title = `${snap.quoteNumber} · ${snap.business.name}`;

  root.replaceChildren();

  const canRespond = quote.status === 'SENT' && !quote.isExpired;

  // Top action toolbar
  const toolbar = el('div', 'toolbar no-print');
  toolbar.appendChild(el('span', 'caps mono', `${snap.quoteNumber} · ${snap.business.name}`));

  const actions = el('div', 'toolbar-actions');
  if (canRespond) {
    const respondTopBtn = el('button', 'btn btn-primary', 'Accept or Decline');
    respondTopBtn.type = 'button';
    respondTopBtn.addEventListener('click', () => {
      const box = document.getElementById('quote-decision-section');
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    actions.appendChild(respondTopBtn);
  }

  const pdfBtn = el('button', canRespond ? 'btn' : 'btn btn-primary', 'Download PDF');
  pdfBtn.type = 'button';
  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    pdfBtn.textContent = 'Preparing PDF…';
    try {
      const mod = await import('../v2/pdf');
      await mod.downloadQuotePdf(quote);
    } catch {
      pdfBtn.textContent = 'PDF failed — tap to retry';
      pdfBtn.disabled = false;
      return;
    }
    pdfBtn.textContent = 'Download PDF';
    pdfBtn.disabled = false;
  });
  actions.appendChild(pdfBtn);

  const printBtn = el('button', 'btn', 'Print');
  printBtn.type = 'button';
  printBtn.addEventListener('click', () => window.print());
  actions.appendChild(printBtn);

  toolbar.appendChild(actions);
  root.appendChild(toolbar);

  // Status banner for responded / expired / voided quotes
  if (quote.status === 'ACCEPTED' || quote.status === 'CONVERTED') {
    const banner = el('div', 'claim-banner claim-banner-accepted no-print');
    banner.setAttribute('data-quote-banner', 'accepted');
    banner.appendChild(
      el(
        'p',
        'claim-banner-title',
        quote.status === 'CONVERTED' ? 'Quote accepted and converted to an invoice' : 'Quote accepted'
      )
    );
    const details = [
      quote.decisionName ? `Accepted by ${quote.decisionName}` : null,
      quote.decisionAt ? formatDecisionTimestamp(quote.decisionAt) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (details) {
      banner.appendChild(el('p', 'claim-banner-sub', details));
    }
    root.appendChild(banner);
  } else if (quote.status === 'DECLINED') {
    const banner = el('div', 'claim-banner claim-banner-danger no-print');
    banner.setAttribute('data-quote-banner', 'declined');
    banner.appendChild(el('p', 'claim-banner-title', 'Quote declined'));
    const details = [
      quote.decisionName ? `Declined by ${quote.decisionName}` : null,
      quote.decisionAt ? formatDecisionTimestamp(quote.decisionAt) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (details) {
      banner.appendChild(el('p', 'claim-banner-sub', details));
    }
    root.appendChild(banner);
  } else if (quote.isExpired) {
    const banner = el('div', 'claim-banner no-print');
    banner.setAttribute('data-quote-banner', 'expired');
    banner.appendChild(el('p', 'claim-banner-title', 'This quote has expired'));
    banner.appendChild(
      el(
        'p',
        'claim-banner-sub',
        `Valid until ${formatLagosDateOnly(snap.validUntil)}. Ask ${snap.business.name} for an updated quote.`
      )
    );
    root.appendChild(banner);
  } else if (quote.status === 'VOID') {
    const banner = el('div', 'claim-banner claim-banner-danger no-print');
    banner.setAttribute('data-quote-banner', 'void');
    banner.appendChild(el('p', 'claim-banner-title', 'This quote has been voided'));
    banner.appendChild(
      el(
        'p',
        'claim-banner-sub',
        quote.voidReason || `Ask ${snap.business.name} if you need a new quotation.`
      )
    );
    root.appendChild(banner);
  }

  // Paper sheet
  const sheet = el('article', 'sheet');
  const accentBar = el('div', 'accent-bar');
  accentBar.style.backgroundColor = brand;
  sheet.appendChild(accentBar);

  const body = el('div', 'sheet-body');

  // Header row
  const headerRow = el('div', 'row-between');
  const bizHead = el('div', 'biz-head');
  const safeLogo = sanitizeLogoDataUrl(snap.business.logoDataUrl);
  if (safeLogo) {
    const img = el('img', 'biz-logo');
    img.src = safeLogo;
    img.alt = snap.business.name;
    img.referrerPolicy = 'no-referrer';
    bizHead.appendChild(img);
  }
  const bizText = el('div');
  bizText.appendChild(el('h1', 'biz-name', snap.business.name));
  if (snap.business.address) {
    bizText.appendChild(el('p', 'meta-line', snap.business.address));
  }
  const contact = [snap.business.phone, snap.business.email].filter(Boolean).join(' · ');
  if (contact) {
    bizText.appendChild(el('p', 'meta-line', contact));
  }
  if (snap.business.tinRc) {
    bizText.appendChild(el('p', 'meta-line mono', `TIN / RC: ${snap.business.tinRc}`));
  }
  bizHead.appendChild(bizText);
  headerRow.appendChild(bizHead);

  const rightHead = el('div', 'doc-head-right');
  const qCaps = el('p', 'caps mono', 'QUOTATION');
  qCaps.style.color = brand;
  qCaps.style.margin = '0';
  rightHead.appendChild(qCaps);
  rightHead.appendChild(el('p', 'doc-number mono', snap.quoteNumber));
  const stamp = getQuoteStamp(quote);
  const stampNode = el('span', `${stamp.cls} mono`, stamp.label);
  stampNode.setAttribute('data-stamp', stamp.label);
  rightHead.appendChild(stampNode);
  headerRow.appendChild(rightHead);
  body.appendChild(headerRow);

  body.appendChild(el('div', 'divider'));

  // Prepared For (NEVER includes customer phone or email) + Dates
  const billGrid = el('div', 'bill-grid');
  const billCol = el('div');
  billCol.appendChild(el('div', 'caps mono', 'Prepared For'));
  billCol.appendChild(el('p', 'cust-name', snap.customer.name));
  if (snap.customer.address) {
    billCol.appendChild(el('p', 'meta-line', snap.customer.address));
  }
  billGrid.appendChild(billCol);

  const datesCol = el('div', 'dates-box');
  const dateRows: Array<[string, string]> = [
    ['Issue date', formatLagosDateOnly(snap.issueDate)],
    ['Valid until', formatLagosDateOnly(snap.validUntil)],
    ['Payment terms', formatTermsLabel(snap.termsKind)],
  ];
  for (const [k, v] of dateRows) {
    const kv = el('div', 'kv');
    kv.appendChild(el('span', 'kv-label', k));
    kv.appendChild(el('span', 'mono', v));
    datesCol.appendChild(kv);
  }
  billGrid.appendChild(datesCol);
  body.appendChild(billGrid);

  // Line items table
  const table = el('table');
  const thead = el('thead');
  const headTr = el('tr');
  headTr.appendChild(el('th', '', 'Description'));
  headTr.appendChild(el('th', 'num', 'Qty'));
  headTr.appendChild(el('th', 'num', 'Unit price'));
  headTr.appendChild(el('th', 'num', 'Amount'));
  thead.appendChild(headTr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const line of snap.lines) {
    const tr = el('tr');
    const tdDesc = el('td');
    tdDesc.appendChild(el('span', 'line-desc', line.description));
    if (line.discountKobo > 0) {
      tdDesc.appendChild(
        el('span', 'line-disc', `Discount: -${formatKobo(line.discountKobo, cur)}`)
      );
    }
    tr.appendChild(tdDesc);
    tr.appendChild(el('td', 'num mono', formatQtyThousandths(line.qtyThousandths)));
    tr.appendChild(el('td', 'num mono', formatKobo(line.unitPriceKobo, cur)));
    tr.appendChild(el('td', 'num mono', formatKobo(line.lineTotalKobo, cur)));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);

  // Totals block
  const totals = el('div', 'totals-wrap');
  const addTotal = (label: string, val: string, extraCls = '') => {
    const row = el('div', `total-row ${extraCls}`.trim());
    row.appendChild(el('span', extraCls ? '' : 'kv-label', label));
    row.appendChild(el('span', 'mono', val));
    totals.appendChild(row);
  };

  addTotal('Subtotal', formatKobo(snap.subtotalKobo, cur));
  if (snap.lineDiscountTotalKobo > 0) {
    addTotal('Line discounts', `-${formatKobo(snap.lineDiscountTotalKobo, cur)}`);
  }
  if (snap.invoiceDiscountKobo > 0) {
    addTotal('Quote discount', `-${formatKobo(snap.invoiceDiscountKobo, cur)}`);
  }
  if (snap.vatEnabled && snap.vatKobo > 0) {
    const rate = (snap.vatRateBps / 100).toFixed(1).replace(/\.0$/, '');
    const vatLabel = snap.vatMode === 'inclusive' ? `VAT (${rate}% incl.)` : `VAT (${rate}%)`;
    addTotal(vatLabel, formatKobo(snap.vatKobo, cur));
  }
  addTotal('Quote Total', formatKobo(snap.totalKobo, cur), 'total-row-strong total-row-accent');
  if (snap.depositType !== 'none' && snap.amountDueNowKobo < snap.totalKobo) {
    addTotal('Deposit if accepted', formatKobo(snap.amountDueNowKobo, cur));
  }
  body.appendChild(totals);

  body.appendChild(el('p', 'words', `In words: ${koboToWords(snap.totalKobo, cur)}`));

  // Public Accept & Decline action panel (when SENT and not expired)
  if (canRespond) {
    const decisionBox = el('section', 'claim-box no-print');
    decisionBox.id = 'quote-decision-section';

    decisionBox.appendChild(el('div', 'caps mono', 'Respond to this quote'));
    decisionBox.appendChild(
      el(
        'p',
        'meta-line',
        `Enter your name below to accept or decline this quote from ${snap.business.name}.`
      )
    );

    const form = el('form', 'claim-form');
    const errNode = el('p', 'form-err');
    errNode.style.display = 'none';
    form.appendChild(errNode);

    const showErr = (msg: string) => {
      errNode.textContent = msg;
      errNode.style.display = 'block';
    };

    const grid = el('div', 'field-grid');

    const nameField = el('div', 'field');
    const nameLabel = el('label', '', 'Your name');
    nameLabel.htmlFor = 'quote-decision-name';
    const nameInput = el('input');
    nameInput.id = 'quote-decision-name';
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.required = true;
    nameInput.placeholder = 'Full name';
    nameInput.value = snap.customer.name || '';
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    grid.appendChild(nameField);

    const noteField = el('div', 'field');
    const noteLabel = el('label', '', 'Note (optional)');
    noteLabel.htmlFor = 'quote-decision-note';
    const noteInput = el('input');
    noteInput.id = 'quote-decision-note';
    noteInput.type = 'text';
    noteInput.maxLength = 240;
    noteInput.placeholder = 'Delivery date or short comment';
    noteField.appendChild(noteLabel);
    noteField.appendChild(noteInput);
    grid.appendChild(noteField);

    form.appendChild(grid);

    // Hidden honeypot
    const hpInput = el('input', 'hp-field');
    hpInput.type = 'text';
    hpInput.name = 'website';
    hpInput.tabIndex = -1;
    hpInput.autocomplete = 'off';
    hpInput.setAttribute('aria-hidden', 'true');
    form.appendChild(hpInput);

    const btnRow = el('div', 'toolbar-actions');
    const acceptBtn = el('button', 'btn btn-primary', 'Accept quote');
    acceptBtn.type = 'button';
    const declineBtn = el('button', 'btn btn-danger-outline', 'Decline quote');
    declineBtn.type = 'button';
    btnRow.appendChild(acceptBtn);
    btnRow.appendChild(declineBtn);
    form.appendChild(btnRow);

    const submitDecision = async (action: 'accept' | 'decline') => {
      errNode.style.display = 'none';
      const name = nameInput.value.trim();
      const note = noteInput.value.trim();
      if (!name) {
        showErr('Enter your name to respond to this quote.');
        return;
      }

      acceptBtn.disabled = true;
      declineBtn.disabled = true;
      const activeBtn = action === 'accept' ? acceptBtn : declineBtn;
      const origLabel = activeBtn.textContent || '';
      activeBtn.textContent = 'Verifying…';

      try {
        const chalRes = await fetch('/api/v2/public/bot-challenge', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        const chalJson = await chalRes.json().catch(() => ({}));
        if (!chalRes.ok || !chalJson.challenge) {
          throw new Error(chalJson.error || 'Unable to verify right now. Please try again.');
        }

        const solution = await solveBotChallenge(
          String(chalJson.challenge),
          Number(chalJson.difficulty || 3)
        );

        activeBtn.textContent = action === 'accept' ? 'Accepting…' : 'Declining…';

        const res = await fetch(
          `/api/v2/public/quotes/${encodeURIComponent(quote.publicId)}/${action}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            body: JSON.stringify({
              name,
              note,
              botChallenge: chalJson.challenge,
              botSolution: solution,
              website: hpInput.value,
            }),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || 'Could not record your response. Please try again.');
        }

        if (json?.quote?.snapshot) {
          renderQuote(root, json.quote as PublicQuoteRecord);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } catch (err: any) {
        showErr(err?.message || 'Unable to send your response right now.');
        acceptBtn.disabled = false;
        declineBtn.disabled = false;
        activeBtn.textContent = origLabel;
      }
    };

    acceptBtn.addEventListener('click', () => submitDecision('accept'));
    declineBtn.addEventListener('click', () => submitDecision('decline'));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      submitDecision('accept');
    });

    decisionBox.appendChild(form);
    body.appendChild(decisionBox);
  }

  // Notes
  if (snap.notes) {
    const notesBox = el('section', 'card-section');
    notesBox.appendChild(el('div', 'caps mono', 'Notes & Terms'));
    notesBox.appendChild(el('p', 'notes-text', snap.notes));
    body.appendChild(notesBox);
  }

  sheet.appendChild(body);
  root.appendChild(sheet);

  if (snap.showBranding) {
    const foot = el('p', 'footer-brand no-print');
    foot.appendChild(document.createTextNode('Made with '));
    const link = el('a', '', 'Tallymark');
    link.href = '/';
    link.rel = 'noopener noreferrer';
    foot.appendChild(link);
    root.appendChild(foot);
  }
}

async function boot() {
  const root = document.getElementById('app');
  if (!root) return;

  const path = window.location.pathname || '';
  const invMatch = /^\/i\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (invMatch) {
    const invoice = await fetchPublicInvoice(invMatch[1]);
    if (!invoice) {
      renderNotFound(root);
      return;
    }
    renderInvoice(root, invoice);
    return;
  }

  const quoteMatch = /^\/q\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (quoteMatch) {
    const quote = await fetchPublicQuote(quoteMatch[1]);
    if (!quote) {
      renderNotFound(root);
      return;
    }
    renderQuote(root, quote);
    return;
  }

  renderNotFound(root);
}

boot();
