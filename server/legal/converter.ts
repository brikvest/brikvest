import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertLegalTemplateIsRendered } from "./templates";
import { assertDocxFontsAvailable, LegalFontValidationError } from "./font-validation";
import { prepareLegalDocxTypography } from "./typography";
import type { FontFamilyResolver } from "./font-validation";

const PDF_MAGIC = Buffer.from("%PDF-");
const PROCESS_OUTPUT_LIMIT = 4 * 1024 * 1024;

export class LegalPdfConversionError extends Error {
  constructor(message: string, options?: ErrorOptions, public kind: "service" | "fonts" | "recovery-fonts" | "font-metadata" | "font-service" = "service") {
    super(message, options);
    this.name = "LegalPdfConversionError";
  }
}

export class SignaturePositionValidationError extends Error {
  constructor(message: string, options?: ErrorOptions, public kind: "service" | "layout" = "service") {
    super(message, options);
    this.name = "SignaturePositionValidationError";
  }
}

export interface ConvertDocxToPdfOptions {
  timeoutMs?: number;
  libreOfficePath?: string;
  /** Recovery must never produce a differently formatted PDF from an immutable DOCX. */
  preserveTypography?: boolean;
  resolveFontFamily?: FontFamilyResolver;
}

export function resolveLibreOfficeExecutable(
  libreOfficePath = process.env.LIBREOFFICE_PATH,
  sofficePath = process.env.SOFFICE_PATH,
): string {
  return libreOfficePath || sofficePath || "soffice";
}

export function prepareDocxForPdf(buffer: Buffer, resolveFamily?: FontFamilyResolver): Buffer {
  try {
    return prepareLegalDocxTypography(buffer, resolveFamily);
  } catch (error) {
    if (!(error instanceof LegalFontValidationError)) throw error;
    throw new LegalPdfConversionError(
      `Document typography preparation failed: ${error.message}`, { cause: error },
      error.kind === "metadata" ? "font-metadata" : error.kind === "service" ? "font-service" : "fonts",
    );
  }
}

export interface PdfTextPosition {
  templateVersionId: string;
  /** One-based page containing the assignee-specific signed heading. */
  signatureHeadingPageNumber?: number;
  /** One-based PDF page number; dimensions and coordinates are in PDF points. */
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  coordinateSystem: "pdf-points-top-left";
  anchorText: string;
}

