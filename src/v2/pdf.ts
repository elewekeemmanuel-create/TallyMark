import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import { formatKobo, formatLagosDateOnly, koboToWords } from '../shared/money';
import type { BusinessProfile } from '../shared/types';
import { formatQtyThousandths, formatTermsLabel } from '../shared/v2/money';
import type {
  InvoiceRecord,
  PaymentRecord,
  PublicInvoiceRecord,
  PublicQuoteRecord,
} from '../shared/v2/types';

interface LoadedFontBytes {
  sansRegular: ArrayBuffer;
  sansSemiBold: ArrayBuffer;
  monoRegular: ArrayBuffer;
  monoSemiBold: ArrayBuffer;
  serifRegular: ArrayBuffer;
}

let cachedFontBytes: LoadedFontBytes | null = null;

async function fetchFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load font: ${url}`);
  return res.arrayBuffer();
}

async function getFontBytes(): Promise<LoadedFontBytes> {
  if (cachedFontBytes) return cachedFontBytes;
  const [sansRegular, sansSemiBold, monoRegular, monoSemiBold, serifRegular] = await Promise.all([
    fetchFont('/fonts/IBMPlexSans-Regular.ttf'),
    fetchFont('/fonts/IBMPlexSans-SemiBold.ttf'),
    fetchFont('/fonts/IBMPlexMono-Regular.ttf'),
    fetchFont('/fonts/IBMPlexMono-SemiBold.ttf'),
    fetchFont('/fonts/InstrumentSerif-Regular.ttf'),
  ]);
  cachedFontBytes = { sansRegular, sansSemiBold, monoRegular, monoSemiBold, serifRegular };
  return cachedFontBytes;
}

type PdfDeps = {
  PDFDocument: typeof import('pdf-lib').PDFDocument;
  rgb: typeof import('pdf-lib').rgb;
  fontkit: Parameters<import('pdf-lib').PDFDocument['registerFontkit']>[0];
  QRCode: typeof import('qrcode');
};

let cachedPdfDeps: Promise<PdfDeps> | null = null;

function loadPdfDeps(): Promise<PdfDeps> {
  if (!cachedPdfDeps) {
    cachedPdfDeps = Promise.all([
      import('pdf-lib'),
      import('@pdf-lib/fontkit'),
      import('qrcode'),
    ]).then(([pdfLib, fk, qr]) => ({
      PDFDocument: pdfLib.PDFDocument,
      rgb: pdfLib.rgb,
      fontkit: (fk as any).default ?? fk,
      QRCode: (qr as any).default ?? qr,
    }));
  }
  return cachedPdfDeps;
}

function colorRgb(r: number, g: number, b: number): RGB {
  return { type: 'RGB' as any, red: r, green: g, blue: b };
}

function deg(angle: number) {
  return { type: 'degrees' as any, angle };
}

function hexToRgb(hex: string): RGB {
  const clean = (hex || '#064E3B').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return colorRgb(0.024, 0.306, 0.231);
  return colorRgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function safeText(text: string): string {
  return (text || '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = safeText(text);
  if (!clean) return [];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function pickFontForText(text: string, preferred: PDFFont, fallback: PDFFont): PDFFont {
  try {
    preferred.widthOfTextAtSize(text, 12);
    return preferred;
  } catch {
    return fallback;
  }
}

function getStampMeta(inv: PublicInvoiceRecord): { label: string; color: RGB } {
  if (inv.status === 'DRAFT') return { label: 'DRAFT', color: colorRgb(0.36, 0.39, 0.37) };
  if (inv.status === 'VOID') return { label: 'VOID', color: colorRgb(0.72, 0.11, 0.11) };
  if (inv.status === 'PAID') return { label: 'PAID', color: colorRgb(0.024, 0.306, 0.231) };
  if (inv.status === 'SETTLED') return { label: 'SETTLED', color: colorRgb(0.024, 0.306, 0.231) };
  if (inv.isOverdue) return { label: 'OVERDUE', color: colorRgb(0.72, 0.11, 0.11) };
  if (inv.status === 'PART_PAID') return { label: 'PART PAID', color: colorRgb(0.71, 0.33, 0.04) };
  return { label: 'UNPAID', color: colorRgb(0.36, 0.39, 0.37) };
}

export function buildPublicInvoicePreview(
  invoice: InvoiceRecord,
  business: BusinessProfile,
  payments: PaymentRecord[] = [],
  pendingClaimsCount = 0
): PublicInvoiceRecord {
  return {
    publicId: invoice.publicId,
    status: invoice.status,
    isOverdue: invoice.isOverdue,
    amountPaidKobo: invoice.amountPaidKobo,
    writtenOffKobo: invoice.writtenOffKobo,
    balanceDueKobo: invoice.balanceDueKobo,
    sentAt: invoice.sentAt,
    voidReason: invoice.voidReason,
    voidedAt: invoice.voidedAt,
    pendingClaimsCount,
    snapshot: invoice.snapshot || {
      invoiceNumber: invoice.invoiceNumber || 'DRAFT',
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
        name: invoice.customerName,
        address: invoice.customerAddress,
      },
      bankAccounts: (business.bankAccounts || []).filter(
        (b) => invoice.bankAccountIds.length === 0 || invoice.bankAccountIds.includes(b.id)
      ),
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      termsKind: invoice.termsKind,
      lines: invoice.lines,
      subtotalKobo: invoice.subtotalKobo,
      lineDiscountTotalKobo: invoice.lineDiscountTotalKobo,
      invoiceDiscountKobo: invoice.invoiceDiscountKobo,
      vatEnabled: invoice.vatEnabled,
      vatMode: invoice.vatMode,
      vatRateBps: invoice.vatRateBps,
      vatKobo: invoice.vatKobo,
      totalKobo: invoice.totalKobo,
      depositType: invoice.depositType,
      depositValue: invoice.depositValue,
      amountDueNowKobo: invoice.amountDueNowKobo,
      notes: invoice.notes,
      template: invoice.template,
      showBranding: true,
    },
    payments: payments
      .filter((p) => !p.isVoided)
      .map((p) => ({
        paymentDate: p.paymentDate,
        amountKobo: p.amountKobo,
        paymentMethod: p.paymentMethod,
        receiptNumber: p.receiptNumber || null,
        receiptPublicId: p.receiptPublicId || null,
      })),
  };
}

export function buildInvoicePdfFilename(invoice: PublicInvoiceRecord): string {
  const numPart = (invoice.snapshot.invoiceNumber || 'invoice')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const custPart = (invoice.snapshot.customer?.name || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const base = [numPart || 'invoice', custPart].filter(Boolean).join('-');
  return `${base}.pdf`;
}

function drawStamp(page: PDFPage, inv: PublicInvoiceRecord, x: number, y: number, font: PDFFont) {
  const { label, color } = getStampMeta(inv);
  const w = 104;
  const h = 34;
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: color,
    borderWidth: 2,
    rotate: deg(-6),
    opacity: 0.92,
  });
  page.drawRectangle({
    x: x + 3,
    y: y + 3,
    width: w - 6,
    height: h - 6,
    borderColor: color,
    borderWidth: 0.75,
    rotate: deg(-6),
    opacity: 0.75,
  });
  const textWidth = font.widthOfTextAtSize(label, 12);
  page.drawText(label, {
    x: x + (w - textWidth) / 2,
    y: y + 12,
    size: 12,
    font,
    color,
    rotate: deg(-6),
  });
}

async function embedLogo(pdfDoc: import('pdf-lib').PDFDocument, dataUrl: string | null) {
  if (!dataUrl) return null;
  try {
    const base64 = dataUrl.split(',')[1];
    if (!base64) return null;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    if (dataUrl.startsWith('data:image/png')) return await pdfDoc.embedPng(bytes);
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
      return await pdfDoc.embedJpg(bytes);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Generates a compact, true-vector A4 Invoice PDF (< 150 KB via font subsetting)
 * rendered strictly from the immutable invoice snapshot.
 */
export async function generateInvoicePdfBytes(
  invoice: PublicInvoiceRecord,
  originOverride?: string
): Promise<Uint8Array> {
  const snap = invoice.snapshot;
  const [{ PDFDocument, rgb, fontkit, QRCode }, fonts] = await Promise.all([
    loadPdfDeps(),
    getFontBytes(),
  ]);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Font subsetting keeps generated vector PDFs compact (< 150 KB) with selectable text & ₦
  const sans = await pdfDoc.embedFont(fonts.sansRegular, { subset: true });
  const sansBold = await pdfDoc.embedFont(fonts.sansSemiBold, { subset: true });
  const mono = await pdfDoc.embedFont(fonts.monoRegular, { subset: true });
  const monoBold = await pdfDoc.embedFont(fonts.monoSemiBold, { subset: true });
  const serif = await pdfDoc.embedFont(fonts.serifRegular, { subset: true });

  const origin =
    originOverride || (typeof window !== 'undefined' ? window.location.origin : 'https://tallymark.app');
  const publicUrl = `${origin}/i/${invoice.publicId}`;
  const qrDataUrl = await QRCode.toDataURL(publicUrl, {
    width: 160,
    margin: 1,
    color: { dark: '#121513', light: '#FFFDF9' },
  });
  const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const qrImage = await pdfDoc.embedPng(qrBytes);
  const logoImage = await embedLogo(pdfDoc, snap.business.logoDataUrl);

  const brandColor = hexToRgb(snap.business.brandColor || '#064E3B');
  const ink = rgb(0.07, 0.08, 0.075);
  const muted = rgb(0.36, 0.39, 0.37);
  const hairline = rgb(0.87, 0.84, 0.76);
  const paper = rgb(1, 0.992, 0.976);
  const cur = snap.business.currency || 'NGN';

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 42;
  const innerWidth = pageWidth - margin * 2;

  const createStyledPage = () => {
    const p = pdfDoc.addPage([pageWidth, pageHeight]);
    p.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: paper });
    p.drawRectangle({ x: 0, y: pageHeight - 8, width: pageWidth, height: 8, color: brandColor });
    return p;
  };

  let page = createStyledPage();

  let y = pageHeight - 44;

  // Header left: Business logo + name + address + TIN/RC
  let leftX = margin;
  if (logoImage) {
    const dims = logoImage.scaleToFit(44, 44);
    page.drawImage(logoImage, { x: margin, y: y - 28, width: dims.width, height: dims.height });
    leftX = margin + dims.width + 12;
  }

  const bizTitle = safeText(snap.business.name || 'Business');
  page.drawText(bizTitle, {
    x: leftX,
    y,
    size: 19,
    font: pickFontForText(bizTitle, serif, sansBold),
    color: ink,
  });

  let bizMetaY = y - 14;
  if (snap.business.address) {
    for (const line of wrapLines(snap.business.address, sans, 8.5, 250).slice(0, 2)) {
      page.drawText(line, { x: leftX, y: bizMetaY, size: 8.5, font: sans, color: muted });
      bizMetaY -= 11;
    }
  }
  const contactParts = [snap.business.phone, snap.business.email].filter(Boolean).join(' · ');
  if (contactParts) {
    page.drawText(safeText(contactParts), { x: leftX, y: bizMetaY, size: 8.5, font: sans, color: muted });
    bizMetaY -= 11;
  }
  if (snap.business.tinRc) {
    page.drawText(safeText(`TIN / RC: ${snap.business.tinRc}`), {
      x: leftX,
      y: bizMetaY,
      size: 8.5,
      font: mono,
      color: ink,
    });
    bizMetaY -= 11;
  }

  // Header right: INVOICE title + number + stamp
  const titleText = 'INVOICE';
  const titleW = monoBold.widthOfTextAtSize(titleText, 11);
  page.drawText(titleText, {
    x: pageWidth - margin - titleW,
    y: y + 4,
    size: 11,
    font: monoBold,
    color: brandColor,
  });
  const numText = safeText(snap.invoiceNumber);
  const numW = monoBold.widthOfTextAtSize(numText, 14);
  page.drawText(numText, {
    x: pageWidth - margin - numW,
    y: y - 14,
    size: 14,
    font: monoBold,
    color: ink,
  });

  drawStamp(page, invoice, pageWidth - margin - 106, y - 60, monoBold);

  y = Math.min(bizMetaY - 12, y - 74);
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.75,
    color: hairline,
  });
  y -= 18;

  // Bill To + Dates row (never includes customer phone or email!)
  page.drawText('BILL TO', { x: margin, y, size: 7.5, font: monoBold, color: muted });
  page.drawText(safeText(snap.customer.name), { x: margin, y: y - 14, size: 11, font: sansBold, color: ink });
  let custY = y - 27;
  if (snap.customer.address) {
    for (const line of wrapLines(snap.customer.address, sans, 8.5, 240).slice(0, 2)) {
      page.drawText(line, { x: margin, y: custY, size: 8.5, font: sans, color: muted });
      custY -= 11;
    }
  }

  const colR = pageWidth - margin - 185;
  const metaRows: Array<[string, string]> = [
    ['ISSUE DATE', safeText(formatLagosDateOnly(snap.issueDate))],
    ['DUE DATE', safeText(formatLagosDateOnly(snap.dueDate))],
    ['TERMS', safeText(formatTermsLabel(snap.termsKind, snap.dueDate) || String(snap.termsKind || ''))],
  ];
  let metaY = y;
  for (const [k, v] of metaRows) {
    page.drawText(k, { x: colR, y: metaY, size: 7.5, font: monoBold, color: muted });
    const vw = mono.widthOfTextAtSize(v, 8.5);
    page.drawText(v, { x: pageWidth - margin - vw, y: metaY, size: 8.5, font: mono, color: ink });
    metaY -= 14;
  }

  y = Math.min(custY - 12, metaY - 10);

  // Table header helper (also reused on continuation pages)
  const tableHeaderH = 22;
  const colDesc = margin + 8;
  const colQty = margin + innerWidth - 205;
  const colUnit = margin + innerWidth - 115;
  const colAmt = pageWidth - margin - 8;

  const drawItemsHeader = () => {
    page.drawRectangle({
      x: margin,
      y: y - tableHeaderH + 6,
      width: innerWidth,
      height: tableHeaderH,
      color: rgb(0.95, 0.935, 0.9),
    });
    page.drawText('DESCRIPTION', { x: colDesc, y: y - 8, size: 7.5, font: monoBold, color: muted });
    page.drawText('QTY', { x: colQty, y: y - 8, size: 7.5, font: monoBold, color: muted });
    page.drawText('UNIT PRICE', { x: colUnit - 36, y: y - 8, size: 7.5, font: monoBold, color: muted });
    const amtHeadW = monoBold.widthOfTextAtSize('AMOUNT', 7.5);
    page.drawText('AMOUNT', { x: colAmt - amtHeadW, y: y - 8, size: 7.5, font: monoBold, color: muted });
    y -= tableHeaderH + 8;
  };

  const ensureSpace = (neededHeight: number, repeatTableHeader = false) => {
    if (y - neededHeight >= 112) return;
    page = createStyledPage();
    y = pageHeight - 40;
    page.drawText(safeText(`${snap.business.name} · ${snap.invoiceNumber} (continued)`), {
      x: margin,
      y,
      size: 8,
      font: mono,
      color: muted,
    });
    y -= 20;
    if (repeatTableHeader) {
      drawItemsHeader();
    }
  };

  drawItemsHeader();

  // Line items
  for (const line of snap.lines) {
    const descLines = wrapLines(line.description, sansBold, 9, innerWidth - 230);
    const needed = Math.max(1, descLines.length) * 12 + (line.discountKobo > 0 ? 25 : 14);
    ensureSpace(needed, true);
    const qtyStr = formatQtyThousandths(line.qtyThousandths);
    const unitStr = formatKobo(line.unitPriceKobo, cur);
    const totalStr = formatKobo(line.lineTotalKobo, cur);

    for (let i = 0; i < Math.max(1, descLines.length); i++) {
      page.drawText(descLines[i] || '', {
        x: colDesc,
        y: y - i * 12,
        size: 9,
        font: sansBold,
        color: ink,
      });
    }
    page.drawText(qtyStr, { x: colQty, y, size: 8.5, font: mono, color: ink });
    const uw = mono.widthOfTextAtSize(unitStr, 8.5);
    page.drawText(unitStr, { x: colUnit + 22 - uw, y, size: 8.5, font: mono, color: ink });
    const tw = monoBold.widthOfTextAtSize(totalStr, 9);
    page.drawText(totalStr, { x: colAmt - tw, y, size: 9, font: monoBold, color: ink });

    y -= Math.max(1, descLines.length) * 12 + 4;
    if (line.discountKobo > 0) {
      page.drawText(`Line discount: -${formatKobo(line.discountKobo, cur)}`, {
        x: colDesc,
        y,
        size: 7.5,
        font: sans,
        color: muted,
      });
      y -= 11;
    }

    page.drawLine({
      start: { x: margin, y: y + 3 },
      end: { x: pageWidth - margin, y: y + 3 },
      thickness: 0.4,
      color: hairline,
    });
    y -= 10;
  }

  // Totals block (right aligned) — start new page if not enough room above footer
  ensureSpace(125, false);
  const totalsX = margin + innerWidth - 225;
  const drawTotalRow = (label: string, val: string, bold = false, accent = false) => {
    const f = bold ? sansBold : sans;
    const mf = bold ? monoBold : mono;
    const sz = bold ? 10 : 8.5;
    page.drawText(label, { x: totalsX, y, size: sz, font: f, color: accent ? brandColor : muted });
    const vw = mf.widthOfTextAtSize(val, sz);
    page.drawText(val, { x: colAmt - vw, y, size: sz, font: mf, color: accent ? brandColor : ink });
    y -= bold ? 17 : 14;
  };

  drawTotalRow('Subtotal', formatKobo(snap.subtotalKobo, cur));
  if (snap.lineDiscountTotalKobo > 0) {
    drawTotalRow('Line discounts', `-${formatKobo(snap.lineDiscountTotalKobo, cur)}`);
  }
  if (snap.invoiceDiscountKobo > 0) {
    drawTotalRow('Invoice discount', `-${formatKobo(snap.invoiceDiscountKobo, cur)}`);
  }
  if (snap.vatEnabled && snap.vatKobo > 0) {
    const rateLabel = (snap.vatRateBps / 100).toFixed(1).replace(/\.0$/, '');
    const vatLabel =
      snap.vatMode === 'inclusive' ? `VAT (${rateLabel}% incl.)` : `VAT (${rateLabel}%)`;
    drawTotalRow(vatLabel, formatKobo(snap.vatKobo, cur));
  }

  page.drawLine({
    start: { x: totalsX, y: y + 8 },
    end: { x: colAmt, y: y + 8 },
    thickness: 0.75,
    color: hairline,
  });
  y -= 4;

  drawTotalRow('Invoice Total', formatKobo(snap.totalKobo, cur), true, false);
  if (snap.depositType !== 'none' && snap.amountDueNowKobo < snap.totalKobo && invoice.amountPaidKobo === 0) {
    drawTotalRow('Amount due now', formatKobo(snap.amountDueNowKobo, cur), true, true);
  }
  if (invoice.amountPaidKobo > 0) {
    drawTotalRow('Amount paid', formatKobo(invoice.amountPaidKobo, cur));
  }
  if (invoice.writtenOffKobo > 0) {
    drawTotalRow('Written off', formatKobo(invoice.writtenOffKobo, cur));
  }
  drawTotalRow('Balance due', formatKobo(invoice.balanceDueKobo, cur), true, true);

  // Amount in words
  const words = wrapLines(`In words: ${koboToWords(snap.totalKobo, cur)}`, sans, 8, innerWidth);
  y -= 4;
  for (const wLine of words) {
    page.drawText(wLine, { x: margin, y, size: 8, font: sans, color: muted });
    y -= 11;
  }

  // Bank Details (from snapshot ONLY)
  if (snap.bankAccounts && snap.bankAccounts.length > 0 && y > 170) {
    y -= 10;
    page.drawText('PAYMENT DETAILS', { x: margin, y, size: 7.5, font: monoBold, color: brandColor });
    y -= 13;
    for (const bank of snap.bankAccounts.slice(0, 3)) {
      page.drawText(
        safeText(`${bank.bankName}  |  ${bank.accountNumber}  |  ${bank.accountName}`),
        { x: margin, y, size: 8.5, font: mono, color: ink }
      );
      y -= 13;
    }
  }

  // Payments Received Summary
  if (invoice.payments.length > 0 && y > 140) {
    y -= 8;
    page.drawText('PAYMENTS RECEIVED', { x: margin, y, size: 7.5, font: monoBold, color: muted });
    y -= 13;
    for (const p of invoice.payments.slice(0, 5)) {
      const line = `${formatLagosDateOnly(p.paymentDate)} · ${p.paymentMethod}${p.receiptNumber ? ` · ${p.receiptNumber}` : ''}`;
      page.drawText(safeText(line), { x: margin, y, size: 8, font: sans, color: ink });
      const amtStr = formatKobo(p.amountKobo, cur);
      const aw = mono.widthOfTextAtSize(amtStr, 8);
      page.drawText(amtStr, { x: margin + 260 - aw, y, size: 8, font: mono, color: ink });
      y -= 12;
    }
  }

  // Notes
  if (snap.notes && y > 115) {
    y -= 8;
    page.drawText('NOTES', { x: margin, y, size: 7.5, font: monoBold, color: muted });
    y -= 12;
    for (const nLine of wrapLines(snap.notes, sans, 8, innerWidth - 100).slice(0, 3)) {
      page.drawText(nLine, { x: margin, y, size: 8, font: sans, color: muted });
      y -= 11;
    }
  }

  // Footer: QR verification + optional "Made with Tallymark"
  const footerY = 44;
  page.drawLine({
    start: { x: margin, y: footerY + 56 },
    end: { x: pageWidth - margin, y: footerY + 56 },
    thickness: 0.6,
    color: hairline,
  });

  page.drawImage(qrImage, { x: pageWidth - margin - 48, y: footerY, width: 48, height: 48 });
  page.drawText('Scan to view live invoice status and receipts', {
    x: margin,
    y: footerY + 34,
    size: 8,
    font: sansBold,
    color: ink,
  });
  page.drawText(publicUrl, {
    x: margin,
    y: footerY + 21,
    size: 7.5,
    font: mono,
    color: muted,
  });
  if (snap.showBranding) {
    page.drawText('Made with Tallymark', {
      x: margin,
      y: footerY + 6,
      size: 7.5,
      font: sans,
      color: muted,
    });
  }

  return pdfDoc.save();
}

export async function downloadInvoicePdf(invoice: PublicInvoiceRecord) {
  const bytes = await generateInvoicePdfBytes(invoice);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildInvoicePdfFilename(invoice);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function getQuoteStampMeta(quote: PublicQuoteRecord): { label: string; color: RGB } {
  if (quote.status === 'VOID') return { label: 'VOID', color: colorRgb(0.72, 0.11, 0.11) };
  if (quote.status === 'ACCEPTED') return { label: 'ACCEPTED', color: colorRgb(0.024, 0.306, 0.231) };
  if (quote.status === 'CONVERTED') return { label: 'CONVERTED', color: colorRgb(0.024, 0.306, 0.231) };
  if (quote.status === 'DECLINED') return { label: 'DECLINED', color: colorRgb(0.72, 0.11, 0.11) };
  if (quote.isExpired) return { label: 'EXPIRED', color: colorRgb(0.71, 0.33, 0.04) };
  return { label: 'QUOTATION', color: colorRgb(0.36, 0.39, 0.37) };
}

function drawQuoteStamp(page: PDFPage, quote: PublicQuoteRecord, x: number, y: number, font: PDFFont) {
  const { label, color } = getQuoteStampMeta(quote);
  const w = 110;
  const h = 34;
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: color,
    borderWidth: 2,
    rotate: deg(-6),
    opacity: 0.92,
  });
  page.drawRectangle({
    x: x + 3,
    y: y + 3,
    width: w - 6,
    height: h - 6,
    borderColor: color,
    borderWidth: 0.75,
    rotate: deg(-6),
    opacity: 0.75,
  });
  const textWidth = font.widthOfTextAtSize(label, 11.5);
  page.drawText(label, {
    x: x + (w - textWidth) / 2,
    y: y + 12,
    size: 11.5,
    font,
    color,
    rotate: deg(-6),
  });
}

/**
 * Generates a compact, true-vector A4 Quotation PDF (< 150 KB via font subsetting)
 * rendered strictly from the immutable quote snapshot.
 */
export async function generateQuotePdfBytes(
  quote: PublicQuoteRecord,
  originOverride?: string
): Promise<Uint8Array> {
  const snap = quote.snapshot;
  const [{ PDFDocument, rgb, fontkit, QRCode }, fonts] = await Promise.all([
    loadPdfDeps(),
    getFontBytes(),
  ]);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const sans = await pdfDoc.embedFont(fonts.sansRegular, { subset: true });
  const sansBold = await pdfDoc.embedFont(fonts.sansSemiBold, { subset: true });
  const mono = await pdfDoc.embedFont(fonts.monoRegular, { subset: true });
  const monoBold = await pdfDoc.embedFont(fonts.monoSemiBold, { subset: true });
  const serif = await pdfDoc.embedFont(fonts.serifRegular, { subset: true });

  const origin =
    originOverride || (typeof window !== 'undefined' ? window.location.origin : 'https://tallymark.app');
  const publicUrl = `${origin}/q/${quote.publicId}`;
  const qrDataUrl = await QRCode.toDataURL(publicUrl, {
    width: 160,
    margin: 1,
    color: { dark: '#121513', light: '#FFFDF9' },
  });
  const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const qrImage = await pdfDoc.embedPng(qrBytes);
  const logoImage = await embedLogo(pdfDoc, snap.business.logoDataUrl);

  const brandColor = hexToRgb(snap.business.brandColor || '#064E3B');
  const ink = rgb(0.07, 0.08, 0.075);
  const muted = rgb(0.36, 0.39, 0.37);
  const hairline = rgb(0.87, 0.84, 0.76);
  const paper = rgb(1, 0.992, 0.976);
  const cur = snap.business.currency || 'NGN';

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const innerWidth = pageWidth - margin * 2;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: paper });
  page.drawRectangle({ x: 0, y: pageHeight - 8, width: pageWidth, height: 8, color: brandColor });

  let y = pageHeight - 44;

  // Header left: business identity
  let leftX = margin;
  if (logoImage) {
    const dims = logoImage.scaleToFit(44, 44);
    page.drawImage(logoImage, { x: margin, y: y - 28, width: dims.width, height: dims.height });
    leftX = margin + dims.width + 12;
  }

  page.drawText(safeText(snap.business.name), {
    x: leftX,
    y,
    size: 19,
    font: serif,
    color: ink,
  });

  let bizMetaY = y - 14;
  if (snap.business.address) {
    for (const line of wrapLines(snap.business.address, sans, 8.5, 250).slice(0, 2)) {
      page.drawText(line, { x: leftX, y: bizMetaY, size: 8.5, font: sans, color: muted });
      bizMetaY -= 11;
    }
  }
  const contactParts = [snap.business.phone, snap.business.email].filter(Boolean).join(' · ');
  if (contactParts) {
    page.drawText(safeText(contactParts), { x: leftX, y: bizMetaY, size: 8.5, font: sans, color: muted });
    bizMetaY -= 11;
  }
  if (snap.business.tinRc) {
    page.drawText(safeText(`TIN / RC: ${snap.business.tinRc}`), {
      x: leftX,
      y: bizMetaY,
      size: 8.5,
      font: mono,
      color: ink,
    });
    bizMetaY -= 11;
  }

  // Header right: QUOTATION + number + stamp
  const titleText = 'QUOTATION';
  const titleW = monoBold.widthOfTextAtSize(titleText, 11);
  page.drawText(titleText, {
    x: pageWidth - margin - titleW,
    y: y + 4,
    size: 11,
    font: monoBold,
    color: brandColor,
  });
  const numText = safeText(snap.quoteNumber);
  const numW = monoBold.widthOfTextAtSize(numText, 14);
  page.drawText(numText, {
    x: pageWidth - margin - numW,
    y: y - 14,
    size: 14,
    font: monoBold,
    color: ink,
  });

  drawQuoteStamp(page, quote, pageWidth - margin - 112, y - 60, monoBold);

  y = Math.min(bizMetaY - 12, y - 74);
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.75,
    color: hairline,
  });
  y -= 18;

  // Prepared For (NEVER includes customer phone or email) + Dates
  page.drawText('PREPARED FOR', { x: margin, y, size: 7.5, font: monoBold, color: muted });
  page.drawText(safeText(snap.customer.name), { x: margin, y: y - 14, size: 11, font: sansBold, color: ink });
  let custY = y - 27;
  if (snap.customer.address) {
    for (const line of wrapLines(snap.customer.address, sans, 8.5, 240).slice(0, 2)) {
      page.drawText(line, { x: margin, y: custY, size: 8.5, font: sans, color: muted });
      custY -= 11;
    }
  }

  const colR = pageWidth - margin - 185;
  const metaRows: Array<[string, string]> = [
    ['ISSUE DATE', safeText(formatLagosDateOnly(snap.issueDate))],
    ['VALID UNTIL', safeText(formatLagosDateOnly(snap.validUntil))],
    ['TERMS', safeText(formatTermsLabel(snap.termsKind) || String(snap.termsKind || ''))],
  ];
  let metaY = y;
  for (const [k, v] of metaRows) {
    page.drawText(k, { x: colR, y: metaY, size: 7.5, font: monoBold, color: muted });
    const vw = mono.widthOfTextAtSize(v, 8.5);
    page.drawText(v, { x: pageWidth - margin - vw, y: metaY, size: 8.5, font: mono, color: ink });
    metaY -= 14;
  }

  y = Math.min(custY - 12, metaY - 10);

  // Table header
  const tableHeaderH = 22;
  page.drawRectangle({
    x: margin,
    y: y - tableHeaderH + 6,
    width: innerWidth,
    height: tableHeaderH,
    color: rgb(0.95, 0.935, 0.9),
  });
  const colDesc = margin + 8;
  const colQty = margin + innerWidth - 205;
  const colUnit = margin + innerWidth - 115;
  const colAmt = pageWidth - margin - 8;

  page.drawText('DESCRIPTION', { x: colDesc, y: y - 8, size: 7.5, font: monoBold, color: muted });
  page.drawText('QTY', { x: colQty, y: y - 8, size: 7.5, font: monoBold, color: muted });
  page.drawText('UNIT PRICE', { x: colUnit - 36, y: y - 8, size: 7.5, font: monoBold, color: muted });
  const amtHeadW = monoBold.widthOfTextAtSize('AMOUNT', 7.5);
  page.drawText('AMOUNT', { x: colAmt - amtHeadW, y: y - 8, size: 7.5, font: monoBold, color: muted });

  y -= tableHeaderH + 8;

  // Line items
  for (const line of snap.lines) {
    const descLines = wrapLines(line.description, sansBold, 9, innerWidth - 230);
    const qtyStr = formatQtyThousandths(line.qtyThousandths);
    const unitStr = formatKobo(line.unitPriceKobo, cur);
    const totalStr = formatKobo(line.lineTotalKobo, cur);

    for (let i = 0; i < Math.max(1, descLines.length); i++) {
      page.drawText(descLines[i] || '', {
        x: colDesc,
        y: y - i * 12,
        size: 9,
        font: sansBold,
        color: ink,
      });
    }
    page.drawText(qtyStr, { x: colQty, y, size: 8.5, font: mono, color: ink });
    const uw = mono.widthOfTextAtSize(unitStr, 8.5);
    page.drawText(unitStr, { x: colUnit + 22 - uw, y, size: 8.5, font: mono, color: ink });
    const tw = monoBold.widthOfTextAtSize(totalStr, 9);
    page.drawText(totalStr, { x: colAmt - tw, y, size: 9, font: monoBold, color: ink });

    y -= Math.max(1, descLines.length) * 12 + 4;
    if (line.discountKobo > 0) {
      page.drawText(`Line discount: -${formatKobo(line.discountKobo, cur)}`, {
        x: colDesc,
        y,
        size: 7.5,
        font: sans,
        color: muted,
      });
      y -= 11;
    }

    page.drawLine({
      start: { x: margin, y: y + 3 },
      end: { x: pageWidth - margin, y: y + 3 },
      thickness: 0.4,
      color: hairline,
    });
    y -= 10;
  }

  // Totals block
  const totalsX = margin + innerWidth - 225;
  const drawTotalRow = (label: string, val: string, bold = false, accent = false) => {
    const f = bold ? sansBold : sans;
    const mf = bold ? monoBold : mono;
    const sz = bold ? 10 : 8.5;
    page.drawText(label, { x: totalsX, y, size: sz, font: f, color: accent ? brandColor : muted });
    const vw = mf.widthOfTextAtSize(val, sz);
    page.drawText(val, { x: colAmt - vw, y, size: sz, font: mf, color: accent ? brandColor : ink });
    y -= bold ? 17 : 14;
  };

  drawTotalRow('Subtotal', formatKobo(snap.subtotalKobo, cur));
  if (snap.lineDiscountTotalKobo > 0) {
    drawTotalRow('Line discounts', `-${formatKobo(snap.lineDiscountTotalKobo, cur)}`);
  }
  if (snap.invoiceDiscountKobo > 0) {
    drawTotalRow('Quote discount', `-${formatKobo(snap.invoiceDiscountKobo, cur)}`);
  }
  if (snap.vatEnabled && snap.vatKobo > 0) {
    const rateLabel = (snap.vatRateBps / 100).toFixed(1).replace(/\.0$/, '');
    const vatLabel =
      snap.vatMode === 'inclusive' ? `VAT (${rateLabel}% incl.)` : `VAT (${rateLabel}%)`;
    drawTotalRow(vatLabel, formatKobo(snap.vatKobo, cur));
  }

  page.drawLine({
    start: { x: totalsX, y: y + 8 },
    end: { x: colAmt, y: y + 8 },
    thickness: 0.75,
    color: hairline,
  });
  y -= 4;

  drawTotalRow('Quote Total', formatKobo(snap.totalKobo, cur), true, true);
  if (snap.depositType !== 'none' && snap.amountDueNowKobo < snap.totalKobo) {
    drawTotalRow('Deposit if accepted', formatKobo(snap.amountDueNowKobo, cur), true, false);
  }

  const words = wrapLines(`In words: ${koboToWords(snap.totalKobo, cur)}`, sans, 8, innerWidth);
  y -= 4;
  for (const wLine of words) {
    page.drawText(wLine, { x: margin, y, size: 8, font: sans, color: muted });
    y -= 11;
  }

  if (snap.notes && y > 135) {
    y -= 8;
    page.drawText('NOTES & TERMS', { x: margin, y, size: 7.5, font: monoBold, color: muted });
    y -= 12;
    for (const nLine of wrapLines(snap.notes, sans, 8, innerWidth - 100).slice(0, 3)) {
      page.drawText(nLine, { x: margin, y, size: 8, font: sans, color: muted });
      y -= 11;
    }
  }

  // Footer with QR verification
  const footerY = 44;
  page.drawLine({
    start: { x: margin, y: footerY + 56 },
    end: { x: pageWidth - margin, y: footerY + 56 },
    thickness: 0.6,
    color: hairline,
  });

  page.drawImage(qrImage, { x: pageWidth - margin - 48, y: footerY, width: 48, height: 48 });
  page.drawText('Scan to view live quote status or respond online', {
    x: margin,
    y: footerY + 34,
    size: 8,
    font: sansBold,
    color: ink,
  });
  page.drawText(publicUrl, {
    x: margin,
    y: footerY + 21,
    size: 7.5,
    font: mono,
    color: muted,
  });
  if (snap.showBranding) {
    page.drawText('Made with Tallymark', {
      x: margin,
      y: footerY + 6,
      size: 7.5,
      font: sans,
      color: muted,
    });
  }

  return pdfDoc.save();
}

export async function downloadQuotePdf(quote: PublicQuoteRecord) {
  const bytes = await generateQuotePdfBytes(quote);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(quote.snapshot.quoteNumber || 'quote').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
