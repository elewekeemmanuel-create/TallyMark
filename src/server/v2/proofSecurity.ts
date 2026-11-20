import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

export const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB

export type VerifiedProofMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export interface VerifiedProofResult {
  mime: VerifiedProofMime;
  ext: '.jpg' | '.png' | '.webp' | '.pdf';
  sanitizedBytes: Buffer;
  sizeBytes: number;
}

const EPHEMERAL_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

function getProofSigningKey(): string {
  return process.env.SESSION_SECRET || process.env.BOT_CHECK_SECRET || EPHEMERAL_SIGNING_KEY;
}

export function getPrivateProofBaseDir(): string {
  const dataDir = process.env.TALLYMARK_DATA_DIR
    ? path.resolve(process.env.TALLYMARK_DATA_DIR)
    : path.resolve(process.cwd(), 'data');
  const proofDir = path.resolve(dataDir, 'private-claim-proofs');
  fs.mkdirSync(proofDir, { recursive: true, mode: 0o700 });
  return proofDir;
}

/**
 * Strictly confines any relative proof path (e.g. "<businessId>/<random>.jpg")
 * inside the private proof directory using path.resolve + trailing path.sep boundary check.
 */
export function resolveConfinedProofPath(relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0') || relativePath.includes('..')) {
    return null;
  }
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!/^[a-zA-Z0-9_-]{1,80}\/[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(normalized)) {
    return null;
  }
  const baseDir = getPrivateProofBaseDir();
  const resolved = path.resolve(baseDir, normalized);
  if (!resolved.startsWith(baseDir + path.sep)) {
    return null;
  }
  return resolved;
}

function hasExecutableOrScriptHeader(buf: Buffer): boolean {
  if (buf.length < 4) return true;
  // ELF executable
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true;
  // Windows PE / MZ executable
  if (buf[0] === 0x4d && buf[1] === 0x5a) return true;
  // Mach-O binaries
  if (
    (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && (buf[3] === 0xce || buf[3] === 0xcf)) ||
    ((buf[0] === 0xce || buf[0] === 0xcf) && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe)
  ) {
    return true;
  }
  // ZIP / JAR / APK / DOCX archive
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) return true;
  // Shebang script (#!)
  if (buf[0] === 0x23 && buf[1] === 0x21) return true;

  // HTML / SVG / XML / PHP / JS text starts
  const head = buf.subarray(0, Math.min(buf.length, 512)).toString('latin1').trimStart().toLowerCase();
  if (
    head.startsWith('<html') ||
    head.startsWith('<!doctype') ||
    head.startsWith('<svg') ||
    head.startsWith('<?xml') ||
    head.startsWith('<?php') ||
    head.startsWith('<script')
  ) {
    return true;
  }
  return false;
}

function containsPolyglotPayload(buf: Buffer, allowedKind: 'jpeg' | 'png' | 'webp' | 'pdf'): boolean {
  // Check for embedded script/HTML/PHP/executable markers that indicate polyglots
  const lowerLatin = buf.toString('latin1').toLowerCase();
  const forbiddenStrings = [
    '<script',
    '</script>',
    '<?php',
    '<html',
    '<!doctype html',
    '<svg',
    'javascript:',
    'onerror=',
    'onload=',
  ];
  for (const marker of forbiddenStrings) {
    if (lowerLatin.includes(marker)) {
      return true;
    }
  }
  // Reject ZIP local file header or ELF magic embedded inside images/PDFs (classic polyglot)
  if (buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])) !== -1) {
    return true;
  }
  if (buf.indexOf(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) !== -1) {
    return true;
  }
  // Reject PDF embedded inside an image
  if (allowedKind !== 'pdf' && buf.indexOf(Buffer.from('%PDF-', 'ascii')) !== -1) {
    return true;
  }
  return false;
}

/**
 * Strips EXIF/XMP/IPTC/Comment segments from JPEG while preserving exact image frames & entropy data.
 * Also validates full SOI -> SOS -> EOI structure and rejects trailing polyglot payloads.
 */
