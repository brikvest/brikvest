import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
} from "pdf-lib";
import { PNG } from "pngjs";
import { EvidenceTextLayout } from "./evidence-text-layout";

export const MAX_SIGNATURE_PNG_BYTES = 512 * 1024;
export const MAX_SIGNATURE_WIDTH = 1600;
export const MAX_SIGNATURE_HEIGHT = 600;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const PDF_TEXT_OUTPUT_LIMIT = 4 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export type SignaturePngDimensions = {
  width: number;
  height: number;
  inkPixelCount: number;
  inkBounds: { left: number; top: number; right: number; bottom: number };
};

export type LocalSignaturePlacement = {
  templateVersionId?: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  coordinateSystem?: string;
};

export type LocalSignedPdfInput = {
  unsignedPdf: Buffer;
  signaturePng: Buffer;
  placement: LocalSignaturePlacement;
  signerName: string;
  signatureMethod: "drawn" | "typed";
  documentType: string;
  operationId: number;
  unsignedPdfSha256: string;
  signaturePngSha256: string;
  signedAt: Date;
};

export type LocalSigningEvidencePdfInput = {
  documentType: string;
  documentId: number;
  pairId: number;
  operationId: number;
  reservationId: number;
  propertyName: string;
  propertyLocation: string;
  units: string;
  areaSqm: string;
  signerName: string;
  signatureMethod: "drawn" | "typed";
  renderFontSha256: string;
  unsignedPdfSha256: string;
  signedPdfSha256: string;
  signaturePngSha256: string;
  consentVersion: string;
  consentText: string;
  consentedAt: Date;
  reauthenticatedAt: Date;
  reviewedAt: Date;
  signedAt: Date;
};

