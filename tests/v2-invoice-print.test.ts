import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import type { PublicInvoiceRecord } from '../src/shared/v2/types.ts';
import { generateInvoicePdfBytes } from '../src/v2/pdf.ts';

function loadLocalFonts() {
  const read = (file: string): ArrayBuffer => {
    const buf = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };
  return {
    sansRegular: read('IBMPlexSans-Regular.ttf'),
    sansSemiBold: read('IBMPlexSans-SemiBold.ttf'),
    monoRegular: read('IBMPlexMono-Regular.ttf'),
    monoSemiBold: read('IBMPlexMono-SemiBold.ttf'),
    serifRegular: read('InstrumentSerif-Regular.ttf'),
  };
}

function makeSampleInvoice(lineCount: number): PublicInvoiceRecord {
  const lines = Array.from({ length: lineCount }, (_, idx) => {
    const unitPriceKobo = (idx + 1) * 250_000;
    const discountKobo = idx % 4 === 0 ? 15_000 : 0;
    return {
      id: `line-${idx + 1}`,
      position: idx,
      description: `Industrial Copper Cable 2.5mm Roll #${idx + 1} (Pure Grade)`,
      qtyThousandths: 2000,
      unitPriceKobo,
      grossKobo: unitPriceKobo * 2,
      discountKobo,
      lineTotalKobo: unitPriceKobo * 2 - discountKobo,
    };
  });
  const subtotalKobo = lines.reduce((s, l) => s + l.unitPriceKobo * 2, 0);
  const lineDiscountTotalKobo = lines.reduce((s, l) => s + l.discountKobo, 0);
  const invoiceDiscountKobo = 50_000;
  const taxable = subtotalKobo - lineDiscountTotalKobo - invoiceDiscountKobo;
  const vatKobo = Math.round(taxable * 0.075);
  const totalKobo = taxable + vatKobo;
  const amountPaidKobo = 500_000;

  return {
    publicId: 'inv_compact_print_test_1234',
    status: 'PART_PAID',
    isOverdue: false,
    amountPaidKobo,
    writtenOffKobo: 0,
    balanceDueKobo: totalKobo - amountPaidKobo,
    sentAt: '2026-11-22T09:00:00.000Z',
    voidReason: null,
    voidedAt: null,
    pendingClaimsCount: 0,
    snapshot: {
      invoiceNumber: 'INV-2026-0042',
      business: {
        name: 'Chinedu Electricals & Solar Ltd',
        logoDataUrl: null,
        address: 'Plot 14 Aba Road, Port Harcourt, Rivers State',
        phone: '0803 555 0199',
        email: 'sales@chineduelectricals.ng',
        tinRc: 'RC-1928374 / TIN 20481920-0001',
        brandColor: '#064E3B',
        currency: 'NGN',
      },
      customer: {
        name: 'Amaka Construction & Interiors Ltd',
        address: '8 GRA Phase 2, Port Harcourt',
      },
      bankAccounts: [
        {
          id: 'bank-1',
          bankName: 'GTBank',
          accountNumber: '0123456789',
          accountName: 'Chinedu Electricals & Solar Ltd',
          isDefault: true,
        },
        {
          id: 'bank-2',
          bankName: 'Zenith Bank',
          accountNumber: '1019283746',
          accountName: 'Chinedu Electricals & Solar Ltd',
          isDefault: false,
        },
      ],
      issueDate: '2026-11-22',
      dueDate: '2026-12-06',
      termsKind: 'net_14',
      lines,
      subtotalKobo,
      lineDiscountTotalKobo,
      invoiceDiscountKobo,
      vatEnabled: true,
      vatMode: 'exclusive',
      vatRateBps: 750,
      vatKobo,
      totalKobo,
      depositType: 'none',
      depositValue: 0,
      amountDueNowKobo: totalKobo,
      notes: 'Goods delivered to site in good condition. Please include invoice number as transfer narration.',
      template: 'modern',
      showBranding: true,
    },
    payments: [
      {
        paymentDate: '2026-11-22',
        amountKobo: amountPaidKobo,
        paymentMethod: 'Transfer',
        receiptNumber: 'TM-0091',
        receiptPublicId: 'rcpt_test_91',
      },
    ],
  };
}

test('Compact vector invoice PDF fits standard, dense (18 lines), and heavy (28 lines) invoices onto 1 single A4 page under 150 KB', async () => {
  const fonts = loadLocalFonts();

  for (const count of [6, 18, 28]) {
    const invoice = makeSampleInvoice(count);
    const bytes = await generateInvoicePdfBytes(invoice, 'https://tallymark.app', fonts);

    assert.equal(Buffer.from(bytes.slice(0, 5)).toString('ascii'), '%PDF-');
    assert.ok(
      bytes.byteLength < 150 * 1024,
      `Expected ${count}-line PDF under 150 KB, got ${(bytes.byteLength / 1024).toFixed(1)} KB`
    );

    const parsed = await PDFDocument.load(bytes);
    assert.equal(
      parsed.getPageCount(),
      1,
      `Expected ${count}-line invoice PDF to fit on 1 page, got ${parsed.getPageCount()} pages`
    );
  }
});