function sanitizeAndVerifyJpeg(buf: Buffer): Buffer {
  if (buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    throw new Error('Invalid JPEG file');
  }
  if (containsPolyglotPayload(buf, 'jpeg')) {
    throw new Error('File rejected: unsafe embedded content detected');
  }

  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let offset = 2;
  let sawSof = false;
  let sawSos = false;
  let sawEoi = false;

  while (offset < buf.length) {
    if (buf[offset] !== 0xff) {
      throw new Error('Corrupted JPEG marker structure');
    }
    while (offset < buf.length && buf[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= buf.length) break;
    const marker = buf[offset];
    offset += 1;

    // EOI
    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9]));
      sawEoi = true;
      break;
    }

    // Standalone restart markers or TEM
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(Buffer.from([0xff, marker]));
      continue;
    }

    if (offset + 2 > buf.length) {
      throw new Error('Truncated JPEG segment');
    }
    const segLen = buf.readUInt16BE(offset);
    if (segLen < 2 || offset + segLen > buf.length) {
      throw new Error('Invalid JPEG segment length');
    }

    const segEnd = offset + segLen;

    // SOF markers (Baseline / Progressive / etc.)
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      sawSof = true;
    }

    // Strip ALL APP1..APP15 (EXIF, XMP, Adobe, IPTC, ICC) and COM (0xFE) metadata segments
    const isMetadataSegment = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;

    if (marker === 0xda) {
      // Start of Scan: copy header + scan entropy-coded stream up to real EOI (FF D9)
      sawSos = true;
      const scanHeader = Buffer.concat([Buffer.from([0xff, marker]), buf.subarray(offset, segEnd)]);
      out.push(scanHeader);
      offset = segEnd;

      const scanStart = offset;
      let eoiPos = -1;
      while (offset < buf.length - 1) {
        if (buf[offset] === 0xff) {
          const next = buf[offset + 1];
          if (next === 0x00) {
            // Byte-stuffed 0xFF inside entropy stream
            offset += 2;
            continue;
          }
          if (next >= 0xd0 && next <= 0xd7) {
            // Restart marker inside scan
            offset += 2;
            continue;
          }
          if (next === 0xff) {
            offset += 1;
            continue;
          }
          if (next === 0xd9) {
            eoiPos = offset;
            break;
          }
          // Another marker (multi-scan progressive JPEG)
          break;
        }
        offset += 1;
      }

      if (eoiPos !== -1) {
        out.push(buf.subarray(scanStart, eoiPos + 2));
        offset = eoiPos + 2;
        sawEoi = true;
        break;
      } else {
        out.push(buf.subarray(scanStart, offset));
        continue;
      }
    } else if (!isMetadataSegment) {
      out.push(Buffer.concat([Buffer.from([0xff, marker]), buf.subarray(offset, segEnd)]));
    }

    offset = segEnd;
  }

  if (!sawSof || !sawSos || !sawEoi) {
    throw new Error('Incomplete or invalid JPEG image');
  }

  // Reject trailing polyglot payloads after EOI
  const trailing = buf.length - offset;
  if (trailing > 16) {
    throw new Error('File rejected: unexpected trailing data after image end');
  }

  return Buffer.concat(out);
}

// Standard CRC-32 table for PNG chunk verification
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_SAFE_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS']);

/**
 * Verifies PNG signature, chunk structure, CRC32 checksums, absence of trailing bytes,
 * and strips ALL metadata chunks (tEXt, zTXt, iTXt, eXIf, tIME, pHYs, etc.).
 */
function sanitizeAndVerifyPng(buf: Buffer): Buffer {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG file');
  }
  if (containsPolyglotPayload(buf, 'png')) {
    throw new Error('File rejected: unsafe embedded content detected');
  }

  const out: Buffer[] = [PNG_SIG];
  let offset = 8;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;

  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkEnd = offset + 12 + len;
    if (chunkEnd > buf.length || len > MAX_PROOF_BYTES) {
      throw new Error('Truncated or invalid PNG chunk');
    }

    const typeAndData = buf.subarray(offset + 4, offset + 8 + len);
    const expectedCrc = buf.readUInt32BE(offset + 8 + len);
    const actualCrc = crc32(typeAndData);
    if (actualCrc !== expectedCrc) {
      throw new Error('Corrupted PNG checksum');
    }

    if (type === 'IHDR') {
      if (sawIhdr || len !== 13) throw new Error('Invalid PNG header');
      sawIhdr = true;
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (len !== 0) throw new Error('Invalid PNG end chunk');
      sawIend = true;
    }

    if (PNG_SAFE_CHUNKS.has(type)) {
      out.push(buf.subarray(offset, chunkEnd));
    }

    offset = chunkEnd;
    if (sawIend) break;
  }

  if (!sawIhdr || !sawIdat || !sawIend) {
    throw new Error('Incomplete PNG image');
  }
  if (offset !== buf.length) {
    throw new Error('File rejected: unexpected trailing data after PNG end');
  }

  return Buffer.concat(out);
}

