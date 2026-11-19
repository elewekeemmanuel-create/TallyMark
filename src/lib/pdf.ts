import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import {
  formatKobo,
  formatLagosDateOnly,
  formatLagosDateTime,
  koboToWords,
} from '../shared/money';
import type { ReceiptTemplate } from '../shared/schemas';
import type {
  BusinessProfile,
  CashBookDayView,
  PublicReceiptRecord,
  ReportsSummary,
} from '../shared/types';

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
  degrees: typeof import('pdf-lib').degrees;
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
      degrees: pdfLib.degrees,
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
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return colorRgb(0.024, 0.306, 0.231);
  return colorRgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function safeText(text: string): string {
  // Replace control characters or unsupported surrogate emoji with clean space so font encoding never throws
  return (text || '').replace(/[\uD800-\uDFFF]/g, '').replace(/[\r\n]+/g, ' ').trim();
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

function drawTallyIcon(
  page: PDFPage,
  x: number,
  y: number,
  size: number,
  strokeColor: RGB = colorRgb(0.024, 0.306, 0.231),
  slashColor: RGB = colorRgb(0.72, 0.61, 0.42)
) {
  const gap = size * 0.22;
  const h = size * 0.8;
  for (let i = 0; i < 4; i++) {
    const lx = x + i * gap + size * 0.14;
    page.drawLine({
      start: { x: lx, y },
      end: { x: lx, y: y + h },
      thickness: Math.max(1.1, size * 0.09),
      color: strokeColor,
    });
  }
  page.drawLine({
    start: { x: x + size * 0.04, y: y + size * 0.14 },
    end: { x: x + size * 0.94, y: y + h - size * 0.12 },
    thickness: Math.max(1.2, size * 0.1),
    color: slashColor,
  });
}

function drawStamp(
  page: PDFPage,
  status: PublicReceiptRecord['status'],
  x: number,
  y: number,
  font: PDFFont
) {
  const label = status === 'VOID' ? 'VOID' : status === 'PART_PAID' ? 'PART PAID' : 'PAID';
  const color =
    status === 'VOID'
      ? colorRgb(0.72, 0.11, 0.11)
      : status === 'PART_PAID'
      ? colorRgb(0.71, 0.33, 0.04)
      : colorRgb(0.024, 0.306, 0.231);

  const w = 96;
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
    if (dataUrl.startsWith('data:image/png')) {
      return await pdfDoc.embedPng(bytes);
    }
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
      return await pdfDoc.embedJpg(bytes);
    }
  } catch {
    return null;
  }
  return null;
}

