import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import { formatKobo, formatLagosDateOnly, koboToWords } from '../shared/money';
import type { BusinessProfile } from '../shared/types';
import { formatQtyThousandths, formatTermsLabel } from '../shared/v2/money';
import type {
  CustomerStatementRecord,
  InvoiceRecord,
  PaymentRecord,
  PublicInvoiceRecord,
  PublicQuoteRecord,
  QuoteRecord,
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
 * Dynamically adapts vertical density and uses a 2-column bottom summary layout
 * so real-world invoices fit crisply onto 1 single A4 page without dropping data.
 */
export async function generateInvoicePdfBytes(
  invoice: PublicInvoiceRecord,
  originOverride?: string,
  fontBytesOverride?: LoadedFontBytes
): Promise<Uint8Array> {
  const snap = invoice.snapshot;
  const [{ PDFDocument, rgb, fontkit, QRCode }, fonts] = await Promise.all([
    loadPdfDeps(),
    fontBytesOverride ? Promise.resolve(fontBytesOverride) : getFontBytes(),
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
    width: 144,
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

  interface LayoutDensity {
    margin: number;
    accentH: number;
    topPad: number;
    logoMax: number;
    bizTitleSz: number;
    bizMetaSz: number;
    bizMetaLead: number;
    invNumSz: number;
    stampW: number;
    stampH: number;
    stampFontSz: number;
    sectionGap: number;
    billTitleSz: number;
    billTextSz: number;
    billLead: number;
    tableHeadH: number;
    descSz: number;
    numSz: number;
    descLead: number;
    rowPadTop: number;
    rowPadBottom: number;
    discSz: number;
    discLead: number;
    totalsSz: number;
    totalsBoldSz: number;
    totalsLead: number;
    totalsBoldLead: number;
    sideSz: number;
    sideLead: number;
    qrSize: number;
    footerBottom: number;
    footerGap: number;
  }

  const TIERS: LayoutDensity[] = [
    // Tier 0: Crisp compact A4 (fits ~1–14 items + full metadata on 1 page)
    {
      margin: 34,
      accentH: 6,
      topPad: 28,
      logoMax: 36,
      bizTitleSz: 16.5,
      bizMetaSz: 8,
      bizMetaLead: 10,
      invNumSz: 12.5,
      stampW: 92,
      stampH: 28,
      stampFontSz: 10.5,
      sectionGap: 11,
      billTitleSz: 10,
      billTextSz: 8,
      billLead: 10.5,
      tableHeadH: 19,
      descSz: 8.5,
      numSz: 8.2,
      descLead: 10.5,
      rowPadTop: 4.5,
      rowPadBottom: 5.5,
      discSz: 7.2,
      discLead: 9.5,
      totalsSz: 8.2,
      totalsBoldSz: 9.5,
      totalsLead: 12.5,
      totalsBoldLead: 14.5,
      sideSz: 7.8,
      sideLead: 10,
      qrSize: 40,
      footerBottom: 24,
      footerGap: 12,
    },
    // Tier 1: Tight single-page A4 (fits ~15–25 items on 1 page)
    {
      margin: 26,
      accentH: 5,
      topPad: 22,
      logoMax: 30,
      bizTitleSz: 14.5,
      bizMetaSz: 7.5,
      bizMetaLead: 9,
      invNumSz: 11.5,
      stampW: 84,
      stampH: 24,
      stampFontSz: 9.5,
      sectionGap: 8,
      billTitleSz: 9.2,
      billTextSz: 7.5,
      billLead: 9.2,
      tableHeadH: 16.5,
      descSz: 7.8,
      numSz: 7.6,
      descLead: 9.2,
      rowPadTop: 2.8,
      rowPadBottom: 3.4,
      discSz: 6.8,
      discLead: 8.2,
      totalsSz: 7.6,
      totalsBoldSz: 8.8,
      totalsLead: 10.8,
      totalsBoldLead: 12.5,
      sideSz: 7.2,
      sideLead: 8.8,
      qrSize: 36,
      footerBottom: 20,
      footerGap: 8,
    },
    // Tier 2: Ultra-compact single-page A4 (fits ~26–36 items on 1 page)
    {
      margin: 22,
      accentH: 4,
      topPad: 18,
      logoMax: 26,
      bizTitleSz: 13,
      bizMetaSz: 7,
      bizMetaLead: 8.2,
      invNumSz: 10.5,
      stampW: 76,
      stampH: 21,
      stampFontSz: 8.5,
      sectionGap: 6,
      billTitleSz: 8.5,
      billTextSz: 7,
      billLead: 8.4,
      tableHeadH: 14.5,
      descSz: 7.2,
      numSz: 7,
      descLead: 8.2,
      rowPadTop: 1.8,
      rowPadBottom: 2.2,
      discSz: 6.4,
      discLead: 7.4,
      totalsSz: 7.2,
      totalsBoldSz: 8.2,
      totalsLead: 9.6,
      totalsBoldLead: 11,
      sideSz: 6.8,
      sideLead: 8,
      qrSize: 32,
      footerBottom: 16,
      footerGap: 6,
    },
  ];

  // Pre-compute totals rows so both height estimator and renderer stay 1:1
  type TotalRowDef = { label: string; val: string; bold?: boolean; accent?: boolean; dividerBefore?: boolean };
  const totalRows: TotalRowDef[] = [{ label: 'Subtotal', val: formatKobo(snap.subtotalKobo, cur) }];
  if (snap.lineDiscountTotalKobo > 0) {
    totalRows.push({ label: 'Line discounts', val: `-${formatKobo(snap.lineDiscountTotalKobo, cur)}` });
  }
  if (snap.invoiceDiscountKobo > 0) {
    totalRows.push({ label: 'Invoice discount', val: `-${formatKobo(snap.invoiceDiscountKobo, cur)}` });
  }
  if (snap.vatEnabled && snap.vatKobo > 0) {
    const rateLabel = (snap.vatRateBps / 100).toFixed(1).replace(/\.0$/, '');
    const vatLabel =
      snap.vatMode === 'inclusive' ? `VAT (${rateLabel}% incl.)` : `VAT (${rateLabel}%)`;
    totalRows.push({ label: vatLabel, val: formatKobo(snap.vatKobo, cur) });
  }
  totalRows.push({
    label: 'Invoice Total',
    val: formatKobo(snap.totalKobo, cur),
    bold: true,
    dividerBefore: true,
  });
  if (snap.depositType !== 'none' && snap.amountDueNowKobo < snap.totalKobo && invoice.amountPaidKobo === 0) {
    totalRows.push({
      label: 'Amount due now',
      val: formatKobo(snap.amountDueNowKobo, cur),
      bold: true,
      accent: true,
    });
  }
  if (invoice.amountPaidKobo > 0) {
    totalRows.push({ label: 'Amount paid', val: formatKobo(invoice.amountPaidKobo, cur) });
  }
  if (invoice.writtenOffKobo > 0) {
    totalRows.push({ label: 'Written off', val: formatKobo(invoice.writtenOffKobo, cur) });
  }
  totalRows.push({
    label: 'Balance due',
    val: formatKobo(invoice.balanceDueKobo, cur),
    bold: true,
    accent: true,
  });

  const estimateSinglePageHeight = (d: LayoutDensity): number => {
    const innerW = pageWidth - d.margin * 2;
    const descW = innerW - 215;
    const leftColW = innerW - 228;

    // Header height
    let bizLines = 1; // title
    if (snap.business.address) {
      bizLines += wrapLines(snap.business.address, sans, d.bizMetaSz, 260).slice(0, 2).length;
    }
    if (snap.business.phone || snap.business.email) bizLines += 1;
    if (snap.business.tinRc) bizLines += 1;
    const headerH = Math.max(d.stampH + 34, 18 + (bizLines - 1) * d.bizMetaLead) + d.sectionGap;

    // Bill To + Dates height
    const custAddrLines = snap.customer.address
      ? wrapLines(snap.customer.address, sans, d.billTextSz, 240).slice(0, 2).length
      : 0;
    const billH = Math.max(3 * d.billLead + 4, 22 + custAddrLines * d.billLead) + d.sectionGap;

    // Items table height
    let itemsH = d.tableHeadH + 4;
    for (const line of snap.lines) {
      const descLines = Math.max(1, wrapLines(line.description, sansBold, d.descSz, descW).length);
      itemsH +=
        d.rowPadTop +
        descLines * d.descLead +
        (line.discountKobo > 0 ? d.discLead : 0) +
        d.rowPadBottom;
    }

    // Bottom 2-column summary height (max of left column & right totals)
    let rightH = 6;
    for (const r of totalRows) {
      if (r.dividerBefore) rightH += 4;
      rightH += r.bold ? d.totalsBoldLead : d.totalsLead;
    }

    let leftH = 6;
    const wordLines = wrapLines(`In words: ${koboToWords(snap.totalKobo, cur)}`, sans, d.sideSz, leftColW);
    leftH += wordLines.length * d.sideLead + 6;
    if (snap.bankAccounts && snap.bankAccounts.length > 0 && invoice.status !== 'VOID') {
      leftH += d.sideLead + 3 + Math.min(3, snap.bankAccounts.length) * (d.sideLead + 1.5) + 6;
    }
    if (invoice.payments.length > 0) {
      leftH += d.sideLead + 3 + Math.min(5, invoice.payments.length) * (d.sideLead + 1) + 6;
    }
    if (snap.notes) {
      const noteLines = wrapLines(snap.notes, sans, d.sideSz, leftColW).slice(0, 4);
      leftH += d.sideLead + 3 + noteLines.length * d.sideLead + 6;
    }
    if (invoice.status === 'VOID' && invoice.voidReason) {
      const voidLines = wrapLines(`Voided: ${invoice.voidReason}`, sans, d.sideSz, leftColW).slice(0, 2);
      leftH += voidLines.length * d.sideLead + 4;
    }

    const summaryH = Math.max(rightH, leftH) + d.sectionGap;
    const footerReserve = d.footerBottom + d.qrSize + 10 + d.footerGap;

    return d.topPad + headerH + billH + itemsH + summaryH + footerReserve;
  };

  // Pick the most readable density tier that fits on 1 single A4 page
  let d = TIERS[TIERS.length - 1];
  for (const tier of TIERS) {
    if (estimateSinglePageHeight(tier) <= pageHeight) {
      d = tier;
      break;
    }
  }

  const margin = d.margin;
  const innerWidth = pageWidth - margin * 2;
  const footerTopY = d.footerBottom + d.qrSize + 8;
  const minContentY = footerTopY + d.footerGap;

  const createStyledPage = () => {
    const p = pdfDoc.addPage([pageWidth, pageHeight]);
    p.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: paper });
    p.drawRectangle({ x: 0, y: pageHeight - d.accentH, width: pageWidth, height: d.accentH, color: brandColor });
    return p;
  };

  let page = createStyledPage();
  let y = pageHeight - d.topPad;

  // Compact stamp helper scaled to active density tier
  const drawCompactStamp = (targetPage: PDFPage, x: number, sy: number) => {
    const { label, color } = getStampMeta(invoice);
    targetPage.drawRectangle({
      x,
      y: sy,
      width: d.stampW,
      height: d.stampH,
      borderColor: color,
      borderWidth: 1.8,
      rotate: deg(-5),
      opacity: 0.92,
    });
    targetPage.drawRectangle({
      x: x + 2.5,
      y: sy + 2.5,
      width: d.stampW - 5,
      height: d.stampH - 5,
      borderColor: color,
      borderWidth: 0.65,
      rotate: deg(-5),
      opacity: 0.75,
    });
    const textWidth = monoBold.widthOfTextAtSize(label, d.stampFontSz);
    targetPage.drawText(label, {
      x: x + (d.stampW - textWidth) / 2,
      y: sy + (d.stampH - d.stampFontSz) / 2 + 1.5,
      size: d.stampFontSz,
      font: monoBold,
      color,
      rotate: deg(-5),
    });
  };

  // Header left: Business logo + name + address + TIN/RC
  let leftX = margin;
  if (logoImage) {
    const dims = logoImage.scaleToFit(d.logoMax, d.logoMax);
    page.drawImage(logoImage, { x: margin, y: y - dims.height + 10, width: dims.width, height: dims.height });
    leftX = margin + dims.width + 10;
  }

  const bizTitle = safeText(snap.business.name || 'Business');
  page.drawText(bizTitle, {
    x: leftX,
    y,
    size: d.bizTitleSz,
    font: pickFontForText(bizTitle, serif, sansBold),
    color: ink,
  });

  let bizMetaY = y - (d.bizMetaLead + 2);
  if (snap.business.address) {
    for (const line of wrapLines(snap.business.address, sans, d.bizMetaSz, 265).slice(0, 2)) {
      page.drawText(line, { x: leftX, y: bizMetaY, size: d.bizMetaSz, font: sans, color: muted });
      bizMetaY -= d.bizMetaLead;
    }
  }
  const contactParts = [snap.business.phone, snap.business.email].filter(Boolean).join(' · ');
  if (contactParts) {
    page.drawText(safeText(contactParts), { x: leftX, y: bizMetaY, size: d.bizMetaSz, font: sans, color: muted });
    bizMetaY -= d.bizMetaLead;
  }
  if (snap.business.tinRc) {
    page.drawText(safeText(`TIN / RC: ${snap.business.tinRc}`), {
      x: leftX,
      y: bizMetaY,
      size: d.bizMetaSz,
      font: mono,
      color: ink,
    });
    bizMetaY -= d.bizMetaLead;
  }

  // Header right: INVOICE title + number + stamp
  const titleText = 'INVOICE';
  const titleSz = Math.max(8.5, d.invNumSz - 2.5);
  const titleW = monoBold.widthOfTextAtSize(titleText, titleSz);
  page.drawText(titleText, {
    x: pageWidth - margin - titleW,
    y: y + 3,
    size: titleSz,
    font: monoBold,
    color: brandColor,
  });
  const numText = safeText(snap.invoiceNumber);
  const numW = monoBold.widthOfTextAtSize(numText, d.invNumSz);
  page.drawText(numText, {
    x: pageWidth - margin - numW,
    y: y - (d.invNumSz + 1),
    size: d.invNumSz,
    font: monoBold,
    color: ink,
  });

  const stampBottomY = y - (d.invNumSz + d.stampH + 10);
  drawCompactStamp(page, pageWidth - margin - d.stampW - 2, stampBottomY);

  y = Math.min(bizMetaY - 4, stampBottomY - 6);
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.7,
    color: hairline,
  });
  y -= d.sectionGap + 2;

  // Bill To + Dates row (never includes customer phone or email)
  page.drawText('BILL TO', { x: margin, y, size: 7, font: monoBold, color: muted });
  page.drawText(safeText(snap.customer.name), {
    x: margin,
    y: y - (d.billLead + 1),
    size: d.billTitleSz,
    font: sansBold,
    color: ink,
  });
  let custY = y - (d.billLead * 2 + 2);
  if (snap.customer.address) {
    for (const line of wrapLines(snap.customer.address, sans, d.billTextSz, 240).slice(0, 2)) {
      page.drawText(line, { x: margin, y: custY, size: d.billTextSz, font: sans, color: muted });
      custY -= d.billLead;
    }
  }

  const colR = pageWidth - margin - 180;
  const metaRows: Array<[string, string]> = [
    ['ISSUE DATE', safeText(formatLagosDateOnly(snap.issueDate))],
    ['DUE DATE', safeText(formatLagosDateOnly(snap.dueDate))],
    ['TERMS', safeText(formatTermsLabel(snap.termsKind, snap.dueDate) || String(snap.termsKind || ''))],
  ];
  let metaY = y;
  for (const [k, v] of metaRows) {
    page.drawText(k, { x: colR, y: metaY, size: 7, font: monoBold, color: muted });
    const vw = mono.widthOfTextAtSize(v, d.billTextSz);
    page.drawText(v, { x: pageWidth - margin - vw, y: metaY, size: d.billTextSz, font: mono, color: ink });
    metaY -= d.billLead + 1.5;
  }

  y = Math.min(custY - 4, metaY - 2) - Math.max(2, d.sectionGap - 6);

  // Table columns
  const colDesc = margin + 6;
  const colQty = margin + innerWidth - 195;
  const colUnit = margin + innerWidth - 110;
  const colAmt = pageWidth - margin - 6;

  const drawItemsHeader = () => {
    page.drawRectangle({
      x: margin,
      y: y - d.tableHeadH + 5,
      width: innerWidth,
      height: d.tableHeadH,
      color: rgb(0.95, 0.935, 0.9),
    });
    const headTextY = y - d.tableHeadH + 5 + (d.tableHeadH - 7) / 2;
    page.drawText('DESCRIPTION', { x: colDesc, y: headTextY, size: 7, font: monoBold, color: muted });
    page.drawText('QTY', { x: colQty, y: headTextY, size: 7, font: monoBold, color: muted });
    page.drawText('UNIT PRICE', { x: colUnit - 34, y: headTextY, size: 7, font: monoBold, color: muted });
    const amtHeadW = monoBold.widthOfTextAtSize('AMOUNT', 7);
    page.drawText('AMOUNT', { x: colAmt - amtHeadW, y: headTextY, size: 7, font: monoBold, color: muted });
    y -= d.tableHeadH + 3;
  };

  const ensureSpace = (neededHeight: number, repeatTableHeader = false) => {
    if (y - neededHeight >= minContentY) return;
    page = createStyledPage();
    y = pageHeight - d.topPad;
    page.drawText(safeText(`${snap.business.name} · ${snap.invoiceNumber} (continued)`), {
      x: margin,
      y,
      size: 7.5,
      font: mono,
      color: muted,
    });
    y -= 16;
    if (repeatTableHeader) {
      drawItemsHeader();
    }
  };

  drawItemsHeader();

  // Line items
  for (const line of snap.lines) {
    const descLines = wrapLines(line.description, sansBold, d.descSz, innerWidth - 215);
    const lineCount = Math.max(1, descLines.length);
    const needed = d.rowPadTop + lineCount * d.descLead + (line.discountKobo > 0 ? d.discLead : 0) + d.rowPadBottom;
    ensureSpace(needed, true);

    y -= d.rowPadTop;
    const qtyStr = formatQtyThousandths(line.qtyThousandths);
    const unitStr = formatKobo(line.unitPriceKobo, cur);
    const totalStr = formatKobo(line.lineTotalKobo, cur);

    for (let i = 0; i < lineCount; i++) {
      page.drawText(descLines[i] || '', {
        x: colDesc,
        y: y - i * d.descLead,
        size: d.descSz,
        font: sansBold,
        color: ink,
      });
    }
    page.drawText(qtyStr, { x: colQty, y, size: d.numSz, font: mono, color: ink });
    const uw = mono.widthOfTextAtSize(unitStr, d.numSz);
    page.drawText(unitStr, { x: colUnit + 20 - uw, y, size: d.numSz, font: mono, color: ink });
    const tw = monoBold.widthOfTextAtSize(totalStr, d.descSz);
    page.drawText(totalStr, { x: colAmt - tw, y, size: d.descSz, font: monoBold, color: ink });

    y -= lineCount * d.descLead;
    if (line.discountKobo > 0) {
      page.drawText(`Line discount: -${formatKobo(line.discountKobo, cur)}`, {
        x: colDesc,
        y,
        size: d.discSz,
        font: sans,
        color: muted,
      });
      y -= d.discLead;
    }

    const lineY = y + Math.max(2, d.rowPadBottom * 0.5);
    page.drawLine({
      start: { x: margin, y: lineY },
      end: { x: pageWidth - margin, y: lineY },
      thickness: 0.35,
      color: hairline,
    });
    y -= d.rowPadBottom;
  }

  // Bottom 2-column summary zone:
  // Left column: Amount in words, Payment Details (bank accounts), Payments Received, Notes, Void reason
  // Right column: Totals summary
  const leftColW = innerWidth - 228;
  const totalsX = margin + innerWidth - 214;

  // Measure both columns accurately so ensureSpace never truncates or drops any inputted data
  const wordLines = wrapLines(`In words: ${koboToWords(snap.totalKobo, cur)}`, sans, d.sideSz, leftColW);
  const banksToDraw = invoice.status !== 'VOID' ? (snap.bankAccounts || []).slice(0, 3) : [];
  const paymentsToDraw = invoice.payments.slice(0, 5);
  const noteLines = snap.notes ? wrapLines(snap.notes, sans, d.sideSz, leftColW).slice(0, 4) : [];
  const voidLines =
    invoice.status === 'VOID' && invoice.voidReason
      ? wrapLines(`Voided: ${invoice.voidReason}`, sans, d.sideSz, leftColW).slice(0, 2)
      : [];

  let estRightH = 4;
  for (const r of totalRows) {
    if (r.dividerBefore) estRightH += 4;
    estRightH += r.bold ? d.totalsBoldLead : d.totalsLead;
  }

  let estLeftH = wordLines.length * d.sideLead + 6;
  if (banksToDraw.length > 0) {
    estLeftH += d.sideLead + 3 + banksToDraw.length * (d.sideLead + 1.5) + 6;
  }
  if (paymentsToDraw.length > 0) {
    estLeftH += d.sideLead + 3 + paymentsToDraw.length * (d.sideLead + 1) + 6;
  }
  if (noteLines.length > 0) {
    estLeftH += d.sideLead + 3 + noteLines.length * d.sideLead + 6;
  }
  if (voidLines.length > 0) {
    estLeftH += voidLines.length * d.sideLead + 4;
  }

  const neededBottomH = Math.max(estRightH, estLeftH) + 6;
  ensureSpace(neededBottomH, false);

  const summaryStartY = y - 6;

  // Render Right Column: Totals
  let rightY = summaryStartY;
  for (const row of totalRows) {
    if (row.dividerBefore) {
      page.drawLine({
        start: { x: totalsX, y: rightY + 7 },
        end: { x: colAmt, y: rightY + 7 },
        thickness: 0.7,
        color: hairline,
      });
      rightY -= 3;
    }
    const f = row.bold ? sansBold : sans;
    const mf = row.bold ? monoBold : mono;
    const sz = row.bold ? d.totalsBoldSz : d.totalsSz;
    page.drawText(row.label, {
      x: totalsX,
      y: rightY,
      size: sz,
      font: f,
      color: row.accent ? brandColor : row.bold ? ink : muted,
    });
    const vw = mf.widthOfTextAtSize(row.val, sz);
    page.drawText(row.val, {
      x: colAmt - vw,
      y: rightY,
      size: sz,
      font: mf,
      color: row.accent ? brandColor : ink,
    });
    rightY -= row.bold ? d.totalsBoldLead : d.totalsLead;
  }

  // Render Left Column: In words + Bank Details + Payments Received + Notes + Void
  let leftY = summaryStartY;
  for (const wLine of wordLines) {
    page.drawText(wLine, { x: margin, y: leftY, size: d.sideSz, font: sans, color: muted });
    leftY -= d.sideLead;
  }

  if (banksToDraw.length > 0) {
    leftY -= 5;
    page.drawText('PAYMENT DETAILS', { x: margin, y: leftY, size: 7, font: monoBold, color: brandColor });
    leftY -= d.sideLead + 1;
    for (const bank of banksToDraw) {
      const bankLine = safeText(`${bank.bankName} · ${bank.accountNumber} · ${bank.accountName}`);
      const wrappedBank = wrapLines(bankLine, mono, d.sideSz, leftColW).slice(0, 2);
      for (const bLine of wrappedBank) {
        page.drawText(bLine, { x: margin, y: leftY, size: d.sideSz, font: mono, color: ink });
        leftY -= d.sideLead + 1;
      }
    }
  }

  if (paymentsToDraw.length > 0) {
    leftY -= 4;
    page.drawText('PAYMENTS RECEIVED', { x: margin, y: leftY, size: 7, font: monoBold, color: muted });
    leftY -= d.sideLead + 1;
    for (const p of paymentsToDraw) {
      const label = safeText(
        `${formatLagosDateOnly(p.paymentDate)} · ${p.paymentMethod}${p.receiptNumber ? ` · ${p.receiptNumber}` : ''}`
      );
      const amtStr = formatKobo(p.amountKobo, cur);
      const aw = mono.widthOfTextAtSize(amtStr, d.sideSz);
      page.drawText(label, { x: margin, y: leftY, size: d.sideSz, font: sans, color: ink });
      page.drawText(amtStr, { x: margin + leftColW - aw, y: leftY, size: d.sideSz, font: mono, color: ink });
      leftY -= d.sideLead + 0.5;
    }
  }

  if (noteLines.length > 0) {
    leftY -= 4;
    page.drawText('NOTES', { x: margin, y: leftY, size: 7, font: monoBold, color: muted });
    leftY -= d.sideLead + 1;
    for (const nLine of noteLines) {
      page.drawText(nLine, { x: margin, y: leftY, size: d.sideSz, font: sans, color: muted });
      leftY -= d.sideLead;
    }
  }

  if (voidLines.length > 0) {
    leftY -= 4;
    const danger = rgb(0.72, 0.11, 0.11);
    for (const vLine of voidLines) {
      page.drawText(vLine, { x: margin, y: leftY, size: d.sideSz, font: sansBold, color: danger });
      leftY -= d.sideLead;
    }
  }

  // Compact Footer: QR verification + optional "Made with Tallymark"
  const footerY = d.footerBottom;
  page.drawLine({
    start: { x: margin, y: footerTopY },
    end: { x: pageWidth - margin, y: footerTopY },
    thickness: 0.55,
    color: hairline,
  });

  page.drawImage(qrImage, {
    x: pageWidth - margin - d.qrSize,
    y: footerY,
    width: d.qrSize,
    height: d.qrSize,
  });
  page.drawText('Scan to view live invoice status and receipts', {
    x: margin,
    y: footerY + d.qrSize - 11,
    size: 7.5,
    font: sansBold,
    color: ink,
  });
  page.drawText(publicUrl, {
    x: margin,
    y: footerY + d.qrSize - 22,
    size: 7,
    font: mono,
    color: muted,
  });
  if (snap.showBranding) {
    page.drawText('Made with Tallymark', {
      x: margin,
      y: footerY + 2,
      size: 7,
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
  if (quote.status === 'DRAFT') return { label: 'DRAFT', color: colorRgb(0.36, 0.39, 0.37) };
  if (quote.status === 'VOID') return { label: 'VOID', color: colorRgb(0.72, 0.11, 0.11) };
  if (quote.status === 'ACCEPTED') return { label: 'ACCEPTED', color: colorRgb(0.024, 0.306, 0.231) };
  if (quote.status === 'CONVERTED') return { label: 'CONVERTED', color: colorRgb(0.024, 0.306, 0.231) };
  if (quote.status === 'DECLINED') return { label: 'DECLINED', color: colorRgb(0.72, 0.11, 0.11) };
  if (quote.isExpired) return { label: 'EXPIRED', color: colorRgb(0.71, 0.33, 0.04) };
  return { label: 'QUOTATION', color: colorRgb(0.36, 0.39, 0.37) };
}

export function buildPublicQuotePreview(
  quote: QuoteRecord,
  business: BusinessProfile
): PublicQuoteRecord {
  const snap = quote.snapshot || {
    quoteNumber: quote.quoteNumber || 'DRAFT',
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
      name: quote.customerName,
      address: quote.customerAddress,
    },
    bankAccounts: (business.bankAccounts || []).filter((b) => quote.bankAccountIds.includes(b.id)),
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    termsKind: quote.termsKind,
    lines: quote.lines,
    subtotalKobo: quote.subtotalKobo,
    lineDiscountTotalKobo: quote.lineDiscountTotalKobo,
    invoiceDiscountKobo: quote.invoiceDiscountKobo,
    vatEnabled: quote.vatEnabled,
    vatMode: quote.vatMode,
    vatRateBps: quote.vatRateBps,
    vatKobo: quote.vatKobo,
    totalKobo: quote.totalKobo,
    depositType: quote.depositType,
    depositValue: quote.depositValue,
    amountDueNowKobo: quote.amountDueNowKobo,
    notes: quote.notes,
    template: quote.template,
    showBranding: true,
  };

  return {
    publicId: quote.publicId,
    status: quote.status,
    isExpired: quote.isExpired,
    sentAt: quote.sentAt,
    decisionName: quote.decisionName,
    decisionNote: quote.decisionNote,
    decisionAt: quote.decisionAt,
    voidReason: quote.voidReason,
    voidedAt: quote.voidedAt,
    snapshot: snap,
  };
}

export function buildQuotePdfFilename(quote: PublicQuoteRecord): string {
  const numPart = (quote.snapshot.quoteNumber || 'quotation')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const custPart = (quote.snapshot.customer?.name || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const base = [numPart || 'quotation', custPart].filter(Boolean).join('-');
  return `${base}.pdf`;
}

/**
 * Generates a compact, true-vector A4 Quotation PDF (< 150 KB via font subsetting)
 * rendered strictly from the immutable quote snapshot.
 * Dynamically adapts vertical density and uses a 2-column bottom summary layout
 * so real-world quotations fit crisply onto 1 single A4 page without dropping data.
 */
export async function generateQuotePdfBytes(
  quote: PublicQuoteRecord,
  originOverride?: string,
  fontBytesOverride?: LoadedFontBytes
): Promise<Uint8Array> {
  const snap = quote.snapshot;
  const [{ PDFDocument, rgb, fontkit, QRCode }, fonts] = await Promise.all([
    loadPdfDeps(),
    fontBytesOverride ? Promise.resolve(fontBytesOverride) : getFontBytes(),
  ]);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const sans = await pdfDoc.embedFont(fonts.sansRegular, { subset: true });
  const sansBold = await pdfDoc.embedFont(fonts.sansSemiBold, { subset: true });
  const mono = await pdfDoc.embedFont(fonts.monoRegular, { subset: true });
  const monoBold = await pdfDoc.embedFont(fonts.monoSemiBold, { subset: true });
  const serif = await pdfDoc.embedFont(fonts.serifRegular, { subset: true });

  const hasLiveLink = Boolean(
    quote.status !== 'DRAFT' && quote.publicId && quote.publicId !== 'draft'
  );
  const origin =
    originOverride || (typeof window !== 'undefined' ? window.location.origin : 'https://tallymark.app');
  const publicUrl = hasLiveLink ? `${origin}/q/${quote.publicId}` : '';

  let qrImage: import('pdf-lib').PDFImage | null = null;
  if (hasLiveLink) {
    const qrDataUrl = await QRCode.toDataURL(publicUrl, {
      width: 144,
      margin: 1,
      color: { dark: '#121513', light: '#FFFDF9' },
    });
    const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), (c) => c.charCodeAt(0));
    qrImage = await pdfDoc.embedPng(qrBytes);
  }
  const logoImage = await embedLogo(pdfDoc, snap.business.logoDataUrl);

  const brandColor = hexToRgb(snap.business.brandColor || '#064E3B');
  const ink = rgb(0.07, 0.08, 0.075);
  const muted = rgb(0.36, 0.39, 0.37);
  const hairline = rgb(0.87, 0.84, 0.76);
  const paper = rgb(1, 0.992, 0.976);
  const cur = snap.business.currency || 'NGN';

  const pageWidth = 595.28;
  const pageHeight = 841.89;

  interface QuoteDensity {
    margin: number;
    topPad: number;
    accentH: number;
    logoMax: number;
    bizTitleSz: number;
    bizMetaSz: number;
    bizMetaLead: number;
    invLabelSz: number;
    invNumSz: number;
    stampW: number;
    stampH: number;
    stampTextSz: number;
    sectionGap: number;
    billTitleSz: number;
    billTextSz: number;
    billLead: number;
    tableHeadH: number;
    descSz: number;
    descLead: number;
    numSz: number;
    discSz: number;
    discLead: number;
    rowPadTop: number;
    rowPadBottom: number;
    totalsSz: number;
    totalsBoldSz: number;
    totalsLead: number;
    totalsBoldLead: number;
    sideSz: number;
    sideLead: number;
    qrSize: number;
    footerBottom: number;
    footerClearance: number;
  }

  const TIERS: QuoteDensity[] = [
    {
      margin: 34,
      topPad: 32,
      accentH: 6,
      logoMax: 36,
      bizTitleSz: 16.5,
      bizMetaSz: 8,
      bizMetaLead: 10,
      invLabelSz: 9.5,
      invNumSz: 12.5,
      stampW: 92,
      stampH: 26,
      stampTextSz: 9.5,
      sectionGap: 12,
      billTitleSz: 10,
      billTextSz: 8,
      billLead: 10.5,
      tableHeadH: 18,
      descSz: 8.5,
      descLead: 10.5,
      numSz: 8,
      discSz: 7,
      discLead: 8.5,
      rowPadTop: 4.5,
      rowPadBottom: 4.5,
      totalsSz: 8,
      totalsBoldSz: 9.5,
      totalsLead: 12,
      totalsBoldLead: 14.5,
      sideSz: 7.5,
      sideLead: 9.5,
      qrSize: 40,
      footerBottom: 26,
      footerClearance: 76,
    },
    {
      margin: 28,
      topPad: 26,
      accentH: 5,
      logoMax: 30,
      bizTitleSz: 14.5,
      bizMetaSz: 7.5,
      bizMetaLead: 9,
      invLabelSz: 8.5,
      invNumSz: 11.5,
      stampW: 82,
      stampH: 22,
      stampTextSz: 8.5,
      sectionGap: 9,
      billTitleSz: 9.2,
      billTextSz: 7.5,
      billLead: 9.2,
      tableHeadH: 16,
      descSz: 7.8,
      descLead: 9.2,
      numSz: 7.5,
      discSz: 6.5,
      discLead: 7.5,
      rowPadTop: 3,
      rowPadBottom: 3,
      totalsSz: 7.5,
      totalsBoldSz: 8.8,
      totalsLead: 10.5,
      totalsBoldLead: 12.5,
      sideSz: 7,
      sideLead: 8.5,
      qrSize: 34,
      footerBottom: 20,
      footerClearance: 64,
    },
    {
      margin: 24,
      topPad: 22,
      accentH: 4,
      logoMax: 24,
      bizTitleSz: 13,
      bizMetaSz: 7,
      bizMetaLead: 8.2,
      invLabelSz: 8,
      invNumSz: 10.5,
      stampW: 74,
      stampH: 20,
      stampTextSz: 7.8,
      sectionGap: 7,
      billTitleSz: 8.5,
      billTextSz: 7,
      billLead: 8.2,
      tableHeadH: 14,
      descSz: 7.2,
      descLead: 8.2,
      numSz: 7,
      discSz: 6.2,
      discLead: 7,
      rowPadTop: 2,
      rowPadBottom: 2,
      totalsSz: 7,
      totalsBoldSz: 8.2,
      totalsLead: 9.2,
      totalsBoldLead: 11,
      sideSz: 6.8,
      sideLead: 7.8,
      qrSize: 30,
      footerBottom: 16,
      footerClearance: 54,
    },
  ];

  const totalRows: Array<{ label: string; val: string; bold?: boolean; accent?: boolean; dividerBefore?: boolean }> = [
    { label: 'Subtotal', val: formatKobo(snap.subtotalKobo, cur) },
  ];
  if (snap.lineDiscountTotalKobo > 0) {
    totalRows.push({ label: 'Line discounts', val: `-${formatKobo(snap.lineDiscountTotalKobo, cur)}` });
  }
  if (snap.invoiceDiscountKobo > 0) {
    totalRows.push({ label: 'Quote discount', val: `-${formatKobo(snap.invoiceDiscountKobo, cur)}` });
  }
  if (snap.vatEnabled && snap.vatKobo > 0) {
    const rateLabel = (snap.vatRateBps / 100).toFixed(1).replace(/\.0$/, '');
    const vatLabel =
      snap.vatMode === 'inclusive' ? `VAT (${rateLabel}% incl.)` : `VAT (${rateLabel}%)`;
    totalRows.push({ label: vatLabel, val: formatKobo(snap.vatKobo, cur) });
  }
  totalRows.push({
    label: 'Quote Total',
    val: formatKobo(snap.totalKobo, cur),
    bold: true,
    accent: true,
    dividerBefore: true,
  });
  if (snap.depositType !== 'none' && snap.amountDueNowKobo < snap.totalKobo) {
    totalRows.push({
      label: 'Deposit if accepted',
      val: formatKobo(snap.amountDueNowKobo, cur),
      bold: true,
    });
  }

  const estimateSinglePageFit = (d: QuoteDensity): boolean => {
    const iw = pageWidth - d.margin * 2;
    let used = d.topPad;
    const bizMetaLines =
      (snap.business.address ? Math.min(2, wrapLines(snap.business.address, sans, d.bizMetaSz, 250).length) : 0) +
      ([snap.business.phone, snap.business.email].filter(Boolean).length > 0 ? 1 : 0) +
      (snap.business.tinRc ? 1 : 0);
    const headerH = Math.max(16 + bizMetaLines * d.bizMetaLead + 10, d.invNumSz + d.stampH + 22);
    used += headerH + d.sectionGap;

    const custAddrLines = snap.customer.address
      ? Math.min(2, wrapLines(snap.customer.address, sans, d.billTextSz, 240).length)
      : 0;
    const billH = Math.max(d.billLead * (2 + custAddrLines) + 4, d.billLead * 3 + 6);
    used += billH + d.sectionGap;

    used += d.tableHeadH + 4;
    for (const line of snap.lines) {
      const descCount = Math.max(1, wrapLines(line.description, sansBold, d.descSz, iw - 215).length);
      used += d.rowPadTop + descCount * d.descLead + (line.discountKobo > 0 ? d.discLead : 0) + d.rowPadBottom;
    }

    const leftColW = iw - 228;
    const rightH =
      totalRows.reduce((acc, r) => acc + (r.bold ? d.totalsBoldLead : d.totalsLead) + (r.dividerBefore ? 4 : 0), 0) +
      6;
    let leftH = wrapLines(`In words: ${koboToWords(snap.totalKobo, cur)}`, sans, d.sideSz, leftColW).length * d.sideLead + 6;
    if (snap.notes) {
      leftH += d.sideLead + 4 + Math.min(5, wrapLines(snap.notes, sans, d.sideSz, leftColW).length) * d.sideLead + 6;
    }
    if (quote.status === 'VOID' && quote.voidReason) {
      leftH += d.sideLead * 2 + 4;
    }
    used += 8 + Math.max(rightH, leftH);
    return used <= pageHeight - d.footerClearance;
  };

  const d: QuoteDensity = TIERS.find((tier) => estimateSinglePageFit(tier)) || TIERS[TIERS.length - 1];
  const margin = d.margin;
  const innerWidth = pageWidth - margin * 2;
  const footerTopY = d.footerBottom + d.qrSize + 8;
  const minContentY = footerTopY + 8;

  const createStyledPage = () => {
    const p = pdfDoc.addPage([pageWidth, pageHeight]);
    p.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: paper });
    p.drawRectangle({ x: 0, y: pageHeight - d.accentH, width: pageWidth, height: d.accentH, color: brandColor });
    return p;
  };

  const drawCompactQuoteStamp = (targetPage: PDFPage, x: number, yPos: number) => {
    const { label, color } = getQuoteStampMeta(quote);
    targetPage.drawRectangle({
      x,
      y: yPos,
      width: d.stampW,
      height: d.stampH,
      borderColor: color,
      borderWidth: 1.6,
      rotate: deg(-5),
      opacity: 0.92,
    });
    targetPage.drawRectangle({
      x: x + 2.5,
      y: yPos + 2.5,
      width: d.stampW - 5,
      height: d.stampH - 5,
      borderColor: color,
      borderWidth: 0.65,
      rotate: deg(-5),
      opacity: 0.75,
    });
    const tw = monoBold.widthOfTextAtSize(label, d.stampTextSz);
    targetPage.drawText(label, {
      x: x + (d.stampW - tw) / 2,
      y: yPos + (d.stampH - d.stampTextSz) / 2 + 1,
      size: d.stampTextSz,
      font: monoBold,
      color,
      rotate: deg(-5),
    });
  };

  let page = createStyledPage();
  let y = pageHeight - d.topPad;

  // Header left: business identity
  let leftX = margin;
  if (logoImage) {
    const dims = logoImage.scaleToFit(d.logoMax, d.logoMax);
    page.drawImage(logoImage, {
      x: margin,
      y: y - dims.height + 12,
      width: dims.width,
      height: dims.height,
    });
    leftX = margin + dims.width + 10;
  }

  page.drawText(safeText(snap.business.name), {
    x: leftX,
    y,
    size: d.bizTitleSz,
    font: serif,
    color: ink,
  });

  let bizMetaY = y - (d.bizMetaLead + 2);
  if (snap.business.address) {
    for (const line of wrapLines(snap.business.address, sans, d.bizMetaSz, 260).slice(0, 2)) {
      page.drawText(line, { x: leftX, y: bizMetaY, size: d.bizMetaSz, font: sans, color: muted });
      bizMetaY -= d.bizMetaLead;
    }
  }
  const contactParts = [snap.business.phone, snap.business.email].filter(Boolean).join(' · ');
  if (contactParts) {
    page.drawText(safeText(contactParts), { x: leftX, y: bizMetaY, size: d.bizMetaSz, font: sans, color: muted });
    bizMetaY -= d.bizMetaLead;
  }
  if (snap.business.tinRc) {
    page.drawText(safeText(`TIN / RC: ${snap.business.tinRc}`), {
      x: leftX,
      y: bizMetaY,
      size: d.bizMetaSz,
      font: mono,
      color: ink,
    });
    bizMetaY -= d.bizMetaLead;
  }

  // Header right: QUOTATION + number + stamp
  const titleText = 'QUOTATION';
  const titleW = monoBold.widthOfTextAtSize(titleText, d.invLabelSz);
  page.drawText(titleText, {
    x: pageWidth - margin - titleW,
    y: y + 3,
    size: d.invLabelSz,
    font: monoBold,
    color: brandColor,
  });
  const numText = safeText(snap.quoteNumber);
  const numW = monoBold.widthOfTextAtSize(numText, d.invNumSz);
  page.drawText(numText, {
    x: pageWidth - margin - numW,
    y: y - (d.invNumSz + 1),
    size: d.invNumSz,
    font: monoBold,
    color: ink,
  });

  const stampBottomY = y - (d.invNumSz + d.stampH + 10);
  drawCompactQuoteStamp(page, pageWidth - margin - d.stampW - 2, stampBottomY);

  y = Math.min(bizMetaY - 4, stampBottomY - 6);
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.7,
    color: hairline,
  });
  y -= d.sectionGap + 2;

  // Prepared For (never includes customer phone or email) + Dates
  page.drawText('PREPARED FOR', { x: margin, y, size: 7, font: monoBold, color: muted });
  page.drawText(safeText(snap.customer.name), {
    x: margin,
    y: y - (d.billLead + 1),
    size: d.billTitleSz,
    font: sansBold,
    color: ink,
  });
  let custY = y - (d.billLead * 2 + 2);
  if (snap.customer.address) {
    for (const line of wrapLines(snap.customer.address, sans, d.billTextSz, 240).slice(0, 2)) {
      page.drawText(line, { x: margin, y: custY, size: d.billTextSz, font: sans, color: muted });
      custY -= d.billLead;
    }
  }

  const colR = pageWidth - margin - 180;
  const metaRows: Array<[string, string]> = [
    ['ISSUE DATE', safeText(formatLagosDateOnly(snap.issueDate))],
    ['VALID UNTIL', safeText(formatLagosDateOnly(snap.validUntil))],
    ['TERMS', safeText(formatTermsLabel(snap.termsKind) || String(snap.termsKind || ''))],
  ];
  let metaY = y;
  for (const [k, v] of metaRows) {
    page.drawText(k, { x: colR, y: metaY, size: 7, font: monoBold, color: muted });
    const vw = mono.widthOfTextAtSize(v, d.billTextSz);
    page.drawText(v, { x: pageWidth - margin - vw, y: metaY, size: d.billTextSz, font: mono, color: ink });
    metaY -= d.billLead + 1.5;
  }

  y = Math.min(custY - 4, metaY - 2) - Math.max(2, d.sectionGap - 6);

  // Table columns
  const colDesc = margin + 6;
  const colQty = margin + innerWidth - 195;
  const colUnit = margin + innerWidth - 110;
  const colAmt = pageWidth - margin - 6;

  const drawItemsHeader = () => {
    page.drawRectangle({
      x: margin,
      y: y - d.tableHeadH + 5,
      width: innerWidth,
      height: d.tableHeadH,
      color: rgb(0.95, 0.935, 0.9),
    });
    const headTextY = y - d.tableHeadH + 5 + (d.tableHeadH - 7) / 2;
    page.drawText('DESCRIPTION', { x: colDesc, y: headTextY, size: 7, font: monoBold, color: muted });
    page.drawText('QTY', { x: colQty, y: headTextY, size: 7, font: monoBold, color: muted });
    page.drawText('UNIT PRICE', { x: colUnit - 34, y: headTextY, size: 7, font: monoBold, color: muted });
    const amtHeadW = monoBold.widthOfTextAtSize('AMOUNT', 7);
    page.drawText('AMOUNT', { x: colAmt - amtHeadW, y: headTextY, size: 7, font: monoBold, color: muted });
    y -= d.tableHeadH + 3;
  };

  const ensureSpace = (neededHeight: number, repeatTableHeader = false) => {
    if (y - neededHeight >= minContentY) return;
    page = createStyledPage();
    y = pageHeight - d.topPad;
    page.drawText(safeText(`${snap.business.name} · ${snap.quoteNumber} (continued)`), {
      x: margin,
      y,
      size: 7.5,
      font: mono,
      color: muted,
    });
    y -= 16;
    if (repeatTableHeader) {
      drawItemsHeader();
    }
  };

  drawItemsHeader();

  // Line items
  for (const line of snap.lines) {
    const descLines = wrapLines(line.description, sansBold, d.descSz, innerWidth - 215);
    const lineCount = Math.max(1, descLines.length);
    const needed = d.rowPadTop + lineCount * d.descLead + (line.discountKobo > 0 ? d.discLead : 0) + d.rowPadBottom;
    ensureSpace(needed, true);

    y -= d.rowPadTop;
    const qtyStr = formatQtyThousandths(line.qtyThousandths);
    const unitStr = formatKobo(line.unitPriceKobo, cur);
    const totalStr = formatKobo(line.lineTotalKobo, cur);

    for (let i = 0; i < lineCount; i++) {
      page.drawText(descLines[i] || '', {
        x: colDesc,
        y: y - i * d.descLead,
        size: d.descSz,
        font: sansBold,
        color: ink,
      });
    }
    page.drawText(qtyStr, { x: colQty, y, size: d.numSz, font: mono, color: ink });
    const uw = mono.widthOfTextAtSize(unitStr, d.numSz);
    page.drawText(unitStr, { x: colUnit + 20 - uw, y, size: d.numSz, font: mono, color: ink });
    const tw = monoBold.widthOfTextAtSize(totalStr, d.descSz);
    page.drawText(totalStr, { x: colAmt - tw, y, size: d.descSz, font: monoBold, color: ink });

    y -= lineCount * d.descLead;
    if (line.discountKobo > 0) {
      page.drawText(`Line discount: -${formatKobo(line.discountKobo, cur)}`, {
        x: colDesc,
        y,
        size: d.discSz,
        font: sans,
        color: muted,
      });
      y -= d.discLead;
    }

    const lineY = y + Math.max(2, d.rowPadBottom * 0.5);
    page.drawLine({
      start: { x: margin, y: lineY },
      end: { x: pageWidth - margin, y: lineY },
      thickness: 0.35,
      color: hairline,
    });
    y -= d.rowPadBottom;
  }

  // Bottom 2-column summary zone: Left (In words, Notes & Terms, Void) | Right (Totals)
  const leftColW = innerWidth - 228;
  const totalsX = margin + innerWidth - 214;

  const wordLines = wrapLines(`In words: ${koboToWords(snap.totalKobo, cur)}`, sans, d.sideSz, leftColW);
  const noteLines = snap.notes ? wrapLines(snap.notes, sans, d.sideSz, leftColW).slice(0, 5) : [];
  const voidLines =
    quote.status === 'VOID' && quote.voidReason
      ? wrapLines(`Voided: ${quote.voidReason}`, sans, d.sideSz, leftColW).slice(0, 2)
      : [];

  let estRightH = 4;
  for (const r of totalRows) {
    if (r.dividerBefore) estRightH += 4;
    estRightH += r.bold ? d.totalsBoldLead : d.totalsLead;
  }

  let estLeftH = wordLines.length * d.sideLead + 6;
  if (noteLines.length > 0) {
    estLeftH += d.sideLead + 3 + noteLines.length * d.sideLead + 6;
  }
  if (voidLines.length > 0) {
    estLeftH += voidLines.length * d.sideLead + 4;
  }

  ensureSpace(Math.max(estRightH, estLeftH) + 6, false);
  const summaryStartY = y - 6;

  // Render Right Column: Totals
  let rightY = summaryStartY;
  for (const row of totalRows) {
    if (row.dividerBefore) {
      page.drawLine({
        start: { x: totalsX, y: rightY + 7 },
        end: { x: colAmt, y: rightY + 7 },
        thickness: 0.7,
        color: hairline,
      });
      rightY -= 3;
    }
    const f = row.bold ? sansBold : sans;
    const mf = row.bold ? monoBold : mono;
    const sz = row.bold ? d.totalsBoldSz : d.totalsSz;
    page.drawText(row.label, {
      x: totalsX,
      y: rightY,
      size: sz,
      font: f,
      color: row.accent ? brandColor : row.bold ? ink : muted,
    });
    const vw = mf.widthOfTextAtSize(row.val, sz);
    page.drawText(row.val, {
      x: colAmt - vw,
      y: rightY,
      size: sz,
      font: mf,
      color: row.accent ? brandColor : ink,
    });
    rightY -= row.bold ? d.totalsBoldLead : d.totalsLead;
  }

  // Render Left Column: In words + Notes + Void
  let leftY = summaryStartY;
  for (const wLine of wordLines) {
    page.drawText(wLine, { x: margin, y: leftY, size: d.sideSz, font: sans, color: muted });
    leftY -= d.sideLead;
  }

  if (noteLines.length > 0) {
    leftY -= 5;
    page.drawText('NOTES & TERMS', { x: margin, y: leftY, size: 7, font: monoBold, color: muted });
    leftY -= d.sideLead + 1;
    for (const nLine of noteLines) {
      page.drawText(nLine, { x: margin, y: leftY, size: d.sideSz, font: sans, color: muted });
      leftY -= d.sideLead;
    }
  }

  if (voidLines.length > 0) {
    leftY -= 4;
    const danger = rgb(0.72, 0.11, 0.11);
    for (const vLine of voidLines) {
      page.drawText(vLine, { x: margin, y: leftY, size: d.sideSz, font: sansBold, color: danger });
      leftY -= d.sideLead;
    }
  }

  // Compact Footer: QR verification (for issued quotes) or draft label
  const footerY = d.footerBottom;
  page.drawLine({
    start: { x: margin, y: footerTopY },
    end: { x: pageWidth - margin, y: footerTopY },
    thickness: 0.55,
    color: hairline,
  });

  if (qrImage && hasLiveLink) {
    page.drawImage(qrImage, {
      x: pageWidth - margin - d.qrSize,
      y: footerY,
      width: d.qrSize,
      height: d.qrSize,
    });
    page.drawText('Scan to view live quote status or respond online', {
      x: margin,
      y: footerY + d.qrSize - 11,
      size: 7.5,
      font: sansBold,
      color: ink,
    });
    page.drawText(publicUrl, {
      x: margin,
      y: footerY + d.qrSize - 22,
      size: 7,
      font: mono,
      color: muted,
    });
  } else {
    page.drawText('Draft quotation · Not yet issued', {
      x: margin,
      y: footerY + d.qrSize - 12,
      size: 7.5,
      font: sansBold,
      color: ink,
    });
    page.drawText(`Valid until ${formatLagosDateOnly(snap.validUntil)}`, {
      x: margin,
      y: footerY + d.qrSize - 23,
      size: 7,
      font: mono,
      color: muted,
    });
  }

  if (snap.showBranding) {
    page.drawText('Made with Tallymark', {
      x: margin,
      y: footerY + 2,
      size: 7,
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
  a.download = buildQuotePdfFilename(quote);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ============================================================================
// SLICE 4: TRUE-VECTOR CUSTOMER STATEMENT OF ACCOUNT PDF (< 150 KB, SELECTABLE ₦)
// ============================================================================

export function buildStatementPdfFilename(statement: CustomerStatementRecord): string {
  const cust = (statement.customer.name || 'customer')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  return `Statement_${cust || 'Customer'}_${statement.fromDate}_to_${statement.toDate}.pdf`;
}

export async function generateCustomerStatementPdfBytes(
  statement: CustomerStatementRecord,
  options?: { fontBytesOverride?: LoadedFontBytes }
): Promise<Uint8Array> {
  const [{ PDFDocument, fontkit }, fonts] = await Promise.all([
    loadPdfDeps(),
    options?.fontBytesOverride ? Promise.resolve(options.fontBytesOverride) : getFontBytes(),
  ]);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(`Statement of Account - ${safeText(statement.customer.name)}`);
  pdfDoc.setAuthor(safeText(statement.business.name));
  pdfDoc.setCreator('Tallymark');

  const sans = await pdfDoc.embedFont(fonts.sansRegular, { subset: true });
  const sansBold = await pdfDoc.embedFont(fonts.sansSemiBold, { subset: true });
  const mono = await pdfDoc.embedFont(fonts.monoRegular, { subset: true });
  const monoBold = await pdfDoc.embedFont(fonts.monoSemiBold, { subset: true });
  const serif = await pdfDoc.embedFont(fonts.serifRegular, { subset: true });

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 42;
  const innerWidth = pageWidth - margin * 2;

  const ink = colorRgb(0.07, 0.08, 0.075);
  const muted = colorRgb(0.36, 0.39, 0.37);
  const hairline = colorRgb(0.86, 0.83, 0.76);
  const softFill = colorRgb(0.975, 0.965, 0.945);
  const brand = hexToRgb(statement.business.brandColor || '#064E3B');
  const cur = statement.business.currency || 'NGN';

  const pages: PDFPage[] = [];
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  pages.push(page);
  let y = pageHeight - margin;

  // Top brand accent bar
  page.drawRectangle({
    x: margin,
    y: pageHeight - 16,
    width: innerWidth,
    height: 4,
    color: brand,
  });

  // Header left: Business info
  const bizName = safeText(statement.business.name) || 'Business';
  const bizTitleFont = pickFontForText(bizName, serif, sansBold);
  page.drawText(bizName, { x: margin, y, size: 20, font: bizTitleFont, color: ink });
  y -= 16;

  const bizDetails: string[] = [];
  if (statement.business.tinRc) bizDetails.push(`TIN / RC: ${safeText(statement.business.tinRc)}`);
  if (statement.business.address) bizDetails.push(safeText(statement.business.address));
  const contactLine = [statement.business.phone, statement.business.email]
    .filter(Boolean)
    .map(safeText)
    .join('  ·  ');
  if (contactLine) bizDetails.push(contactLine);

  for (const line of bizDetails.slice(0, 3)) {
    page.drawText(line.slice(0, 72), { x: margin, y, size: 8.5, font: sans, color: muted });
    y -= 11.5;
  }

  // Header right: Statement title & period
  const rightTopY = pageHeight - margin;
  const titleStr = 'STATEMENT OF ACCOUNT';
  const titleW = monoBold.widthOfTextAtSize(titleStr, 11);
  page.drawText(titleStr, {
    x: pageWidth - margin - titleW,
    y: rightTopY + 4,
    size: 11,
    font: monoBold,
    color: brand,
  });

  const periodStr = `${formatLagosDateOnly(statement.fromDate)} - ${formatLagosDateOnly(statement.toDate)}`;
  const periodW = sansBold.widthOfTextAtSize(periodStr, 9);
  page.drawText(periodStr, {
    x: pageWidth - margin - periodW,
    y: rightTopY - 12,
    size: 9,
    font: sansBold,
    color: ink,
  });

  const genStr = `Prepared: ${formatLagosDateOnly(statement.generatedDateLagos)}`;
  const genW = sans.widthOfTextAtSize(genStr, 8);
  page.drawText(genStr, {
    x: pageWidth - margin - genW,
    y: rightTopY - 25,
    size: 8,
    font: sans,
    color: muted,
  });

  y = Math.min(y, rightTopY - 40) - 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.75,
    color: hairline,
  });
  y -= 18;

  // Customer block (left) & Closing Balance box (right)
  const blockTopY = y;
  page.drawText('CUSTOMER', { x: margin, y, size: 7.5, font: monoBold, color: muted });
  y -= 13;
  page.drawText(safeText(statement.customer.name) || 'Customer', {
    x: margin,
    y,
    size: 11,
    font: sansBold,
    color: ink,
  });
  y -= 13;
  if (statement.customer.phone) {
    page.drawText(safeText(statement.customer.phone), { x: margin, y, size: 8.5, font: sans, color: muted });
    y -= 11.5;
  }
  if (statement.customer.email) {
    page.drawText(safeText(statement.customer.email), { x: margin, y, size: 8.5, font: sans, color: muted });
    y -= 11.5;
  }
  if (statement.customer.address) {
    for (const aLine of wrapLines(statement.customer.address, sans, 8.5, 260).slice(0, 2)) {
      page.drawText(aLine, { x: margin, y, size: 8.5, font: sans, color: muted });
      y -= 11.5;
    }
  }

  // Closing summary box on right
  const boxW = 215;
  const boxH = 66;
  const boxX = pageWidth - margin - boxW;
  const boxY = blockTopY - boxH + 10;
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    color: softFill,
    borderColor: hairline,
    borderWidth: 0.75,
  });

  const drawSummaryLine = (label: string, val: string, rowY: number, bold = false) => {
    const f = bold ? sansBold : sans;
    const vf = bold ? monoBold : mono;
    const sz = bold ? 9.5 : 8;
    page.drawText(label, { x: boxX + 10, y: rowY, size: sz, font: f, color: bold ? ink : muted });
    const vw = vf.widthOfTextAtSize(val, sz);
    page.drawText(val, {
      x: boxX + boxW - 10 - vw,
      y: rowY,
      size: sz,
      font: vf,
      color: bold ? brand : ink,
    });
  };

  drawSummaryLine('Opening balance', formatKobo(statement.openingBalanceKobo, cur), boxY + 51);
  drawSummaryLine('Billed in period', formatKobo(statement.periodDebitsKobo, cur), boxY + 38);
  const creditsCombined = statement.periodPaymentsKobo + statement.periodWriteOffsKobo;
  drawSummaryLine('Paid / written off', formatKobo(creditsCombined, cur), boxY + 25);
  drawSummaryLine('Closing balance', formatKobo(statement.closingBalanceKobo, cur), boxY + 9, true);

  y = Math.min(y, boxY - 10) - 10;

  // Table columns
  const colDate = margin;
  const colDesc = margin + 68;
  const colDebitR = margin + 358;
  const colCreditR = margin + 432;
  const colBalR = pageWidth - margin;

  const drawTableHeader = (targetPage: PDFPage, headerY: number): number => {
    targetPage.drawRectangle({
      x: margin,
      y: headerY - 6,
      width: innerWidth,
      height: 20,
      color: softFill,
    });
    targetPage.drawText('DATE', { x: colDate + 4, y: headerY, size: 7.5, font: monoBold, color: muted });
    targetPage.drawText('DESCRIPTION', { x: colDesc, y: headerY, size: 7.5, font: monoBold, color: muted });

    const debH = 'DEBIT';
    targetPage.drawText(debH, {
      x: colDebitR - monoBold.widthOfTextAtSize(debH, 7.5),
      y: headerY,
      size: 7.5,
      font: monoBold,
      color: muted,
    });
    const crH = 'CREDIT';
    targetPage.drawText(crH, {
      x: colCreditR - monoBold.widthOfTextAtSize(crH, 7.5),
      y: headerY,
      size: 7.5,
      font: monoBold,
      color: muted,
    });
    const balH = 'BALANCE';
    targetPage.drawText(balH, {
      x: colBalR - monoBold.widthOfTextAtSize(balH, 7.5) - 4,
      y: headerY,
      size: 7.5,
      font: monoBold,
      color: muted,
    });
    return headerY - 22;
  };

  y = drawTableHeader(page, y);

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight < 68) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      pages.push(page);
      page.drawRectangle({
        x: margin,
        y: pageHeight - 16,
        width: innerWidth,
        height: 3,
        color: brand,
      });
      page.drawText(
        `${safeText(statement.customer.name)} · Statement (${statement.fromDate} to ${statement.toDate})`,
        { x: margin, y: pageHeight - 36, size: 8, font: sans, color: muted }
      );
      y = drawTableHeader(page, pageHeight - 58);
    }
  };

  // Opening balance brought forward row
  ensureSpace(22);
  page.drawText(statement.fromDate, { x: colDate + 4, y, size: 8, font: mono, color: muted });
  page.drawText('Opening balance brought forward', {
    x: colDesc,
    y,
    size: 8.5,
    font: sansBold,
    color: ink,
  });
  const openStr = formatKobo(statement.openingBalanceKobo, cur);
  page.drawText(openStr, {
    x: colBalR - monoBold.widthOfTextAtSize(openStr, 8.5) - 4,
    y,
    size: 8.5,
    font: monoBold,
    color: ink,
  });
  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.4,
    color: hairline,
  });
  y -= 14;

  if (statement.lines.length === 0) {
    ensureSpace(24);
    page.drawText('No invoices, payments, or write-offs recorded in this date range.', {
      x: colDesc,
      y,
      size: 8.5,
      font: sans,
      color: muted,
    });
    y -= 20;
  }

  for (const row of statement.lines) {
    const descLines = wrapLines(row.description, sans, 8.5, 215);
    const rowHeight = Math.max(18, descLines.length * 11 + 8);
    ensureSpace(rowHeight + 6);

    page.drawText(row.date, { x: colDate + 4, y, size: 8, font: mono, color: muted });
    descLines.forEach((dl, idx) => {
      page.drawText(dl, {
        x: colDesc,
        y: y - idx * 11,
        size: 8.5,
        font: row.kind === 'WRITE_OFF' ? sansBold : sans,
        color: row.kind === 'WRITE_OFF' ? muted : ink,
      });
    });

    if (row.debitKobo > 0) {
      const dStr = formatKobo(row.debitKobo, cur);
      page.drawText(dStr, {
        x: colDebitR - mono.widthOfTextAtSize(dStr, 8),
        y,
        size: 8,
        font: mono,
        color: ink,
      });
    }
    if (row.creditKobo > 0) {
      const cStr = formatKobo(row.creditKobo, cur);
      page.drawText(cStr, {
        x: colCreditR - mono.widthOfTextAtSize(cStr, 8),
        y,
        size: 8,
        font: mono,
        color: brand,
      });
    }
    const balStr = formatKobo(row.runningBalanceKobo, cur);
    page.drawText(balStr, {
      x: colBalR - monoBold.widthOfTextAtSize(balStr, 8) - 4,
      y,
      size: 8,
      font: monoBold,
      color: ink,
    });

    y -= rowHeight - 4;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 0.35,
      color: hairline,
    });
    y -= 12;
  }

  // Closing totals footer strip
  ensureSpace(64);
  y -= 4;
  page.drawRectangle({
    x: margin,
    y: y - 42,
    width: innerWidth,
    height: 48,
    color: softFill,
    borderColor: hairline,
    borderWidth: 0.75,
  });

  page.drawText('PERIOD TOTALS', {
    x: margin + 10,
    y: y - 10,
    size: 7.5,
    font: monoBold,
    color: muted,
  });
  const totDeb = formatKobo(statement.periodDebitsKobo, cur);
  page.drawText(`Billed: ${totDeb}`, {
    x: margin + 10,
    y: y - 24,
    size: 8.5,
    font: mono,
    color: ink,
  });
  const totPay = formatKobo(statement.periodPaymentsKobo, cur);
  page.drawText(`Payments: ${totPay}`, {
    x: margin + 165,
    y: y - 24,
    size: 8.5,
    font: mono,
    color: brand,
  });
  if (statement.periodWriteOffsKobo > 0) {
    const totWo = formatKobo(statement.periodWriteOffsKobo, cur);
    page.drawText(`Write-offs: ${totWo}`, {
      x: margin + 10,
      y: y - 36,
      size: 8,
      font: mono,
      color: muted,
    });
  }

  const closeLabel = 'CLOSING BALANCE DUE';
  const closeLabelW = monoBold.widthOfTextAtSize(closeLabel, 7.5);
  page.drawText(closeLabel, {
    x: pageWidth - margin - 10 - closeLabelW,
    y: y - 11,
    size: 7.5,
    font: monoBold,
    color: muted,
  });
  const closeVal = formatKobo(statement.closingBalanceKobo, cur);
  const closeValW = monoBold.widthOfTextAtSize(closeVal, 12);
  page.drawText(closeVal, {
    x: pageWidth - margin - 10 - closeValW,
    y: y - 30,
    size: 12,
    font: monoBold,
    color: brand,
  });

  // Page numbering footer on every page
  pages.forEach((p, idx) => {
    const footY = 26;
    p.drawText(safeText(statement.business.name), {
      x: margin,
      y: footY,
      size: 7.5,
      font: sans,
      color: muted,
    });
    const pgStr = `Page ${idx + 1} of ${pages.length}`;
    const pgW = mono.widthOfTextAtSize(pgStr, 7.5);
    p.drawText(pgStr, {
      x: pageWidth - margin - pgW,
      y: footY,
      size: 7.5,
      font: mono,
      color: muted,
    });
  });

  return pdfDoc.save();
}

export async function downloadCustomerStatementPdf(statement: CustomerStatementRecord) {
  const bytes = await generateCustomerStatementPdfBytes(statement);
  const filename = buildStatementPdfFilename(statement);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { filename, byteLength: bytes.byteLength };
}

export async function shareCustomerStatementPdf(
  statement: CustomerStatementRecord
): Promise<'shared' | 'downloaded'> {
  const bytes = await generateCustomerStatementPdfBytes(statement);
  const filename = buildStatementPdfFilename(statement);
  const file = new File([bytes as BlobPart], filename, { type: 'application/pdf' });

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    await navigator.share({
      title: `Statement of Account - ${statement.customer.name}`,
      text: `Statement of account from ${statement.business.name} (${statement.fromDate} to ${statement.toDate}). Closing balance: ${formatKobo(statement.closingBalanceKobo, statement.business.currency)}.`,
      files: [file],
    });
    return 'shared';
  }

  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