/**
 * Verifies RIFF/WEBP container, checks exact length (rejecting trailing polyglots),
 * and strips EXIF/XMP/metadata chunks while rebuilding exact RIFF length.
 */
function sanitizeAndVerifyWebp(buf: Buffer): Buffer {
  if (
    buf.length < 20 ||
    buf.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buf.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    throw new Error('Invalid WebP file');
  }
  if (containsPolyglotPayload(buf, 'webp')) {
    throw new Error('File rejected: unsafe embedded content detected');
  }

  const declaredSize = buf.readUInt32LE(4) + 8;
  if (declaredSize !== buf.length && declaredSize + 1 !== buf.length) {
    throw new Error('File rejected: WebP size mismatch or trailing data');
  }

  const keptChunks: Buffer[] = [];
  let offset = 12;
  let sawImageChunk = false;

  while (offset + 8 <= declaredSize) {
    const fourcc = buf.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buf.readUInt32LE(offset + 4);
    const paddedSize = chunkSize + (chunkSize % 2);
    const chunkEnd = offset + 8 + paddedSize;
    if (chunkEnd > buf.length) {
      throw new Error('Truncated WebP chunk');
    }

    if (fourcc === 'VP8 ' || fourcc === 'VP8L' || fourcc === 'ANMF') {
      sawImageChunk = true;
    }

    // Strip EXIF and XMP metadata chunks
    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      offset = chunkEnd;
      continue;
    }

    const chunkCopy = Buffer.from(buf.subarray(offset, chunkEnd));
    if (fourcc === 'VP8X' && chunkSize >= 10) {
      // Clear EXIF (bit 3 = 0x08) and XMP (bit 2 = 0x04) flags in VP8X header byte
      chunkCopy[8] = chunkCopy[8] & ~(0x08 | 0x04);
    }

    keptChunks.push(chunkCopy);
    offset = chunkEnd;
  }

  if (!sawImageChunk) {
    throw new Error('Invalid WebP image data');
  }

  const payload = Buffer.concat(keptChunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + payload.length, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, payload]);
}

/**
 * Verifies PDF starts at offset 0 with %PDF-, rejects active scripts/polyglots,
 * structurally parses with pdf-lib, clears all document metadata, and re-serializes cleanly.
 */
async function sanitizeAndVerifyPdf(buf: Buffer): Promise<Buffer> {
  if (buf.length < 32 || !buf.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
    throw new Error('Invalid PDF file');
  }
  if (containsPolyglotPayload(buf, 'pdf')) {
    throw new Error('File rejected: unsafe content in PDF');
  }

  const rawText = buf.toString('latin1');
  const eofIdx = rawText.lastIndexOf('%%EOF');
  if (eofIdx === -1 || buf.length - (eofIdx + 5) > 64) {
    throw new Error('File rejected: invalid PDF trailer or trailing payload');
  }

  // Block dangerous active PDF dictionary actions
  const dangerousPdfTokens = [
    /\/JavaScript\b/i,
    /\/JS\b/i,
    /\/Launch\b/i,
    /\/OpenAction\b/i,
    /\/AA\b/i,
    /\/RichMedia\b/i,
    /\/EmbeddedFile\b/i,
    /\/XFA\b/i,
  ];
  for (const rx of dangerousPdfTokens) {
    if (rx.test(rawText)) {
      throw new Error('File rejected: active scripts or embedded files are not allowed in PDF proof');
    }
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: false });
  } catch {
    throw new Error('Invalid or password-protected PDF file');
  }

  if (pdfDoc.getPageCount() < 1 || pdfDoc.getPageCount() > 30) {
    throw new Error('PDF proof must have between 1 and 30 pages');
  }

  // Strip document metadata completely
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');
  // Remove XMP Metadata stream from Catalog if present
  try {
    const { PDFName } = await import('pdf-lib');
    pdfDoc.catalog.delete(PDFName.of('Metadata'));
  } catch {
    // ignore if absent
  }

  const cleaned = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(cleaned);
}