export async function generateReceiptPdfBytes(
  receipt: PublicReceiptRecord,
  templateOverride?: ReceiptTemplate
): Promise<Uint8Array> {
  const template = templateOverride || receipt.template || 'modern';
  const [{ PDFDocument, rgb, fontkit, QRCode }, fonts] = await Promise.all([
    loadPdfDeps(),
    getFontBytes(),
  ]);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const sans = await pdfDoc.embedFont(fonts.sansRegular);
  const sansBold = await pdfDoc.embedFont(fonts.sansSemiBold);
  const mono = await pdfDoc.embedFont(fonts.monoRegular);
  const monoBold = await pdfDoc.embedFont(fonts.monoSemiBold);
  const serif = await pdfDoc.embedFont(fonts.serifRegular);

  const publicUrl = `${window.location.origin}/r/${receipt.publicId}`;
  const qrDataUrl = await QRCode.toDataURL(publicUrl, {
    width: 180,
    margin: 1,
    color: { dark: '#121513', light: '#FFFDF9' },
  });
  const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const qrImage = await pdfDoc.embedPng(qrBytes);
  const logoImage = await embedLogo(pdfDoc, receipt.businessLogoDataUrl);

  const brandColor = hexToRgb(receipt.brandColor || '#064E3B');
  const ink = rgb(0.07, 0.08, 0.075);
  const muted = rgb(0.36, 0.39, 0.37);
  const hairline = rgb(0.87, 0.84, 0.76);
  const ivoryBg = rgb(1, 0.992, 0.976);

  if (template === 'compact') {
    // 80mm thermal strip (226.77pt wide)
    const width = 226.77;
    const margin = 14;
    const innerWidth = width - margin * 2;
    const addressLines = receipt.businessAddress ? wrapLines(receipt.businessAddress, sans, 7.5, innerWidth) : [];
    const wordsText = `In words: ${koboToWords(receipt.totalKobo, receipt.currency)}`;
    const wordsLines = wrapLines(wordsText, sans, 7.5, innerWidth);
    const noteLines = receipt.note ? wrapLines(`Note: ${receipt.note}`, sans, 7.5, innerWidth) : [];
    const voidLines = receipt.voidReason ? wrapLines(`VOID: ${receipt.voidReason}`, sansBold, 7.5, innerWidth) : [];

    const itemBlockHeight = receipt.items.reduce((acc, item) => {
      const descCount = Math.max(1, wrapLines(item.description, sansBold, 8.5, innerWidth).length);
      return acc + descCount * 10 + 13;
    }, 0);
    const headerHeight =
      20 +
      (logoImage ? 50 : 0) +
      12 +
      addressLines.length * 10 +
      (receipt.businessPhone ? 10 : 0) +
      17 +
      22 +
      (receipt.customerName ? 11 : 0) +
      (receipt.soldBy ? 10 : 0) +
      15;
    const totalsHeight =
      13 +
      (receipt.discountTotalKobo > 0 ? 11 : 0) +
      (receipt.vatEnabled && receipt.vatKobo > 0 ? 11 : 0) +
      14 +
      11 +
      (receipt.balanceDueKobo > 0 ? 14 : 0) +
      4 +
      wordsLines.length * 10 +
      (noteLines.length ? 4 + noteLines.length * 10 : 0) +
      (voidLines.length ? 4 + voidLines.length * 10 : 0);
    const footerHeight = 8 + 14 + 58 + 20;

    const height = Math.max(430, headerHeight + itemBlockHeight + totalsHeight + footerHeight);
    const page = pdfDoc.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: ivoryBg });

    let y = height - 20;
    if (logoImage) {
      const dims = logoImage.scaleToFit(42, 42);
      page.drawImage(logoImage, { x: (width - dims.width) / 2, y: y - dims.height, width: dims.width, height: dims.height });
      y -= dims.height + 8;
    }

    const bizName = safeText(receipt.businessName);
    const bizWidth = sansBold.widthOfTextAtSize(bizName, 11);
    page.drawText(bizName, { x: Math.max(margin, (width - bizWidth) / 2), y, size: 11, font: sansBold, color: ink });
    y -= 12;

    for (const line of addressLines) {
      const lw = sans.widthOfTextAtSize(line, 7.5);
      page.drawText(line, { x: Math.max(margin, (width - lw) / 2), y, size: 7.5, font: sans, color: muted });
      y -= 10;
    }
    if (receipt.businessPhone) {
      const ph = safeText(receipt.businessPhone);
      const pw = mono.widthOfTextAtSize(ph, 7.5);
      page.drawText(ph, { x: Math.max(margin, (width - pw) / 2), y, size: 7.5, font: mono, color: muted });
      y -= 10;
    }

    y -= 4;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.75, color: hairline, dashArray: [2, 2] });
    y -= 13;

    page.drawText(`RECEIPT ${safeText(receipt.receiptNumber)}`, { x: margin, y, size: 8.5, font: monoBold, color: ink });
    y -= 11;
    page.drawText(formatLagosDateTime(receipt.issuedAt), { x: margin, y, size: 7.5, font: mono, color: muted });
    y -= 11;
    if (receipt.customerName) {
      page.drawText(`Customer: ${safeText(receipt.customerName)}`, { x: margin, y, size: 8, font: sans, color: ink });
      y -= 11;
    }
    if (receipt.soldBy) {
      page.drawText(`Sold by: ${safeText(receipt.soldBy)}`, { x: margin, y, size: 7.5, font: sans, color: muted });
      y -= 10;
    }

    y -= 2;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.75, color: hairline, dashArray: [2, 2] });
    y -= 13;

    for (const item of receipt.items) {
      const descLines = wrapLines(item.description, sansBold, 8.5, innerWidth);
      for (const dl of descLines) {
        page.drawText(dl, { x: margin, y, size: 8.5, font: sansBold, color: ink });
        y -= 10;
      }
      const left = `${item.qty} x ${formatKobo(item.unitPriceKobo, receipt.currency)}`;
      const right = formatKobo(item.lineTotalKobo, receipt.currency);
      page.drawText(left, { x: margin, y, size: 8, font: mono, color: muted });
      const rw = monoBold.widthOfTextAtSize(right, 8.5);
      page.drawText(right, { x: width - margin - rw, y, size: 8.5, font: monoBold, color: ink });
      y -= 13;
    }

    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.75, color: hairline, dashArray: [2, 2] });
    y -= 13;

    const drawRow = (label: string, val: string, bold = false) => {
      const fLabel = bold ? sansBold : sans;
      const fVal = bold ? monoBold : mono;
      const sz = bold ? 9.5 : 8;
      page.drawText(label, { x: margin, y, size: sz, font: fLabel, color: bold ? ink : muted });
      const vw = fVal.widthOfTextAtSize(val, sz);
      page.drawText(val, { x: width - margin - vw, y, size: sz, font: fVal, color: ink });
      y -= bold ? 14 : 11;
    };

    if (receipt.discountTotalKobo > 0) {
      drawRow('Discount', `-${formatKobo(receipt.discountTotalKobo, receipt.currency)}`);
    }
    if (receipt.vatEnabled && receipt.vatKobo > 0) {
      drawRow(`VAT (${receipt.vatMode})`, formatKobo(receipt.vatKobo, receipt.currency));
    }
    drawRow('TOTAL', formatKobo(receipt.totalKobo, receipt.currency), true);
    drawRow(`Paid (${receipt.paymentMethod})`, formatKobo(receipt.amountPaidKobo, receipt.currency));
    if (receipt.balanceDueKobo > 0) {
      drawRow('Balance Due', formatKobo(receipt.balanceDueKobo, receipt.currency), true);
    }

    y -= 4;
    for (const wl of wordsLines) {
      page.drawText(wl, { x: margin, y, size: 7.5, font: sans, color: muted });
      y -= 10;
    }

    if (noteLines.length > 0) {
      y -= 4;
      for (const nl of noteLines) {
        page.drawText(nl, { x: margin, y, size: 7.5, font: sans, color: muted });
        y -= 10;
      }
    }

    if (voidLines.length > 0) {
      y -= 4;
      for (const vl of voidLines) {
        page.drawText(vl, { x: margin, y, size: 7.5, font: sansBold, color: rgb(0.72, 0.11, 0.11) });
        y -= 10;
      }
    }

    y -= 8;
    const stampLabel = receipt.status === 'VOID' ? '[ VOID ]' : receipt.status === 'PART_PAID' ? '[ PART PAID ]' : '[ PAID ]';
    const sw = monoBold.widthOfTextAtSize(stampLabel, 9);
    page.drawText(stampLabel, { x: (width - sw) / 2, y, size: 9, font: monoBold, color: brandColor });
    y -= 58;

    page.drawImage(qrImage, { x: (width - 52) / 2, y, width: 52, height: 52 });
    y -= 14;
    const footer = 'Verified via Tallymark';
    const fw = sans.widthOfTextAtSize(footer, 7);
    page.drawText(footer, { x: (width - fw) / 2, y, size: 7, font: sans, color: muted });

    return pdfDoc.save();
  }

  // A4 Portrait for Modern and Classic templates
  const width = 595.28;
  const height = 841.89;
  const page = pdfDoc.addPage([width, height]);
  const margin = 48;
  const contentWidth = width - margin * 2;

  if (template === 'classic') {
    page.drawRectangle({ x: 0, y: 0, width, height, color: ivoryBg });
    page.drawRectangle({
      x: 24,
      y: 24,
      width: width - 48,
      height: height - 48,
      borderColor: brandColor,
      borderWidth: 1.5,
    });
    page.drawRectangle({
      x: 29,
      y: 29,
      width: width - 58,
      height: height - 58,
      borderColor: hairline,
      borderWidth: 0.75,
    });
  } else {
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: brandColor });
  }

  let y = height - 58;

  // Header
  if (logoImage) {
    const dims = logoImage.scaleToFit(56, 56);
    page.drawImage(logoImage, { x: margin, y: y - dims.height + 10, width: dims.width, height: dims.height });
  }

  const headerTextX = logoImage ? margin + 70 : margin;
  const bizTitle = safeText(receipt.businessName);
  page.drawText(bizTitle, {
    x: headerTextX,
    y: y - 4,
    size: 24,
    font: serif,
    color: ink,
  });

  let infoY = y - 24;
  const contactParts = [receipt.businessAddress, receipt.businessPhone, receipt.businessEmail].filter(Boolean);
  for (const part of contactParts) {
    for (const line of wrapLines(part, sans, 9, 270)) {
      page.drawText(line, { x: headerTextX, y: infoY, size: 9, font: sans, color: muted });
      infoY -= 12;
    }
  }

  // Right receipt badge
  const docLabel = receipt.receiptKind === 'BALANCE_PAYMENT' ? 'BALANCE RECEIPT' : 'OFFICIAL RECEIPT';
  const docLabelW = sansBold.widthOfTextAtSize(docLabel, 9);
  page.drawText(docLabel, { x: width - margin - docLabelW, y: y + 2, size: 9, font: sansBold, color: brandColor });

  const rctNum = safeText(receipt.receiptNumber);
  const rctNumW = monoBold.widthOfTextAtSize(rctNum, 16);
  page.drawText(rctNum, { x: width - margin - rctNumW, y: y - 18, size: 16, font: monoBold, color: ink });

  const dateText = formatLagosDateOnly(receipt.issuedDateLagos);
  const dateW = mono.widthOfTextAtSize(dateText, 9);
  page.drawText(dateText, { x: width - margin - dateW, y: y - 33, size: 9, font: mono, color: muted });

  y = Math.min(infoY, y - 56) - 16;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: hairline });
  y -= 24;

  // Customer & Meta Strip
  page.drawText('ISSUED TO', { x: margin, y, size: 8, font: sansBold, color: muted });
  page.drawText('PAYMENT METHOD', { x: margin + 220, y, size: 8, font: sansBold, color: muted });
  if (receipt.soldBy) {
    page.drawText('SOLD BY', { x: margin + 370, y, size: 8, font: sansBold, color: muted });
  }
  y -= 14;
  page.drawText(safeText(receipt.customerName) || 'Walk-in Customer', {
    x: margin,
    y,
    size: 11,
    font: sansBold,
    color: ink,
  });
  page.drawText(safeText(receipt.paymentMethod), {
    x: margin + 220,
    y,
    size: 11,
    font: sansBold,
    color: ink,
  });
  if (receipt.soldBy) {
    page.drawText(safeText(receipt.soldBy), { x: margin + 370, y, size: 11, font: sans, color: ink });
  }
  if (receipt.customerPhone) {
    y -= 13;
    page.drawText(safeText(receipt.customerPhone), { x: margin, y, size: 9, font: mono, color: muted });
  }
  if (receipt.parentReceiptNumber) {
    y -= 13;
    page.drawText(`Linked to ${safeText(receipt.parentReceiptNumber)}`, {
      x: margin,
      y,
      size: 9,
      font: mono,
      color: brandColor,
    });
  }

  y -= 24;

  // Table header
  page.drawRectangle({
    x: margin,
    y: y - 6,
    width: contentWidth,
    height: 24,
    color: template === 'classic' ? rgb(0.95, 0.93, 0.89) : rgb(0.96, 0.96, 0.95),
  });
  page.drawText('DESCRIPTION', { x: margin + 10, y: y + 2, size: 8, font: sansBold, color: muted });
  page.drawText('QTY', { x: margin + 275, y: y + 2, size: 8, font: sansBold, color: muted });
  page.drawText('UNIT PRICE', { x: margin + 335, y: y + 2, size: 8, font: sansBold, color: muted });
  const amtHdrW = sansBold.widthOfTextAtSize('AMOUNT', 8);
  page.drawText('AMOUNT', { x: width - margin - 10 - amtHdrW, y: y + 2, size: 8, font: sansBold, color: muted });
  y -= 24;

  for (const item of receipt.items) {
    const descLines = wrapLines(item.description, sans, 10, 245);
    const startY = y;
    for (const dl of descLines) {
      page.drawText(dl, { x: margin + 10, y, size: 10, font: sans, color: ink });
      y -= 13;
    }
    if (item.discountKobo > 0) {
      page.drawText(`Discount: -${formatKobo(item.discountKobo, receipt.currency)}`, {
        x: margin + 10,
        y,
        size: 8,
        font: mono,
        color: muted,
      });
      y -= 12;
    }

    page.drawText(String(item.qty), { x: margin + 275, y: startY, size: 9.5, font: mono, color: ink });
    page.drawText(formatKobo(item.unitPriceKobo, receipt.currency), {
      x: margin + 335,
      y: startY,
      size: 9.5,
      font: mono,
      color: ink,
    });
    const lineAmt = formatKobo(item.lineTotalKobo, receipt.currency);
    const lineAmtW = monoBold.widthOfTextAtSize(lineAmt, 10);
    page.drawText(lineAmt, { x: width - margin - 10 - lineAmtW, y: startY, size: 10, font: monoBold, color: ink });

    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: hairline });
    y -= 16;
  }

  y -= 8;
  // Totals block on the right + stamp on the left
  drawStamp(page, receipt.status, margin + 12, y - 48, monoBold);

  const totalsX = width - margin - 220;
  const drawSummaryRow = (label: string, val: string, emphasize = false) => {
    const fL = emphasize ? sansBold : sans;
    const fV = emphasize ? monoBold : mono;
    const sz = emphasize ? 12 : 9.5;
    page.drawText(label, { x: totalsX, y, size: sz, font: fL, color: emphasize ? ink : muted });
    const vw = fV.widthOfTextAtSize(val, sz);
    page.drawText(val, { x: width - margin - vw, y, size: sz, font: fV, color: ink });
    y -= emphasize ? 20 : 16;
  };

  drawSummaryRow('Subtotal', formatKobo(receipt.subtotalKobo, receipt.currency));
  if (receipt.discountTotalKobo > 0) {
    drawSummaryRow('Discounts', `-${formatKobo(receipt.discountTotalKobo, receipt.currency)}`);
  }
  if (receipt.vatEnabled && receipt.vatKobo > 0) {
    drawSummaryRow(`VAT 7.5% (${receipt.vatMode})`, formatKobo(receipt.vatKobo, receipt.currency));
  }
  page.drawLine({ start: { x: totalsX, y: y + 6 }, end: { x: width - margin, y: y + 6 }, thickness: 1, color: hairline });
  y -= 4;
  drawSummaryRow('Total', formatKobo(receipt.totalKobo, receipt.currency), true);
  drawSummaryRow('Amount Paid', formatKobo(receipt.amountPaidKobo, receipt.currency));
  if (receipt.balanceDueKobo > 0) {
    drawSummaryRow('Balance Due', formatKobo(receipt.balanceDueKobo, receipt.currency), true);
  }

  y = Math.min(y - 16, height - 480);

  // Amount in words
  const words = koboToWords(receipt.totalKobo, receipt.currency);
  page.drawText('AMOUNT IN WORDS', { x: margin, y, size: 8, font: sansBold, color: muted });
  y -= 14;
  for (const wl of wrapLines(words, sansBold, 9.5, contentWidth - 110)) {
    page.drawText(wl, { x: margin, y, size: 9.5, font: sansBold, color: ink });
    y -= 13;
  }

  if (receipt.note) {
    y -= 8;
    page.drawText('NOTE', { x: margin, y, size: 8, font: sansBold, color: muted });
    y -= 13;
    for (const nl of wrapLines(receipt.note, sans, 9, contentWidth - 110)) {
      page.drawText(nl, { x: margin, y, size: 9, font: sans, color: muted });
      y -= 12;
    }
  }

  if (receipt.voidReason) {
    y -= 8;
    for (const vl of wrapLines(`VOID REASON: ${receipt.voidReason}`, sansBold, 9.5, contentWidth - 110)) {
      page.drawText(vl, { x: margin, y, size: 9.5, font: sansBold, color: rgb(0.72, 0.11, 0.11) });
      y -= 13;
    }
  }

  // QR + Tallymark signature footer
  const footerY = 56;
  page.drawLine({ start: { x: margin, y: footerY + 62 }, end: { x: width - margin, y: footerY + 62 }, thickness: 0.75, color: hairline });
  page.drawImage(qrImage, { x: width - margin - 54, y: footerY, width: 54, height: 54 });

  drawTallyIcon(page, margin, footerY + 26, 16, brandColor);
  page.drawText('Issued with Tallymark', { x: margin + 24, y: footerY + 32, size: 9.5, font: sansBold, color: ink });
  page.drawText(`Verify online: ${publicUrl}`, { x: margin, y: footerY + 12, size: 8, font: mono, color: muted });
  page.drawText(`Issued ${formatLagosDateTime(receipt.issuedAt)} (WAT)`, {
    x: margin,
    y: footerY,
    size: 8,
    font: mono,
    color: muted,
  });

  return pdfDoc.save();
}