export interface VerifyAssigneeSignaturePositionOptions {
  assigneeFullName: string;
  templateVersionId: string;
  pdftotextPath?: string;
  timeoutMs?: number;
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  failureLabel: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (error?: Error) => {
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
      if (stdout.length > PROCESS_OUTPUT_LIMIT) {
        child.kill("SIGKILL");
        settle(new Error(`${failureLabel} produced excessive output`));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > PROCESS_OUTPUT_LIMIT) stderr = stderr.slice(-PROCESS_OUTPUT_LIMIT);
    });
    child.on("error", (error) => {
      settle(
        new Error(
          `${failureLabel} could not start${(error as NodeJS.ErrnoException).code === "ENOENT" ? " (required executable is missing)" : ""}`,
          { cause: error },
        ),
      );
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code === 0) return settle();
      settle(
        new Error(
          `${failureLabel} exited with ${signal ? `signal ${signal}` : `code ${code}`}${stderr.trim() ? `: ${stderr.trim().slice(-1_000)}` : ""}`,
        ),
      );
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(new Error(`${failureLabel} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    timeout.unref?.();
  });
}

/**
 * Convert the rendered Word document using real LibreOffice. There is no HTML
 * or handcrafted-PDF fallback: failure to start or complete conversion is a
 * hard error so callers cannot send or sign an incomplete document.
 */
export async function convertDocxToPdf(
  docxBuffer: Buffer,
  options: ConvertDocxToPdfOptions = {},
): Promise<Buffer> {
  assertLegalTemplateIsRendered(docxBuffer);
  // Identical policy in development, production and tests; no font bypass.
  if (options.preserveTypography) {
    try {
      assertDocxFontsAvailable(docxBuffer, options.resolveFontFamily);
    } catch (error) {
      throw new LegalPdfConversionError(
        `DOCX-to-PDF conversion blocked by font fidelity requirements: ${error instanceof Error ? error.message : "font requirements could not be verified"}`,
        { cause: error },
          error instanceof LegalFontValidationError && error.kind === "metadata" ? "font-metadata" :
          error instanceof LegalFontValidationError && error.kind === "service" ? "font-service" :
          options.preserveTypography ? "recovery-fonts" : "fonts",
      );
    }
  } else docxBuffer = prepareDocxForPdf(docxBuffer, options.resolveFontFamily);
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 5 * 60_000) {
    throw new LegalPdfConversionError("LibreOffice conversion timeout is invalid");
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "brikvest-legal-convert-"));
  const profile = path.join(workDir, "lo-profile");
  const inputPath = path.join(workDir, `source-${randomUUID()}.docx`);
  const outputPath = inputPath.replace(/\.docx$/i, ".pdf");
  const executable =
    options.libreOfficePath ||
    resolveLibreOfficeExecutable();

  try {
    await writeFile(inputPath, docxBuffer, { flag: "wx", mode: 0o600 });
    await runCommand(
      executable,
      [
        `-env:UserInstallation=${pathToFileUrl(profile)}`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inputPath,
      ],
      timeoutMs,
      "LibreOffice DOCX-to-PDF conversion",
    );

    let pdf: Buffer;
    try {
      pdf = await readFile(outputPath);
    } catch (error) {
      throw new LegalPdfConversionError(
        "LibreOffice completed without producing a PDF",
        { cause: error },
      );
    }
    if (pdf.length < 100 || !pdf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      throw new LegalPdfConversionError("LibreOffice produced an invalid PDF");
    }
    return pdf;
  } catch (error) {
    if (error instanceof LegalPdfConversionError) throw error;
    throw new LegalPdfConversionError(
      `DOCX-to-PDF conversion failed${error instanceof Error ? `: ${error.message}` : ""}`,
      { cause: error },
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${encodeURI(normalized)}`;
}

interface BboxWord {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

interface BboxPage {
  width: number;
  height: number;
  words: BboxWord[];
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(parseInt(code, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parsePdfBbox(output: string): BboxPage[] {
  const pages: BboxPage[] = [];
  for (const pageMatch of Array.from(output.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gi))) {
    const width = Number(pageMatch[1].match(/\bwidth="([^"]+)"/i)?.[1]);
    const height = Number(pageMatch[1].match(/\bheight="([^"]+)"/i)?.[1]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new SignaturePositionValidationError("PDF text extractor returned invalid page dimensions");
    }

    const words: BboxWord[] = [];
    for (const wordMatch of Array.from(pageMatch[2].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/gi))) {
      const read = (name: string) => Number(wordMatch[1].match(new RegExp(`\\b${name}="([^"]+)"`, "i"))?.[1]);
      const word = {
        text: decodeHtmlText(wordMatch[2]),
        xMin: read("xMin"),
        yMin: read("yMin"),
        xMax: read("xMax"),
        yMax: read("yMax"),
      };
      if (
        !word.text ||
        ![word.xMin, word.yMin, word.xMax, word.yMax].every(Number.isFinite) ||
        word.xMin < 0 ||
        word.yMin < 0 ||
        word.xMax < word.xMin ||
        word.yMax < word.yMin ||
        word.xMax > width + 2 ||
        word.yMax > height + 2
      ) {
        throw new SignaturePositionValidationError("PDF text extractor returned invalid word coordinates");
      }
      words.push(word);
    }
    pages.push({ width, height, words });
  }
  if (pages.length === 0) {
    throw new SignaturePositionValidationError("PDF text extractor found no readable pages");
  }
  return pages;
}

function normalizedWord(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("en-US")
    .replace(/[^A-Z0-9]/g, "");
}

function nameTokens(name: string): string[] {
  const tokens = name.split(/\s+/).map(normalizedWord).filter(Boolean);
  if (tokens.length === 0) {
    throw new SignaturePositionValidationError("Assignee's verified full name is required");
  }
  return tokens;
}

interface IndexedBboxWord {
  word: BboxWord;
  pageIndex: number;
  wordIndex: number;
  normalized: string;
}

interface MatchedName {
  words: IndexedBboxWord[];
  endIndex: number;
}

function assigneeHeadingLength(words: IndexedBboxWord[], start: number): number {
  if (words[start]?.normalized !== "BY" || words[start + 1]?.normalized !== "THE") {
    return 0;
  }
  if (
    words[start + 2]?.normalized === "WITHINNAMED" &&
    words[start + 3]?.normalized === "ASSIGNEE"
  ) {
    return 4;
  }
  if (
    words[start + 2]?.normalized === "WITHIN" &&
    words[start + 3]?.normalized === "NAMED" &&
    words[start + 4]?.normalized === "ASSIGNEE"
  ) {
    return 5;
  }
  return 0;
}

function matchNameAt(
  words: IndexedBboxWord[],
  start: number,
  expectedName: string[],
): MatchedName | null {
  let cursor = start;
  const matched: IndexedBboxWord[] = [];
  for (const expectedToken of expectedName) {
    let combined = "";
    let tokenMatched = false;
    while (cursor < words.length && combined.length < expectedToken.length) {
      const next = words[cursor];
      if (next.normalized.length === 0) {
        cursor += 1;
        continue;
      }
      combined += next.normalized;
      matched.push(next);
      cursor += 1;
      if (combined === expectedToken) {
        tokenMatched = true;
        break;
      }
      if (!expectedToken.startsWith(combined)) return null;
    }
    if (!tokenMatched) return null;
  }
  return matched.length > 0
    ? { words: matched, endIndex: cursor - 1 }
    : null;
}

function findAssigneeSignatureAnchor(
  pages: BboxPage[],
  fullName: string,
  templateVersionId: string,
): PdfTextPosition {
  const expectedName = nameTokens(fullName);
  const words = pages.flatMap((page, pageIndex) =>
    page.words.flatMap((word, wordIndex) => {
      const normalized = normalizedWord(word.text);
      return normalized
        ? [{ word, pageIndex, wordIndex, normalized }]
        : [];
    }),
  );
  const matches: PdfTextPosition[] = [];
  const forbiddenBlockWords = new Set([
    "ASSIGNOR",
    "BEFOREME",
    "COMMISSIONER",
    "DIRECTOR",
    "NOTARY",
    "PRESENCE",
    "WITNESS",
    "WITNESSES",
  ]);

  for (let headingIndex = 0; headingIndex <= words.length - 4; headingIndex += 1) {
    if (
      words[headingIndex].normalized !== "SIGNED" ||
      words[headingIndex + 1].normalized !== "SEALED" ||
      words[headingIndex + 2].normalized !== "AND" ||
      words[headingIndex + 3].normalized !== "DELIVERED"
    ) {
      continue;
    }

    const headingPageIndex = words[headingIndex].pageIndex;
    const searchLimit = Math.min(words.length, headingIndex + 20);
    for (let assigneeIndex = headingIndex + 4; assigneeIndex < searchLimit; assigneeIndex += 1) {
      const assigneeLength = assigneeHeadingLength(words, assigneeIndex);
      if (!assigneeLength) continue;
      const assigneeEndIndex = assigneeIndex + assigneeLength - 1;
      const nameStartIndex = assigneeEndIndex + 1;
      const matchedName = matchNameAt(words, nameStartIndex, expectedName);
      if (!matchedName) continue;

      const namePageIndex = words[nameStartIndex]?.pageIndex;
      const nameEndPageIndex = words[matchedName.endIndex]?.pageIndex;
      if (
        namePageIndex === undefined ||
        nameEndPageIndex !== namePageIndex ||
        (namePageIndex !== headingPageIndex && namePageIndex !== headingPageIndex + 1)
      ) {
        continue;
      }

      const page = pages[namePageIndex];
      const nameWords = matchedName.words.map((item) => item.word);
      const firstNameWord = nameWords[0];
      const lastNameWord = nameWords[nameWords.length - 1];
      if (!page || !firstNameWord || !lastNameWord) continue;
      const headingStart = words[headingIndex].word;
      const hasInterveningBlockLabel = words.some((word) => {
        if (
          !forbiddenBlockWords.has(word.normalized) ||
          word.pageIndex < headingPageIndex ||
          word.pageIndex > namePageIndex
        ) {
          return false;
        }
        if (word.pageIndex === headingPageIndex) {
          return word.word.yMin >= headingStart.yMin - 2;
        }
        if (word.pageIndex === namePageIndex) {
          return word.word.yMin <= firstNameWord.yMin + 2;
        }
        return true;
      });
      if (hasInterveningBlockLabel) continue;

      if (namePageIndex === headingPageIndex) {
        const assigneeWord = words[assigneeEndIndex].word;
        const verticalGap = firstNameWord.yMin - assigneeWord.yMax;
        if (verticalGap < -2 || verticalGap > 80) continue;
      } else {
        // A cross-page electronic-signature anchor is safe only when the
        // signed heading is the last text on page N and the assignee-only
        // heading/name block starts at the top of page N+1. Some source DOCX
        // layouts put "By the within-named ASSIGNEE" before the break; others
        // put that line just after the signed heading on the next page.
        const headingEnd = words[headingIndex + 3];
        const headingWords = words.slice(headingIndex, headingIndex + 4);
        const hasTrailingTextOnHeadingPage = pages[headingPageIndex].words.some(
          (word) =>
            !headingWords.some((headingWord) => headingWord.word === word) &&
            word.yMin >= headingStart.yMin - 2,
        );
        const assigneePageIndex = words[assigneeIndex].pageIndex;
        const assigneeWord = words[assigneeIndex].word;
        const assigneeAtPageTop = assigneeWord.yMin <= pages[assigneePageIndex].height * 0.35;
        const phraseHasTrailingText =
          assigneePageIndex === headingPageIndex &&
          pages[headingPageIndex].words.some(
            (word) =>
              !words.slice(assigneeIndex, assigneeEndIndex + 1)
                .some((phraseWord) => phraseWord.word === word) &&
              word.yMin >= words[assigneeIndex].word.yMin - 2,
          );
        const phraseBeforeBreak =
          assigneePageIndex === headingPageIndex &&
          words[assigneeEndIndex].pageIndex === headingPageIndex &&
          !phraseHasTrailingText;
        const phraseAfterBreak =
          assigneePageIndex === headingPageIndex + 1 &&
          words[assigneeEndIndex].pageIndex === headingPageIndex + 1 &&
          !hasTrailingTextOnHeadingPage &&
          assigneeAtPageTop;
        if (
          (!phraseBeforeBreak && !phraseAfterBreak) ||
          headingEnd.pageIndex !== headingPageIndex ||
          headingEnd.word.yMax < pages[headingPageIndex].height * 0.55 ||
          firstNameWord.yMin > page.height * 0.35
        ) {
          continue;
        }
      }

      const nameTop = Math.min(...nameWords.map((word) => word.yMin));
      const nameBottom = Math.max(...nameWords.map((word) => word.yMax));
      const xMin = Math.min(...nameWords.map((word) => word.xMin));
      const xMax = Math.max(...nameWords.map((word) => word.xMax));
      if (xMax <= xMin || nameBottom <= nameTop) continue;

      const padding = 3;
      const x = Math.max(0, Math.floor(xMin - padding));
      const y = Math.max(0, Math.floor(nameTop - padding));
      const right = Math.min(page.width, Math.ceil(xMax + padding));
      const bottom = Math.min(page.height, Math.ceil(nameBottom + padding));
      matches.push({
        templateVersionId,
        signatureHeadingPageNumber: headingPageIndex + 1,
        pageNumber: namePageIndex + 1,
        x,
        y,
        width: right - x,
        height: bottom - y,
        pageWidth: page.width,
        pageHeight: page.height,
        coordinateSystem: "pdf-points-top-left",
        anchorText: fullName,
      });
    }
  }

  if (matches.length !== 1) {
    throw new SignaturePositionValidationError(
      matches.length === 0
        ? "Could not verify a distinct assignee signature position in the generated PDF"
        : "Generated PDF contains ambiguous assignee signature positions",
      undefined,
      "layout",
    );
  }
  return matches[0];
}

/**
 * Verify that the current assignee's printed name is located immediately after
 * the assignee-specific signature section. The returned PDF-point rectangle
 * can be passed to a provider adapter; if text extraction or the expected
 * anchor is unavailable, signature creation must fail closed.
 */
export async function verifyAssigneeSignaturePosition(
  pdfBuffer: Buffer,
  options: VerifyAssigneeSignaturePositionOptions,
): Promise<PdfTextPosition> {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 100 || !pdfBuffer.subarray(0, 5).equals(PDF_MAGIC)) {
    throw new SignaturePositionValidationError("A valid generated PDF is required");
  }
  const assigneeFullName = options.assigneeFullName?.trim();
  if (!assigneeFullName) {
    throw new SignaturePositionValidationError("Assignee's verified full name is required");
  }
  const templateVersionId = options.templateVersionId?.trim();
  if (!templateVersionId || templateVersionId.length > 200) {
    throw new SignaturePositionValidationError("The exact template version is required for signature positioning");
  }
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new SignaturePositionValidationError("PDF text extraction timeout is invalid");
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "brikvest-legal-bbox-"));
  const pdfPath = path.join(workDir, "document.pdf");
  try {
    await writeFile(pdfPath, pdfBuffer, { flag: "wx", mode: 0o600 });
    let bbox: string;
    try {
      bbox = await runCommand(
        options.pdftotextPath || process.env.PDFTOTEXT_PATH || "pdftotext",
        ["-bbox", "-enc", "UTF-8", pdfPath, "-"],
        timeoutMs,
        "PDF signature-position check",
      );
    } catch (error) {
      throw new SignaturePositionValidationError(
        `Unable to verify assignee signature position${error instanceof Error ? `: ${error.message}` : ""}`,
        { cause: error },
      );
    }
    return findAssigneeSignatureAnchor(
      parsePdfBbox(bbox),
      assigneeFullName,
      templateVersionId,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