/**
 * Inspects magic bytes, rejects wrong types / oversized files / executables / polyglots,
 * strips metadata, and returns clean sanitized bytes + canonical MIME & extension.
 */
export async function verifyAndSanitizeProof(rawBytes: Buffer): Promise<VerifiedProofResult> {
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length === 0) {
    throw new Error('Proof file is empty');
  }
  if (rawBytes.length > MAX_PROOF_BYTES) {
    throw new Error('Proof file is too large. Maximum size is 5 MB.');
  }
  if (hasExecutableOrScriptHeader(rawBytes)) {
    throw new Error('Unsupported file type. Upload a JPEG, PNG, WebP image, or PDF.');
  }

  // 1. JPEG magic bytes: FF D8 FF
  if (rawBytes[0] === 0xff && rawBytes[1] === 0xd8 && rawBytes[2] === 0xff) {
    const sanitized = sanitizeAndVerifyJpeg(rawBytes);
    return { mime: 'image/jpeg', ext: '.jpg', sanitizedBytes: sanitized, sizeBytes: sanitized.length };
  }

  // 2. PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (rawBytes.length >= 8 && rawBytes.subarray(0, 8).equals(PNG_SIG)) {
    const sanitized = sanitizeAndVerifyPng(rawBytes);
    return { mime: 'image/png', ext: '.png', sanitizedBytes: sanitized, sizeBytes: sanitized.length };
  }

  // 3. WebP magic bytes: RIFF....WEBP
  if (
    rawBytes.length >= 12 &&
    rawBytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    rawBytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    const sanitized = sanitizeAndVerifyWebp(rawBytes);
    return { mime: 'image/webp', ext: '.webp', sanitizedBytes: sanitized, sizeBytes: sanitized.length };
  }

  // 4. PDF magic bytes: %PDF-
  if (rawBytes.length >= 5 && rawBytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
    const sanitized = await sanitizeAndVerifyPdf(rawBytes);
    return {
      mime: 'application/pdf',
      ext: '.pdf',
      sanitizedBytes: sanitized,
      sizeBytes: sanitized.length,
    };
  }

  throw new Error('Unsupported file type. Upload a JPEG, PNG, WebP image, or PDF.');
}

/**
 * Stores sanitized proof bytes under a random 128-bit hex filename inside the private proof directory.
 */
export function storePrivateProofFile(
  businessId: string,
  ext: '.jpg' | '.png' | '.webp' | '.pdf',
  bytes: Buffer
): string {
  const safeBiz = businessId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeBiz) {
    throw new Error('Invalid business identifier');
  }
  const randomName = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const relativePath = `${safeBiz}/${randomName}`;
  const targetPath = resolveConfinedProofPath(relativePath);
  if (!targetPath) {
    throw new Error('Invalid proof storage path');
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(targetPath, bytes, { mode: 0o600 });
  return relativePath;
}

export function deletePrivateProofFile(relativePath: string): boolean {
  const resolved = resolveConfinedProofPath(relativePath);
  if (!resolved) return false;
  try {
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function createSignedProofUrlParams(
  claimId: string,
  businessId: string,
  proofPath: string,
  ttlSeconds = 120
): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${claimId}:${businessId}:${proofPath}:${exp}`;
  const sig = crypto.createHmac('sha256', getProofSigningKey()).update(payload).digest('hex');
  return { exp, sig };
}

export function verifySignedProofUrlParams(
  claimId: string,
  businessId: string,
  proofPath: string,
  expRaw: string | undefined,
  sigRaw: string | undefined
): boolean {
  if (!expRaw || !sigRaw) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const payload = `${claimId}:${businessId}:${proofPath}:${exp}`;
  const expected = crypto.createHmac('sha256', getProofSigningKey()).update(payload).digest('hex');
  const a = Buffer.from(sigRaw, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