export async function downloadReceiptPdf(
  receipt: PublicReceiptRecord,
  templateOverride?: ReceiptTemplate
) {
  const bytes = await generateReceiptPdfBytes(receipt, templateOverride);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${receipt.receiptNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function triggerPdfDownload(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function generateDailySummaryPdfBytes(
  business: BusinessProfile,
  dayView: CashBookDayView
): Promise<Uint8Array> {
  const [{ PDFDocument, rgb, fontkit }, fonts] = await Promise.all([
    loadPdfDeps(),
    getFontBytes(),
  ]);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const sans = await pdfDoc.embedFont(fonts.sansRegular);
  const sansBold = await pdfDoc.embedFont(fonts.sansSemiBold);
  const mono = await pdfDoc.embedFont(fonts.monoRegular);
  const monoBold = await pdfDoc.embedFont(fonts.monoSemiBold);
  const serif = await pdfDoc.embedFont(fonts.serifRegular);
  const logoImage = await embedLogo(pdfDoc, business.logoDataUrl);

  const brandColor = hexToRgb(business.brandColor || '#064E3B');
  const ink = rgb(0.07, 0.08, 0.075);
  const muted = rgb(0.36, 0.39, 0.37);
  const hairline = rgb(0.87, 0.84, 0.76);

  const width = 595.28;
  const height = 841.89;
  const margin = 48;
  const contentWidth = width - margin * 2;
  let page = pdfDoc.addPage([width, height]);
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: brandColor });

  let y = height - 56;
  if (logoImage) {
    const dims = logoImage.scaleToFit(46, 46);
    page.drawImage(logoImage, { x: margin, y: y - dims.height + 10, width: dims.width, height: dims.height });
  }
  const hx = logoImage ? margin + 58 : margin;
  page.drawText(safeText(business.name), { x: hx, y: y - 2, size: 22, font: serif, color: ink });
  page.drawText(`Daily Cash Book Summary · ${formatLagosDateOnly(dayView.date)}`, {
    x: hx,
    y: y - 22,
    size: 10,
    font: sansBold,
    color: brandColor,
  });

  const statusTag = dayView.isClosed ? 'CLOSED DAY' : 'OPEN DAY';
  const stW = monoBold.widthOfTextAtSize(statusTag, 9);
  page.drawText(statusTag, { x: width - margin - stW, y: y - 2, size: 9, font: monoBold, color: brandColor });
  const dateTag = dayView.date;
  const dtW = mono.widthOfTextAtSize(dateTag, 9);
  page.drawText(dateTag, { x: width - margin - dtW, y: y - 16, size: 9, font: mono, color: muted });

  y -= 44;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: hairline });
  y -= 24;

  const totalSales =
    dayView.receiptSalesKobo + dayView.quickSalesKobo + dayView.creditSalesGivenKobo;
  const summaryRows: Array<[string, string, boolean?]> = [
    ['Opening Cash Balance', formatKobo(dayView.openingCashKobo, business.currency)],
    ['Receipt Sales (Cash/Transfer/POS received)', formatKobo(dayView.receiptSalesKobo, business.currency)],
    ['Quick Sales (without receipt)', formatKobo(dayView.quickSalesKobo, business.currency)],
    ['Debt Payments Received', formatKobo(dayView.paymentsReceivedKobo, business.currency)],
    ['New Credit Given (owed)', formatKobo(dayView.creditSalesGivenKobo, business.currency)],
    ['Total Sales Value', formatKobo(totalSales, business.currency), true],
    ['Money In (Total received)', formatKobo(dayView.moneyInTotalKobo, business.currency)],
    ['Money Out (Expenses)', formatKobo(dayView.moneyOutTotalKobo, business.currency)],
    ['Net (money in minus money out)', formatKobo(dayView.netKobo, business.currency), true],
    ['Cash in Hand (Expected Closing Cash)', formatKobo(dayView.closingCashInHandKobo, business.currency), true],
    ['Transfer In / Out', `${formatKobo(dayView.transferInKobo, business.currency)} / ${formatKobo(dayView.transferOutKobo, business.currency)}`],
    ['POS / Card In / Out', `${formatKobo(dayView.posInKobo, business.currency)} / ${formatKobo(dayView.posOutKobo, business.currency)}`],
  ];

  if (dayView.closure) {
    summaryRows.push(
      ['Actual Cash Counted', formatKobo(dayView.closure.countedCashKobo, business.currency), true],
      [
        'Over / Short Variance',
        `${dayView.closure.varianceKobo >= 0 ? '+' : '-'}${formatKobo(Math.abs(dayView.closure.varianceKobo), business.currency)}`,
        true,
      ]
    );
  }

  for (const [label, val, bold] of summaryRows) {
    page.drawText(label, { x: margin, y, size: bold ? 10 : 9.5, font: bold ? sansBold : sans, color: bold ? ink : muted });
    const vw = (bold ? monoBold : mono).widthOfTextAtSize(val, bold ? 10 : 9.5);
    page.drawText(val, { x: width - margin - vw, y, size: bold ? 10 : 9.5, font: bold ? monoBold : mono, color: ink });
    y -= 16;
  }

  if (dayView.closure?.note) {
    y -= 4;
    for (const nl of wrapLines(`Close-day note: ${dayView.closure.note}`, sans, 9, contentWidth)) {
      page.drawText(nl, { x: margin, y, size: 9, font: sans, color: muted });
      y -= 12;
    }
  }

  y -= 14;
  page.drawRectangle({
    x: margin,
    y: y - 4,
    width: contentWidth,
    height: 20,
    color: rgb(0.95, 0.94, 0.9),
  });
  page.drawText('TYPE / NOTE', { x: margin + 8, y: y + 2, size: 7.5, font: sansBold, color: muted });
  page.drawText('METHOD', { x: margin + 265, y: y + 2, size: 7.5, font: sansBold, color: muted });
  page.drawText('IN / OUT', { x: margin + 335, y: y + 2, size: 7.5, font: sansBold, color: muted });
  const balHdrW = sansBold.widthOfTextAtSize('RUNNING BAL', 7.5);
  page.drawText('RUNNING BAL', { x: width - margin - 8 - balHdrW, y: y + 2, size: 7.5, font: sansBold, color: muted });
  y -= 20;

  if (dayView.rows.length === 0) {
    page.drawText('No entries recorded for this day.', { x: margin + 8, y, size: 9, font: sans, color: muted });
    y -= 18;
  } else {
    for (const row of dayView.rows) {
      if (y < 90) {
        page = pdfDoc.addPage([width, height]);
        page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
        y = height - 56;
      }
      const label = safeText(row.entry.note || row.entry.entryKind).slice(0, 44);
      page.drawText(label || row.entry.entryType, { x: margin + 8, y, size: 8.5, font: sans, color: ink });
      page.drawText(safeText(row.entry.paymentMethod || 'Cash'), { x: margin + 265, y, size: 8.5, font: mono, color: muted });
      const flowText =
        row.moneyInKobo > 0
          ? `+${formatKobo(row.moneyInKobo, business.currency)}`
          : row.moneyOutKobo > 0
          ? `-${formatKobo(row.moneyOutKobo, business.currency)}`
          : formatKobo(row.entry.amountKobo, business.currency) + ' (credit)';
      page.drawText(flowText, { x: margin + 335, y, size: 8.5, font: mono, color: ink });
      const rb = formatKobo(row.runningBalanceKobo, business.currency);
      const rbW = monoBold.widthOfTextAtSize(rb, 8.5);
      page.drawText(rb, { x: width - margin - 8 - rbW, y, size: 8.5, font: monoBold, color: ink });
      y -= 15;
    }
  }

  const footerY = 42;
  drawTallyIcon(page, margin, footerY, 14, brandColor);
  page.drawText('Tallymark Digital Cash Book', { x: margin + 20, y: footerY + 4, size: 9, font: sansBold, color: ink });
  page.drawText(`Generated ${formatLagosDateTime(new Date().toISOString())} (WAT)`, {
    x: margin + 170,
    y: footerY + 4,
    size: 8,
    font: mono,
    color: muted,
  });

  return pdfDoc.save();
}