export function sha256Hex(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function readPngUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Accept only small, ordinary 8-bit RGBA PNGs produced by a browser signature
 * canvas. Decode the pixels to reject a transparent/white blank canvas without
 * relying on the PDF renderer's more permissive image parser.
 */
export function validateSignaturePng(png: Buffer): SignaturePngDimensions {
  if (
    !Buffer.isBuffer(png) ||
    png.length < 45 ||
    png.length > MAX_SIGNATURE_PNG_BYTES ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    throw new Error("Draw a signature on the canvas and submit it as a PNG no larger than 512 KB.");
  }
  if (
    readPngUInt32(png, 8) !== 13 ||
    png.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("The signature PNG must start with a valid RGBA image header.");
  }
  // Check the untrusted IHDR before invoking the PNG decoder. This bounds its
  // decoded pixel allocation to at most 1600 × 600 × 4 bytes.
  const preflightWidth = readPngUInt32(png, 16);
  const preflightHeight = readPngUInt32(png, 20);
  if (
    preflightWidth < 2 || preflightHeight < 2 ||
    preflightWidth > MAX_SIGNATURE_WIDTH || preflightHeight > MAX_SIGNATURE_HEIGHT
  ) {
    throw new Error("The signature canvas must be no larger than 1600×600 pixels.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawImageDataEnd = false;
  let sawEnd = false;
  const allowedAncillaryChunks = new Set(["sRGB", "gAMA", "cHRM", "pHYs"]);

  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error("The signature PNG has a truncated chunk.");
    const length = readPngUInt32(png, offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (length > MAX_SIGNATURE_PNG_BYTES || dataEnd < dataStart || chunkEnd > png.length) {
      throw new Error("The signature PNG has invalid chunk bounds.");
    }
    const typeAndData = png.subarray(offset + 4, dataEnd);
    if (crc32(typeAndData) !== readPngUInt32(png, dataEnd)) {
      throw new Error("The signature PNG failed its chunk integrity check.");
    }
    const data = png.subarray(dataStart, dataEnd);

    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) {
        throw new Error("The signature PNG must start with a valid RGBA image header.");
      }
      sawHeader = true;
      width = readPngUInt32(data, 0);
      height = readPngUInt32(data, 4);
      if (
        width < 2 || height < 2 ||
        width > MAX_SIGNATURE_WIDTH || height > MAX_SIGNATURE_HEIGHT ||
        data[8] !== 8 || data[9] !== 6 || data[10] !== 0 ||
        data[11] !== 0 || data[12] !== 0
      ) {
        throw new Error("The signature canvas must be an 8-bit, non-interlaced RGBA PNG at most 1600×600.");
      }
    } else if (type === "IDAT") {
      if (sawImageDataEnd || sawEnd) throw new Error("The signature PNG has invalid image-data ordering.");
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || !sawImageData || sawEnd) {
        throw new Error("The signature PNG has an invalid end marker.");
      }
      sawImageDataEnd = true;
      sawEnd = true;
    } else if (allowedAncillaryChunks.has(type)) {
      if (sawImageData || sawEnd) {
        throw new Error("The signature PNG contains unexpected metadata after its image data.");
      }
    } else {
      // Reject animation, profiles, text metadata, and unknown chunks.
      throw new Error("The signature PNG contains unsupported or unsafe chunk data.");
    }

    offset = chunkEnd;
    if (sawEnd && offset !== png.length) {
      throw new Error("The signature PNG contains trailing data.");
    }
  }

  if (!sawEnd || !sawImageDataEnd || !sawHeader) {
    throw new Error("The signature PNG is incomplete.");
  }

  let decoded: ReturnType<typeof PNG.sync.read>;
  try {
    decoded = PNG.sync.read(png, { checkCRC: true, skipRescale: true });
  } catch {
    throw new Error("The signature PNG image data could not be safely decoded.");
  }
  if (
    decoded.width !== width ||
    decoded.height !== height ||
    decoded.colorType !== 6 ||
    decoded.depth !== 8 ||
    decoded.interlace !== false ||
    decoded.data.length !== width * height * 4
  ) {
    throw new Error("The signature PNG pixel data has an invalid size.");
  }

  let inkPixelCount = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  const pixels = decoded.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = x * 4;
      const rowOffset = y * width * 4;
      const alpha = pixels[rowOffset + pixel + 3];
      const luminance =
        pixels[rowOffset + pixel] * 0.2126 +
        pixels[rowOffset + pixel + 1] * 0.7152 +
        pixels[rowOffset + pixel + 2] * 0.0722;
      if (alpha >= 32 && luminance < 232) {
        inkPixelCount += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (inkPixelCount < 8 || right - left < 1 || bottom - top < 1) {
    throw new Error("The signature canvas is blank; draw a visible signature before continuing.");
  }
  return { width, height, inkPixelCount, inkBounds: { left, top, right, bottom } };
}

function safePrintable(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    if (codePoint >= 0x20 && codePoint <= 0x7e) return character;
    return `\\u{${codePoint.toString(16).toUpperCase()}}`;
  }).join("");
}

function safeUnicodeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