test('Print stylesheets and InvoiceDetailPage hide non-document chrome for 1-page printouts', () => {
  const detailSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'v2', 'pages', 'InvoiceDetailPage.tsx'),
    'utf8'
  );
  assert.match(detailSrc, /className="no-print flex flex-wrap items-center justify-between gap-3"/);
  assert.match(detailSrc, /Payments Recorded on this Invoice[\s\S]{0,120}no-print/);

  const shellSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'AppShell.tsx'),
    'utf8'
  );
  assert.match(shellSrc, /print:pl-0/);
  assert.match(shellSrc, /print:p-0/);

  const cssSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8');
  assert.match(cssSrc, /size:\s*A4 portrait/);
  assert.match(cssSrc, /\.invoice-print-sheet/);

  const publicHtml = fs.readFileSync(path.join(process.cwd(), 'public-doc.html'), 'utf8');
  assert.match(publicHtml, /size:\s*A4 portrait/);
});

test('Compact vector quotation PDF fits issued and draft quotes (6 and 22 lines) on 1 A4 page under 150 KB', async () => {
  const { buildQuotePdfFilename, generateQuotePdfBytes } = await import('../src/v2/pdf.ts');
  const fonts = loadLocalFonts();
  const baseInv = makeSampleInvoice(6);

  for (const [status, lineCount] of [
    ['SENT', 6],
    ['SENT', 22],
    ['DRAFT', 8],
  ] as const) {
    const sample = makeSampleInvoice(lineCount);
    const quote = {
      publicId: status === 'DRAFT' ? 'draft' : 'quo_compact_test_1234',
      status,
      isExpired: false,
      sentAt: status === 'DRAFT' ? null : '2026-11-22T09:00:00.000Z',
      decisionName: null,
      decisionNote: null,
      decisionAt: null,
      voidReason: null,
      voidedAt: null,
      snapshot: {
        quoteNumber: status === 'DRAFT' ? 'DRAFT' : 'QUO-0014',
        business: baseInv.snapshot.business,
        customer: sample.snapshot.customer,
        bankAccounts: sample.snapshot.bankAccounts,
        issueDate: '2026-11-22',
        validUntil: '2026-12-06',
        termsKind: 'net_14' as const,
        lines: sample.snapshot.lines,
        subtotalKobo: sample.snapshot.subtotalKobo,
        lineDiscountTotalKobo: sample.snapshot.lineDiscountTotalKobo,
        invoiceDiscountKobo: sample.snapshot.invoiceDiscountKobo,
        vatEnabled: true,
        vatMode: 'exclusive' as const,
        vatRateBps: 750,
        vatKobo: sample.snapshot.vatKobo,
        totalKobo: sample.snapshot.totalKobo,
        depositType: 'none' as const,
        depositValue: 0,
        amountDueNowKobo: sample.snapshot.totalKobo,
        notes: 'Prices valid for 14 days. Installation within 3 working days of acceptance.',
        template: 'modern' as const,
        showBranding: true,
      },
    };

    const bytes = await generateQuotePdfBytes(quote, 'https://tallymark.app', fonts);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString('ascii'), '%PDF-');
    assert.ok(
      bytes.byteLength < 150 * 1024,
      `Expected ${status} ${lineCount}-line quote PDF under 150 KB, got ${(bytes.byteLength / 1024).toFixed(1)} KB`
    );
    const parsed = await PDFDocument.load(bytes);
    assert.equal(parsed.getPageCount(), 1);

    const filename = buildQuotePdfFilename(quote);
    assert.match(filename, /\.pdf$/);
    assert.ok(filename.startsWith(status === 'DRAFT' ? 'DRAFT-' : 'QUO-0014-'));
  }
});

test('QuoteEditorPage, QuoteDetailPage, and QuoteDocument expose Download PDF, Print, and friendly missing-migration errors', async () => {
  const editorSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'v2', 'pages', 'QuoteEditorPage.tsx'),
    'utf8'
  );
  assert.match(editorSrc, /Download PDF/);
  assert.match(editorSrc, /downloadQuotePdf/);

  const detailSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'v2', 'pages', 'QuoteDetailPage.tsx'),
    'utf8'
  );
  assert.match(detailSrc, /Download PDF/);
  assert.match(detailSrc, /window\.print\(\)/);
  assert.match(detailSrc, /className="no-print flex flex-col/);

  const docSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'v2', 'components', 'QuoteDocument.tsx'),
    'utf8'
  );
  assert.match(docSrc, /invoice-print-sheet print-only-container/);

  const apiSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'v2', 'api.ts'), 'utf8');
  assert.match(apiSrc, /error\?\.code === 'PGRST202'/);
  assert.match(apiSrc, /MIGRATION_REQUIRED/);
  assert.match(apiSrc, /007_v2_slice3_quotations\.sql/);
  assert.match(apiSrc, /Supabase SQL Editor/);
});

test('InvoiceDetailPage exposes a floating Print button using print-compact-80mm thermal layout', () => {
  const detailSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'v2', 'pages', 'InvoiceDetailPage.tsx'),
    'utf8'
  );
  assert.match(detailSrc, /thermalPrintMode/);
  assert.match(detailSrc, /<InvoiceDocument invoice=\{previewDoc\} thermalPrint=\{thermalPrintMode\} \/>/);
  assert.match(detailSrc, /aria-label="Print invoice \(80mm thermal layout\)"/);
  assert.match(detailSrc, /fixed bottom-24 md:bottom-6 right-4/);
  assert.match(detailSrc, /window\.print\(\)/);

  const docSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'v2', 'components', 'InvoiceDocument.tsx'),
    'utf8'
  );
  assert.match(docSrc, /thermalPrint\?: boolean/);
  assert.match(docSrc, /print-compact-80mm/);

  const cssSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8');
  assert.match(cssSrc, /@page thermal80mm/);
  assert.match(cssSrc, /\.invoice-print-sheet\.print-compact-80mm/);
});