export async function downloadDailySummaryPdf(business: BusinessProfile, dayView: CashBookDayView) {
  const bytes = await generateDailySummaryPdfBytes(business, dayView);
  triggerPdfDownload(bytes, `tallymark-daily-${dayView.date}.pdf`);
}

export async function generateReportSummaryPdfBytes(
  business: BusinessProfile,
  report: ReportsSummary
): Promise<Uint8Array> {
  const [{ PDFDocument, rgb, fontkit }, fonts] = await Promise.all([
    loadPdfDeps(),
    getFontBytes(),
  ]);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const sans = await pdfDoc.embedFont(fonts.sansRegular);
  const sansBold = await pdfDoc.embedFont(fonts.sansSemiBold);
  const mono = await pdfDoc.embedFont(fonts.monoRegular);
  const monoBold = await pdfDoc.embedFont(fonts.monoSemiBold);
  const serif = await pdfDoc.embedFont(fonts.serifRegular);
  const logoImage = await embedLogo(pdfDoc, business.logoDataUrl);

  const brandColor = hexToRgb(business.brandColor || '#064E3B');
  const ink = rgb(0.07, 0.08, 0.075);
  const muted = rgb(0.36, 0.39, 0.37);
  const hairline = rgb(0.87, 0.84, 0.76);

  const width = 595.28;
  const height = 841.89;
  const margin = 48;
  const page = pdfDoc.addPage([width, height]);
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: brandColor });

  let y = height - 56;
  if (logoImage) {
    const dims = logoImage.scaleToFit(44, 44);
    page.drawImage(logoImage, { x: margin, y: y - dims.height + 10, width: dims.width, height: dims.height });
  }
  const hx = logoImage ? margin + 56 : margin;
  page.drawText(safeText(business.name), { x: hx, y: y - 2, size: 22, font: serif, color: ink });
  page.drawText(`Financial Summary Report · ${report.dateFrom} to ${report.dateTo}`, {
    x: hx,
    y: y - 22,
    size: 10,
    font: sansBold,
    color: brandColor,
  });

  y -= 44;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: hairline });
  y -= 24;

  const kpis: Array<[string, string, boolean?]> = [
    ['Total Sales Value (Receipts + Quick + Credit)', formatKobo(report.salesTotalKobo, business.currency)],
    ['Money In (Received in period)', formatKobo(report.moneyInTotalKobo, business.currency)],
    ['Expenses (Money Out)', formatKobo(report.expensesTotalKobo, business.currency)],
    ['Net (money in minus money out)', formatKobo(report.netMoneyInMinusOutKobo, business.currency), true],
    ['Total Outstanding Debts (current)', formatKobo(report.outstandingDebtsKobo, business.currency)],
  ];

  for (const [label, val, bold] of kpis) {
    page.drawText(label, { x: margin, y, size: bold ? 10.5 : 9.5, font: bold ? sansBold : sans, color: bold ? ink : muted });
    const vw = (bold ? monoBold : mono).widthOfTextAtSize(val, bold ? 10.5 : 9.5);
    page.drawText(val, { x: width - margin - vw, y, size: bold ? 10.5 : 9.5, font: bold ? monoBold : mono, color: ink });
    y -= 17;
  }

  const drawSection = (title: string, rows: Array<[string, string]>) => {
    y -= 10;
    if (y < 110) return;
    page.drawText(title, { x: margin, y, size: 9, font: sansBold, color: brandColor });
    y -= 14;
    if (rows.length === 0) {
      page.drawText('No records in this period.', { x: margin, y, size: 8.5, font: sans, color: muted });
      y -= 14;
      return;
    }
    for (const [left, right] of rows.slice(0, 8)) {
      if (y < 90) break;
      page.drawText(safeText(left).slice(0, 48), { x: margin, y, size: 9, font: sans, color: ink });
      const rw = mono.widthOfTextAtSize(right, 9);
      page.drawText(right, { x: width - margin - rw, y, size: 9, font: mono, color: ink });
      y -= 14;
    }
  };

  drawSection(
    'BY PAYMENT METHOD (IN / OUT)',
    report.byPaymentMethod.map((m) => [
      m.method,
      `In ${formatKobo(m.inKobo, business.currency)} · Out ${formatKobo(m.outKobo, business.currency)}`,
    ])
  );

  drawSection(
    'EXPENSES BY CATEGORY',
    report.byExpenseCategory.map((c) => [
      `${c.category} (${c.count})`,
      formatKobo(c.totalKobo, business.currency),
    ])
  );

  drawSection(
    'SALES BY STAFF / SOLD BY',
    report.bySoldBy.map((s) => [
      `${s.soldBy} (${s.count})`,
      formatKobo(s.salesKobo, business.currency),
    ])
  );

  drawSection(
    'TOP CUSTOMERS',
    report.topCustomers.map((c) => [
      `${c.customerName} (${c.count})`,
      formatKobo(c.totalKobo, business.currency),
    ])
  );

  const footerY = 42;
  drawTallyIcon(page, margin, footerY, 14, brandColor);
  page.drawText('Tallymark · Reports Summary', { x: margin + 20, y: footerY + 4, size: 9, font: sansBold, color: ink });
  page.drawText(`Generated ${formatLagosDateTime(new Date().toISOString())} (WAT)`, {
    x: margin + 170,
    y: footerY + 4,
    size: 8,
    font: mono,
    color: muted,
  });

  return pdfDoc.save();
}

export async function downloadReportSummaryPdf(business: BusinessProfile, report: ReportsSummary) {
  const bytes = await generateReportSummaryPdfBytes(business, report);
  triggerPdfDownload(bytes, `tallymark-report-${report.dateFrom}-to-${report.dateTo}.pdf`);
}