async function resolveUnicodeFont(): Promise<{ bytes: Buffer; sha256: string }> {
  let fontPath: string;
  try {
    fontPath = execFileSync(
      "fc-match",
      ["-f", "%{file}", "DejaVu Sans"],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 4_096, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch (error) {
    throw new Error(
      "A Unicode-capable PDF font is required for the local signing evidence PDF. Install fontconfig and DejaVu Sans, then retry.",
      { cause: error },
    );
  }
  if (!fontPath.startsWith("/") || fontPath.length > 4_096) {
    throw new Error("Fontconfig did not resolve a usable DejaVu Sans font for the evidence PDF.");
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(fontPath);
  } catch (error) {
    throw new Error(
      "The resolved DejaVu Sans font file is unavailable. Restore the evidence-renderer font and retry.",
      { cause: error },
    );
  }
  if (bytes.length < 1_000 || bytes.length > 16 * 1024 * 1024) {
    throw new Error("The resolved Unicode PDF font has an invalid size.");
  }
  return { bytes, sha256: sha256Hex(bytes) };
}

function assertFontSupportsText(font: fontkit.Font, text: string): void {
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (!/\s/.test(character) && !font.hasGlyphForCodePoint(codePoint)) {
      throw new Error(
        `The resolved evidence-renderer font cannot display U+${codePoint.toString(16).toUpperCase()} in the investor/holding text. Install a Unicode font with this glyph and retry.`,
      );
    }
  }
}

export async function getLocalSigningFontSha256(visibleText?: string): Promise<string> {
  const resolvedFont = await resolveUnicodeFont();
  if (visibleText !== undefined) {
    let glyphFont: fontkit.Font;
    try {
      glyphFont = fontkit.create(resolvedFont.bytes);
    } catch (error) {
      throw new Error("The resolved DejaVu Sans PDF font could not be loaded.", { cause: error });
    }
    assertFontSupportsText(glyphFont, visibleText);
  }
  return resolvedFont.sha256;
}

function safeDate(date: Date, name: string): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid persisted timestamp.`);
  }
  return new Date(date.getTime());
}

function validatePlacement(
  placement: LocalSignaturePlacement,
  page: PDFPage,
  pageCount: number,
): void {
  const coordinates = [
    placement.pageNumber, placement.x, placement.y, placement.width,
    placement.height, placement.pageWidth, placement.pageHeight,
  ];
  if (
    !coordinates.every(Number.isFinite) ||
    !Number.isInteger(placement.pageNumber) ||
    placement.pageNumber < 1 ||
    placement.pageNumber > pageCount ||
    placement.x < 0 || placement.y < 0 ||
    placement.width <= 0 || placement.height <= 0 ||
    placement.pageWidth <= 0 || placement.pageHeight <= 0 ||
    placement.x + placement.width > placement.pageWidth + 1 ||
    placement.y + placement.height > placement.pageHeight + 1 ||
    (placement.coordinateSystem && placement.coordinateSystem !== "pdf-points-top-left") ||
    Math.abs(page.getWidth() - placement.pageWidth) > 2 ||
    Math.abs(page.getHeight() - placement.pageHeight) > 2
  ) {
    throw new Error("The stored investor signature placement does not match the unsigned PDF page.");
  }
}

type PdfWordBounds = { xMin: number; yMin: number; xMax: number; yMax: number };
type PdfPageBounds = { width: number; height: number; words: PdfWordBounds[] };

function runPdfTextBounds(pdfPath: string, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.PDFTOTEXT_PATH || "pdftotext",
      ["-bbox", "-enc", "UTF-8", pdfPath, "-"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(stdout);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > PDF_TEXT_OUTPUT_LIMIT) {
        child.kill("SIGKILL");
        finish(new Error("PDF text-position extraction produced excessive output."));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > PDF_TEXT_OUTPUT_LIMIT) stderr = stderr.slice(-PDF_TEXT_OUTPUT_LIMIT);
    });
    child.on("error", (error) => finish(
      new Error(`Unable to check for a clear investor signature area: ${error.message}`, { cause: error }),
    ));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new Error(
          `Unable to check for a clear investor signature area${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ""}.`,
        ));
      } else {
        finish();
      }
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("PDF text-position extraction timed out."));
    }, timeoutMs);
    timeout.unref?.();
  });
}

function parsePdfPageBounds(output: string): PdfPageBounds[] {
  const pages: PdfPageBounds[] = [];
  const pagePattern = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi;
  const numberAttribute = (attributes: string, name: string): number => {
    const match = attributes.match(new RegExp(`\\b${name}="([0-9]+(?:\\.[0-9]+)?)"`));
    return match ? Number(match[1]) : Number.NaN;
  };
  let match: RegExpExecArray | null;
  while ((match = pagePattern.exec(output)) !== null) {
    const attrs = match[1] || "";
    const width = numberAttribute(attrs, "width");
    const height = numberAttribute(attrs, "height");
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("PDF text-position extraction returned invalid page bounds.");
    }
    const words: PdfWordBounds[] = [];
    const wordPattern = /<word\b([^>]*)>/gi;
    let word: RegExpExecArray | null;
    while ((word = wordPattern.exec(match[2] || "")) !== null) {
      const wordAttrs = word[1] || "";
      const bounds = {
        xMin: numberAttribute(wordAttrs, "xMin"),
        yMin: numberAttribute(wordAttrs, "yMin"),
        xMax: numberAttribute(wordAttrs, "xMax"),
        yMax: numberAttribute(wordAttrs, "yMax"),
      };
      if (
        !Object.values(bounds).every(Number.isFinite) ||
        bounds.xMax < bounds.xMin || bounds.yMax < bounds.yMin
      ) {
        throw new Error("PDF text-position extraction returned invalid word bounds.");
      }
      words.push(bounds);
    }
    pages.push({ width, height, words });
  }
  if (pages.length === 0 || pages.length > 200) {
    throw new Error("PDF text-position extraction did not return a valid page list.");
  }
  return pages;
}

async function safeSignatureStampBox(
  pdfBytes: Buffer,
  anchor: LocalSignaturePlacement,
): Promise<LocalSignaturePlacement> {
  const workDir = await mkdtemp(path.join(tmpdir(), "brikvest-local-signature-"));
  const pdfPath = path.join(workDir, "unsigned.pdf");
  try {
    await writeFile(pdfPath, pdfBytes, { flag: "wx", mode: 0o600 });
    const pages = parsePdfPageBounds(await runPdfTextBounds(pdfPath));
    const page = pages[anchor.pageNumber - 1];
    if (
      !page ||
      Math.abs(page.width - anchor.pageWidth) > 2 ||
      Math.abs(page.height - anchor.pageHeight) > 2
    ) {
      throw new Error("The verified assignee name page does not match the stored PDF geometry.");
    }

    const boxWidth = Math.min(180, Math.max(100, anchor.width), page.width - 24);
    const boxHeight = 28;
    const boxX = Math.max(12, Math.min(anchor.x, page.width - boxWidth - 12));
    const candidates = [
      { y: anchor.y - boxHeight - 5 },
      { y: anchor.y + anchor.height + 5 },
      { y: anchor.y - 22 - 4, height: 22 },
      { y: anchor.y + anchor.height + 4, height: 22 },
    ];
    for (const candidate of candidates) {
      const height = candidate.height || boxHeight;
      const y = candidate.y;
      if (y < 8 || y + height > page.height - 8) continue;
      const overlapsText = page.words.some((word) =>
        boxX < word.xMax &&
        boxX + boxWidth > word.xMin &&
        y < word.yMax &&
        y + height > word.yMin,
      );
      if (!overlapsText) {
        return {
          ...anchor,
          x: boxX,
          y,
          width: boxWidth,
          height,
        };
      }
    }
    throw new Error(
      "There is no clear signature area above or near the verified investor name without covering document text.",
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function renderLocallySignedPdf(input: LocalSignedPdfInput): Promise<Buffer> {
  if (
    !Buffer.isBuffer(input.unsignedPdf) ||
    input.unsignedPdf.length < 100 ||
    input.unsignedPdf.length > MAX_PDF_BYTES ||
    input.unsignedPdf.subarray(0, 5).toString() !== "%PDF-"
  ) {
    throw new Error("The original legal PDF is invalid or exceeds 25 MB.");
  }
  const pngInfo = validateSignaturePng(input.signaturePng);
  if (input.signatureMethod !== "drawn" && input.signatureMethod !== "typed") {
    throw new Error("Select a supported signature image method.");
  }
  if (sha256Hex(input.unsignedPdf) !== input.unsignedPdfSha256.toLowerCase()) {
    throw new Error("The unsigned PDF no longer matches the consented document digest.");
  }
  if (sha256Hex(input.signaturePng) !== input.signaturePngSha256.toLowerCase()) {
    throw new Error("The stored signature image no longer matches the consent evidence.");
  }
  if (!Number.isSafeInteger(input.operationId) || input.operationId < 1) {
    throw new Error("A valid local-signing operation ID is required.");
  }
  const signedAt = safeDate(input.signedAt, "Signing timestamp");

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(input.unsignedPdf, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    throw new Error("The original legal PDF could not be safely opened for local signing.");
  }
  if (document.getPageCount() < 1 || document.getPageCount() > 200) {
    throw new Error("The legal PDF has an invalid page count.");
  }

  const page = document.getPage(input.placement.pageNumber - 1);
  validatePlacement(input.placement, page, document.getPageCount());
  let stampBox: LocalSignaturePlacement;
  try {
    stampBox = await safeSignatureStampBox(input.unsignedPdf, input.placement);
  } catch (error) {
    throw new Error(
      `The investor name was verified, but local signature placement is unsafe: ${
        error instanceof Error ? error.message : "No clear signature area was found."
      }`,
      { cause: error },
    );
  }
  let image;
  try {
    image = await document.embedPng(input.signaturePng);
  } catch {
    throw new Error("The verified signature PNG could not be embedded into the legal PDF.");
  }
  const boxWidth = stampBox.width;
  const boxHeight = stampBox.height;
  const scale = Math.min(boxWidth / pngInfo.width, boxHeight / pngInfo.height);
  const imageWidth = pngInfo.width * scale;
  const imageHeight = pngInfo.height * scale;
  const left = stampBox.x + (boxWidth - imageWidth) / 2;
  const bottom = page.getHeight() - stampBox.y - stampBox.height +
    (boxHeight - imageHeight) / 2;
  page.drawImage(image, { x: left, y: bottom, width: imageWidth, height: imageHeight });

  document.setTitle(`${safePrintable(input.documentType)} — locally signed`);
  document.setAuthor("Brikvest");
  document.setCreator("Brikvest Local Legal Signing");
  document.setProducer("Brikvest Local Legal Renderer v1");
  document.setCreationDate(signedAt);
  document.setModificationDate(signedAt);
  document.setSubject(
    JSON.stringify({
      kind: "local-in-app-acknowledgment",
      operationId: input.operationId,
      signerName: input.signerName,
      signatureMethod: input.signatureMethod,
      unsignedPdfSha256: input.unsignedPdfSha256.toLowerCase(),
      signaturePngSha256: input.signaturePngSha256.toLowerCase(),
      signedAt: signedAt.toISOString(),
      externalExecutionSeparatelyRequired: true,
      qualifiedDigitalSignature: false,
      identityCertificate: false,
    }),
  );
  // The subject preserves the exact approved Unicode name; no lossy display
  // font or replacement characters are used for signer identity.
  document.setKeywords([
    `operation:${input.operationId}`,
    `unsigned-sha256:${input.unsignedPdfSha256.toLowerCase()}`,
    `signature-sha256:${input.signaturePngSha256.toLowerCase()}`,
    `image-method:${input.signatureMethod}`,
    "external-execution-separate",
    "not-qualified-digital-signature",
  ]);
  const bytes = Buffer.from(await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  }));
  if (bytes.length > MAX_PDF_BYTES) throw new Error("The locally signed legal PDF exceeds 25 MB.");
  return bytes;
}

export async function renderLocalSigningEvidencePdf(
  input: LocalSigningEvidencePdfInput,
): Promise<Buffer> {
  const dates = {
    consentedAt: safeDate(input.consentedAt, "Consent timestamp"),
    reauthenticatedAt: safeDate(input.reauthenticatedAt, "Reauthentication timestamp"),
    reviewedAt: safeDate(input.reviewedAt, "Review timestamp"),
    signedAt: safeDate(input.signedAt, "Signing timestamp"),
  };
  for (const [label, digest] of [
    ["Unsigned PDF", input.unsignedPdfSha256],
    ["Signed PDF", input.signedPdfSha256],
    ["Signature PNG", input.signaturePngSha256],
  ]) {
    if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error(`${label} digest is invalid.`);
  }
  if (input.signatureMethod !== "drawn" && input.signatureMethod !== "typed") {
    throw new Error("The saved signature image method is invalid.");
  }
  if (!SHA256_PATTERN.test(input.renderFontSha256)) {
    throw new Error("The persisted Unicode renderer font digest is invalid.");
  }
  const rendererFont = await resolveUnicodeFont();
  if (rendererFont.sha256 !== input.renderFontSha256.toLowerCase()) {
    throw new Error(
      "The Unicode PDF renderer font changed after consent was accepted. Restore the pinned DejaVu Sans font before recovery.",
    );
  }
  let glyphFont: fontkit.Font;
  try {
    glyphFont = fontkit.create(rendererFont.bytes);
  } catch (error) {
    throw new Error("The resolved DejaVu Sans PDF font could not be loaded.", { cause: error });
  }
  const visibleText = [
    input.signerName,
    input.propertyName,
    input.propertyLocation,
    input.units,
    input.areaSqm,
    input.documentType,
    input.consentText,
    input.consentVersion,
  ].join(" ");
  assertFontSupportsText(glyphFont, visibleText);

  const document = await PDFDocument.create({ updateMetadata: false });
  document.registerFontkit(fontkit);
  const font = await document.embedFont(rendererFont.bytes, { subset: true });
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([595.28, 841.89]);
  const margin = 48;
  let y = page.getHeight() - 58;
  page.drawText("BRIKVEST — LOCAL IN-APP SIGNING RECORD", {
    x: margin,
    y,
    size: 15,
    font: boldFont,
    color: rgb(0.08, 0.19, 0.32),
  });
  y -= 30;
  page.drawText("Evidence record — not an external or qualified signature certificate", {
    x: margin,
    y,
    size: 9,
    font,
    color: rgb(0.35, 0.4, 0.47),
  });
  y -= 28;

  const fields: Array<[string, string]> = [
    ["Status", "Investor in-app acknowledgment recorded"],
    ["Document", input.documentType.replace(/_/g, " ")],
    ["Approved investor name", input.signerName],
    ["Signature image method (investor-selected)", input.signatureMethod],
    ["Holding / reservation", String(input.reservationId)],
    ["Property", `${input.propertyName} — ${input.propertyLocation}`],
    ["Units", input.units],
    ["Area", `${input.areaSqm} sqm`],
    ["Document ID", String(input.documentId)],
    ["Pair ID", String(input.pairId)],
    ["Operation ID", String(input.operationId)],
    ["Unsigned PDF SHA-256", input.unsignedPdfSha256.toLowerCase()],
    ["Signed PDF SHA-256", input.signedPdfSha256.toLowerCase()],
    ["Signature PNG SHA-256", input.signaturePngSha256.toLowerCase()],
    ["Consent version", input.consentVersion],
    ["Consent accepted at (UTC)", dates.consentedAt.toISOString()],
    ["Password reauthenticated at (UTC)", dates.reauthenticatedAt.toISOString()],
    ["Document review confirmed at (UTC)", dates.reviewedAt.toISOString()],
    ["In-app signature recorded at (UTC)", dates.signedAt.toISOString()],
  ];
  const textLayout = new EvidenceTextLayout({
    document,
    firstPage: page,
    regularFont: font,
    boldFont,
    margin,
    startY: y,
  });
  for (const [label, value] of fields) textLayout.drawField(label, value);

  const disclaimer =
    "This record evidences a Brikvest in-app electronic acknowledgment only. It is not a " +
    "signature issued by a qualified trust service provider and is not an identity-verification " +
    "certificate. Any external execution, witness, attestation, notarization, registration, or " +
    "other statutory requirement remains separate and must be completed where applicable.";
  textLayout.drawSection("Consent text", input.consentText);
  textLayout.drawSection("Separate execution notice", disclaimer);
  textLayout.finish();

  document.setTitle("Brikvest local in-app signing evidence");
  document.setAuthor("Brikvest");
  document.setCreator("Brikvest Local Legal Signing");
  document.setProducer("Brikvest Local Legal Renderer v1");
  document.setCreationDate(dates.signedAt);
  document.setModificationDate(dates.signedAt);
  document.setSubject(
    JSON.stringify({
      kind: "local-in-app-acknowledgment",
      signerName: input.signerName,
      signatureMethod: input.signatureMethod,
      renderFontSha256: input.renderFontSha256.toLowerCase(),
      consentVersion: input.consentVersion,
      consentText: input.consentText,
      unsignedPdfSha256: input.unsignedPdfSha256.toLowerCase(),
      signedPdfSha256: input.signedPdfSha256.toLowerCase(),
      signaturePngSha256: input.signaturePngSha256.toLowerCase(),
      consentedAt: dates.consentedAt.toISOString(),
      reauthenticatedAt: dates.reauthenticatedAt.toISOString(),
      reviewedAt: dates.reviewedAt.toISOString(),
      signedAt: dates.signedAt.toISOString(),
      externalExecutionSeparatelyRequired: true,
      qualifiedDigitalSignature: false,
      identityCertificate: false,
    }),
  );
  const bytes = Buffer.from(await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  }));
  if (bytes.length > MAX_PDF_BYTES) throw new Error("The local signing evidence PDF exceeds 25 MB.");
  return bytes;
}
