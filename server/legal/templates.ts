import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import {
  amountToWordsNairaBeforeCurrencySuffix,
  buildIllustrativeTemplateValues,
  type LegalTemplateValues,
} from "./values";
import type { LegalCorrectionIssue } from "../../shared/legal-errors";

export type LegalDocumentType = "deed_of_assignment" | "transfer_exit_rights";

export const LEGAL_TEMPLATE_PLACEHOLDERS = {
  deed_of_assignment: [
    "USER_FULL_NAME",
    "USER_HOME_ADDRESS",
    "PROPERTY_AREA_SQM",
    "PAYMENT_AMOUNT_NAIRA_NUMERIC",
    "PAYMENT_AMOUNT_NAIRA_WORDS",
    "DOCUMENT_DATE",
  ],
  transfer_exit_rights: [
    "USER_FULL_NAME",
    "USER_HOME_ADDRESS",
    "PROPERTY_AREA_SQM",
    "DOCUMENT_DATE",
  ],
} as const satisfies Record<LegalDocumentType, readonly string[]>;

const DOCUMENT_DATE_PARTS = [
  "DOCUMENT_DATE_DAY",
  "DOCUMENT_DATE_MONTH",
  "DOCUMENT_DATE_YEAR",
] as const;
const ALLOWED_PLACEHOLDERS = new Set<string>(
  [...Object.values(LEGAL_TEMPLATE_PLACEHOLDERS).flat(), ...DOCUMENT_DATE_PARTS],
);
const MAX_DOCX_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;

export interface LegalTemplateValidation {
  documentType: LegalDocumentType;
  placeholderCounts: Record<string, number>;
  totalPlaceholders: number;
}

export interface LegalTemplateValidationOptions {
  /** Retained for callers; complete legacy split-date tokens are also accepted. */
  requireCanonicalDate?: boolean;
}

export interface LegalTemplateFieldMetadata {
  token: string;
  label: string;
  meaning: string;
  source: string;
  format: string;
  count: number;
}

type LegalTemplateCorrectionIssue = LegalCorrectionIssue;

const FIELD_DESCRIPTIONS: Record<keyof LegalTemplateValues, Omit<LegalTemplateFieldMetadata, "token" | "count">> = {
  USER_FULL_NAME: { label: "Investor full name", meaning: "The investor's verified legal name.", source: "Approved KYC full name, frozen at holding confirmation", format: "Text" },
  USER_HOME_ADDRESS: { label: "Investor home address", meaning: "The investor's verified residential address.", source: "Approved KYC address, frozen at holding confirmation", format: "Text" },
  PROPERTY_AREA_SQM: { label: "Allocated land area", meaning: "The area allocated to this confirmed holding.", source: "Confirmed units × the property's confirmed square metres per unit", format: "Square metres, grouped number with up to 2 decimal places" },
  PAYMENT_AMOUNT_NAIRA_NUMERIC: { label: "Payment amount (number)", meaning: "The approved full purchase payment in Naira.", source: "Approved payment amount frozen at holding confirmation", format: "Grouped Naira amount with up to 2 kobo digits" },
  PAYMENT_AMOUNT_NAIRA_WORDS: { label: "Payment amount (words)", meaning: "The same approved payment written in words.", source: "Approved payment amount frozen at holding confirmation", format: "Naira and Kobo in words; adapts to an existing literal Naira suffix" },
  DOCUMENT_DATE: { label: "Document date", meaning: "The effective date of this legal document.", source: "Frozen holding approval effective timestamp (UTC)", format: "Ordinal day, full month and four-digit year" },
  DOCUMENT_DATE_DAY: { label: "Document day", meaning: "Day component of the effective document date.", source: "Frozen holding approval effective timestamp (UTC)", format: "Ordinal day, e.g. 30th" },
  DOCUMENT_DATE_MONTH: { label: "Document month", meaning: "Month component of the effective document date.", source: "Frozen holding approval effective timestamp (UTC)", format: "Full month name" },
  DOCUMENT_DATE_YEAR: { label: "Document year", meaning: "Year component of the effective document date.", source: "Frozen holding approval effective timestamp (UTC)", format: "Four-digit year" },
};

/** Reports only tokens actually present, including tokens split across Word runs. */
export function getLegalTemplateFieldMetadata(
  buffer: Buffer,
  documentType: LegalDocumentType,
): {
  fields: LegalTemplateFieldMetadata[];
  issues: string[];
  correctionIssues: LegalTemplateCorrectionIssue[];
} {
  let zip: PizZip;
  try {
    zip = inspectLegalDocxArchive(buffer);
  } catch (error) {
    if (error instanceof LegalTemplateValidationError) {
      return { fields: [], issues: error.issues, correctionIssues: error.correctionIssues };
    }
    const validationError = corruptArchiveError();
    return {
      fields: [],
      issues: validationError.issues,
      correctionIssues: validationError.correctionIssues,
    };
  }
  let parsed: PlaceholderScanResult;
  try {
    parsed = getPlaceholderCounts(zip);
  } catch {
    const validationError = corruptArchiveError();
    return {
      fields: [],
      issues: validationError.issues,
      correctionIssues: validationError.correctionIssues,
    };
  }
  const correctionIssues = [...parsed.correctionIssues];
  try {
    validateLegalTemplate(buffer, documentType);
  } catch (error) {
    if (error instanceof LegalTemplateValidationError) {
      correctionIssues.push(...error.correctionIssues);
    } else {
      const validationError = corruptArchiveError();
      correctionIssues.push(...validationError.correctionIssues);
    }
  }
  const deduplicatedIssues = deduplicateCorrectionIssues(correctionIssues);
  return {
    fields: Object.entries(parsed.counts).map(([token, count]) => ({
      token,
      ...FIELD_DESCRIPTIONS[token as keyof LegalTemplateValues],
      count,
    })),
    issues: Array.from(new Set(deduplicatedIssues.map((issue) => issue.message))),
    correctionIssues: deduplicatedIssues,
  };
}

export class LegalTemplateValidationError extends Error {
  readonly issues: string[];
  readonly correctionIssues: LegalTemplateCorrectionIssue[];

  constructor(issues: Array<string | LegalTemplateCorrectionIssue>) {
    const correctionIssues = issues.map((issue) =>
      typeof issue === "string" ? genericCorrectionIssue(issue) : issue,
    );
    super(`Legal template validation failed: ${correctionIssues.map((issue) => issue.message).join("; ")}`);
    this.name = "LegalTemplateValidationError";
    this.correctionIssues = deduplicateCorrectionIssues(correctionIssues);
    this.issues = Array.from(new Set(this.correctionIssues.map((issue) => issue.message)));
  }
}

function genericCorrectionIssue(message: string): LegalTemplateCorrectionIssue {
  return {
    code: "template_validation",
    message,
    instruction: "Review the DOCX template and correct the reported validation issue.",
  };
}

function deduplicateCorrectionIssues(
  issues: LegalTemplateCorrectionIssue[],
): LegalTemplateCorrectionIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify([
      issue.code,
      issue.message,
      issue.token,
      issue.location,
      issue.excerpt,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function correctionIssue(
  code: string,
  message: string,
  instruction: string,
  details: Partial<Pick<LegalTemplateCorrectionIssue, "token" | "location" | "excerpt">> = {},
): LegalTemplateCorrectionIssue {
  return { code, message, instruction, ...details };
}

function corruptArchiveError(): LegalTemplateValidationError {
  return new LegalTemplateValidationError([
    correctionIssue(
      "corrupt_docx",
      "File is not a readable DOCX archive",
      "Open the original in Microsoft Word and save a fresh Word Document (.docx). If Word cannot open it, obtain an intact copy from the author. Renaming another file format does not repair it.",
      { location: "DOCX archive" },
    ),
  ]);
}

export class LegalTemplateRenderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LegalTemplateRenderError";
  }
}

/**
 * Checks ZIP metadata before asking PizZip or Docxtemplater to inflate XML.
 * Templates are untrusted admin uploads, so reject traversal paths, huge
 * entries, macro payloads, and pathological compression ratios up front.
 */
export function inspectLegalDocxArchive(buffer: Buffer): PizZip {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_DOCX_BYTES) {
    throw new LegalTemplateValidationError([
      correctionIssue(
        "file_size",
        `DOCX must be between 1 byte and ${MAX_DOCX_BYTES} bytes`,
        `Upload a DOCX file no larger than ${MAX_DOCX_BYTES / (1024 * 1024)} MB.`,
        { location: "DOCX upload" },
      ),
    ]);
  }

  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch {
    throw corruptArchiveError();
  }

  const entries = Object.entries(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new LegalTemplateValidationError([
      correctionIssue(
        "archive_size",
        "DOCX archive contains too many entries",
        "Remove unnecessary embedded content and save a simpler DOCX file.",
        { location: "DOCX archive" },
      ),
    ]);
  }

  let uncompressedTotal = 0;
  for (const [name, file] of entries) {
    const normalized = name.replace(/\\/g, "/");
    const segments = normalized.split("/");
    const metadata = (file as any)._data as
      | { compressedSize?: number; uncompressedSize?: number }
      | undefined;

    if (
      name.includes("\\") ||
      normalized.startsWith("/") ||
      /^[a-z]:/i.test(normalized) ||
      segments.some((segment) => segment === "." || segment === "..") ||
      normalized.includes("\0")
    ) {
      throw new LegalTemplateValidationError([
        correctionIssue(
          "unsafe_archive",
          "Unsafe DOCX archive entry detected",
          "Remove unsafe or unexpected archive content and upload a clean DOCX exported from Word.",
          { location: "DOCX archive" },
        ),
      ]);
    }

    if (/vbaProject\.bin$/i.test(normalized) || /macroEnabled/i.test(normalized)) {
      throw new LegalTemplateValidationError([
        correctionIssue(
          "unsafe_archive",
          "Macro-enabled Word files are not accepted",
          "Remove macros and save the document as a standard .docx file.",
          { location: "DOCX archive" },
        ),
      ]);
    }

    const uncompressedSize = Number(metadata?.uncompressedSize ?? 0);
    const compressedSize = Number(metadata?.compressedSize ?? 0);
    if (!Number.isFinite(uncompressedSize) || uncompressedSize < 0 || uncompressedSize > MAX_ENTRY_BYTES) {
      throw new LegalTemplateValidationError([
        correctionIssue(
          "archive_size",
          "DOCX archive contains an oversized part",
          "Reduce embedded content and save a smaller DOCX file.",
          { location: "DOCX archive" },
        ),
      ]);
    }
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new LegalTemplateValidationError([
        correctionIssue(
          "archive_size",
          "DOCX archive expands beyond the allowed size",
          "Reduce embedded content and upload a DOCX with a smaller uncompressed size.",
          { location: "DOCX archive" },
        ),
      ]);
    }
    if (
      uncompressedSize > 1024 * 1024 &&
      compressedSize > 0 &&
      uncompressedSize / compressedSize > 250
    ) {
      throw new LegalTemplateValidationError([
        correctionIssue(
          "unsafe_archive",
          "DOCX archive entry has a suspicious compression ratio",
          "Re-export the document from Word and upload the clean DOCX file.",
          { location: "DOCX archive" },
        ),
      ]);
    }
  }

  if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) {
    throw new LegalTemplateValidationError([
      correctionIssue(
        "corrupt_docx",
        "DOCX is missing required Word document parts",
        "Upload a complete, valid Word document saved as .docx.",
        { location: "DOCX archive" },
      ),
    ]);
  }

  return zip;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function collectParagraphText(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const paragraph of Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g))) {
    const text = Array.from(paragraph[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
      .map((node) => decodeXmlText(node[1]))
      .join("");
    paragraphs.push(text);
  }
  return paragraphs;
}

function readWordXmlParts(zip: PizZip): Array<{ name: string; xml: string }> {
  const parts: Array<{ name: string; xml: string }> = [];
  try {
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir || !/^word\/.*\.xml$/i.test(name)) continue;
      parts.push({ name, xml: file.asText() });
    }
  } catch {
    throw corruptArchiveError();
  }
  return parts;
}

interface PlaceholderScanResult {
  counts: Record<string, number>;
  correctionIssues: LegalTemplateCorrectionIssue[];
}

function friendlyPartName(name: string): string {
  if (/^word\/document\.xml$/i.test(name)) return "Main document";
  const header = name.match(/^word\/header(\d*)\.xml$/i);
  if (header) return header[1] ? `Header ${header[1]}` : "Header";
  const footer = name.match(/^word\/footer(\d*)\.xml$/i);
  if (footer) return footer[1] ? `Footer ${footer[1]}` : "Footer";
  if (/^word\/footnotes\.xml$/i.test(name)) return "Footnotes";
  if (/^word\/endnotes\.xml$/i.test(name)) return "Endnotes";
  if (/^word\/comments\.xml$/i.test(name)) return "Comments";
  return "Other Word document part";
}

function makeExcerpt(text: string, start: number, length: number): string {
  const maxLength = 160;
  if (text.length <= maxLength) return text;
  const tokenLength = Math.min(length, maxLength - 8);
  let excerptStart = Math.max(0, start - Math.floor((maxLength - tokenLength) / 2));
  let excerptEnd = Math.min(text.length, excerptStart + maxLength);
  excerptStart = Math.max(0, excerptEnd - maxLength);
  if (start + tokenLength > excerptEnd) {
    excerptEnd = Math.min(text.length, start + tokenLength + 24);
    excerptStart = Math.max(0, excerptEnd - maxLength);
  }
  return `${excerptStart > 0 ? "…" : ""}${text.slice(excerptStart, excerptEnd)}${
    excerptEnd < text.length ? "…" : ""
  }`;
}

function getPlaceholderCounts(zip: PizZip): PlaceholderScanResult {
  const counts: Record<string, number> = {};
  const correctionIssues: LegalTemplateCorrectionIssue[] = [];

  for (const part of readWordXmlParts(zip)) {
    const paragraphs = collectParagraphText(part.xml);
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      const paragraph = paragraphs[paragraphIndex];
      const location = `${friendlyPartName(part.name)}, paragraph ${paragraphIndex + 1}`;
      let cursor = 0;
      while (cursor < paragraph.length) {
        const open = paragraph.indexOf("{{", cursor);
        const closeOnly = paragraph.indexOf("}}", cursor);
        if (open < 0 && closeOnly < 0) break;

        if (closeOnly >= 0 && (open < 0 || closeOnly < open)) {
          const rawToken = "}}";
          correctionIssues.push(correctionIssue(
            "malformed_placeholder",
            `Malformed or unclosed placeholder in ${location}: ${rawToken}`,
            "Correct or remove the unmatched closing braces so every placeholder uses the form {{TOKEN_NAME}}.",
            {
              token: rawToken,
              location,
              excerpt: makeExcerpt(paragraph, closeOnly, rawToken.length),
            },
          ));
          cursor = closeOnly + 2;
          continue;
        }

        const end = paragraph.indexOf("}}", open + 2);
        const rawToken = end < 0 ? paragraph.slice(open) : paragraph.slice(open, end + 2);
        const value = end < 0 ? paragraph.slice(open + 2) : paragraph.slice(open + 2, end);
        const token = value.trim();
        if (end < 0 || !/^[A-Z][A-Z0-9_]*$/.test(token)) {
          correctionIssues.push(correctionIssue(
            "malformed_placeholder",
            `Malformed or unclosed placeholder in ${location}: ${rawToken}`,
            "Use a complete placeholder with a supported uppercase token, for example {{USER_FULL_NAME}}.",
            {
              token: rawToken,
              location,
              excerpt: makeExcerpt(paragraph, open, rawToken.length),
            },
          ));
        } else if (!ALLOWED_PLACEHOLDERS.has(token)) {
          correctionIssues.push(correctionIssue(
            "unsupported_placeholder",
            `Unsupported placeholder in ${location}: ${rawToken}`,
            "Replace this token with one of the supported legal template fields.",
            {
              token,
              location,
              excerpt: makeExcerpt(paragraph, open, rawToken.length),
            },
          ));
        } else {
          counts[token] = (counts[token] || 0) + 1;
        }
        cursor = end < 0 ? paragraph.length : end + 2;
      }
    }
  }

  return { counts, correctionIssues };
}

/**
 * Validate a template before saving/activating it. Repeated legal fields are
 * supported: the supplied deeds intentionally repeat names, area, and amount.
 * Each document type has its own required field set to match the source form.
 */
export function validateLegalTemplate(
  buffer: Buffer,
  documentType: LegalDocumentType,
  options: LegalTemplateValidationOptions = {},
): LegalTemplateValidation {
  let zip: PizZip;
  try {
    zip = inspectLegalDocxArchive(buffer);
  } catch (error) {
    if (error instanceof LegalTemplateValidationError) throw error;
    throw corruptArchiveError();
  }

  // Embedded third-party signatures are source content, not investor signing
  // evidence. Their presence (with or without an execution heading) is allowed.
  let scan: PlaceholderScanResult;
  try {
    scan = getPlaceholderCounts(zip);
  } catch {
    throw corruptArchiveError();
  }
  const placeholderCounts = scan.counts;
  const correctionIssues = [...scan.correctionIssues];
  for (const required of LEGAL_TEMPLATE_PLACEHOLDERS[documentType]) {
    if (
      required === "DOCUMENT_DATE" &&
      DOCUMENT_DATE_PARTS.every((part) => placeholderCounts[part] > 0)
    ) {
      // The existing wording can use separate day/month/year tokens.
      continue;
    }
    if (!placeholderCounts[required]) {
      correctionIssues.push(correctionIssue(
        "missing_required_placeholder",
        `Required placeholder is missing: {{${required}}}`,
        required === "DOCUMENT_DATE"
          ? "Add {{DOCUMENT_DATE}} to the date clause, or include all three supported date fields: {{DOCUMENT_DATE_DAY}}, {{DOCUMENT_DATE_MONTH}} and {{DOCUMENT_DATE_YEAR}}."
          : `Add {{${required}}} to the appropriate clause in the Word template.`,
        { token: required },
      ));
    }
  }

  if (correctionIssues.length > 0) {
    throw new LegalTemplateValidationError(deduplicateCorrectionIssues(correctionIssues));
  }
  return {
    documentType,
    placeholderCounts,
    totalPlaceholders: Object.values(placeholderCounts).reduce((total, count) => total + count, 0),
  };
}

/** Reject a DOCX that still contains a dynamic template delimiter. */
export function assertLegalTemplateIsRendered(buffer: Buffer): void {
  const zip = inspectLegalDocxArchive(buffer);
  const unresolvedParts = readWordXmlParts(zip)
    .filter((part) =>
      collectParagraphText(part.xml).some((paragraph) => /\{\{|\}\}/.test(paragraph)),
    )
    .map((part) => part.name);
  if (unresolvedParts.length > 0) {
    throw new LegalTemplateRenderError(
      `Unresolved template delimiters remain in: ${Array.from(new Set(unresolvedParts)).join(", ")}`,
    );
  }
}

function assertValues(
  tokens: string[],
  values: LegalTemplateValues,
): void {
  const missing = tokens
    .filter((key) => {
      const value = values[key as keyof LegalTemplateValues];
      return typeof value !== "string" || value.trim().length === 0;
    });
  if (missing.length > 0) {
    throw new LegalTemplateRenderError(
      `Missing trusted document values: ${missing.join(", ")}`,
    );
  }
}

/**
 * Render dynamic values using Docxtemplater's run-aware Word renderer. Unlike
 * replacing whole paragraphs, this preserves surrounding run/paragraph/table
 * formatting, including tags split over multiple Word runs.
 */
export function renderLegalTemplate(
  templateBuffer: Buffer,
  documentType: LegalDocumentType,
  values: LegalTemplateValues,
): Buffer {
  const validation = validateLegalTemplate(templateBuffer, documentType);
  assertValues(Object.keys(validation.placeholderCounts), values);

  try {
    const zip = inspectLegalDocxArchive(templateBuffer);
    const hasLiteralCurrencySuffix = specializeLiteralCurrencySuffix(zip);
    const renderValues: Record<string, string> = { ...values };
    if (hasLiteralCurrencySuffix) {
      renderValues.PAYMENT_AMOUNT_NAIRA_WORDS_WITH_SUFFIX =
        amountToWordsNairaBeforeCurrencySuffix(values.PAYMENT_AMOUNT_NAIRA_NUMERIC);
    }
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => {
        throw new Error("A required template value was not provided");
      },
    });
    doc.render(renderValues);
    const rendered = doc.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    assertLegalTemplateIsRendered(rendered);
    return rendered;
  } catch (error) {
    if (error instanceof LegalTemplateRenderError) throw error;
    throw new LegalTemplateRenderError(
      `Unable to render ${documentType} Word template${error instanceof Error ? `: ${error.message}` : ""}`,
      { cause: error },
    );
  }
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function replaceAcrossWordRuns(
  paragraphXml: string,
  replacements: ReadonlyArray<{ source: string; target: string; followedBy?: string }>,
): string {
  const openTag = /<w:t(?:\s[^>]*)?>/g;
  const textNodes: Array<{ start: number; end: number; text: string; tag: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = openTag.exec(paragraphXml))) {
    const close = paragraphXml.indexOf("</w:t>", openTag.lastIndex);
    if (close < 0) break;
    textNodes.push({
      start: openTag.lastIndex,
      end: close,
      text: decodeXmlText(paragraphXml.slice(openTag.lastIndex, close)),
      tag: match[0],
    });
    openTag.lastIndex = close + "</w:t>".length;
  }

  for (const replacement of replacements) {
    let combined = textNodes.map((node) => node.text).join("");
    const matchPositions: number[] = [];
    let searchFrom = 0;
    while (true) {
      const index = combined.indexOf(replacement.source, searchFrom);
      if (index < 0) break;
      if (
        replacement.followedBy &&
        !combined.startsWith(replacement.followedBy, index + replacement.source.length)
      ) {
        searchFrom = index + replacement.source.length;
        continue;
      }
      matchPositions.push(index);
      searchFrom = index + replacement.source.length;
    }

    for (const start of matchPositions.reverse()) {
      const end = start + replacement.source.length;
      let cursor = 0;
      let startNode = -1;
      let endNode = -1;
      let startOffset = 0;
      let endOffset = 0;
      for (let i = 0; i < textNodes.length; i += 1) {
        const nodeEnd = cursor + textNodes[i].text.length;
        if (startNode < 0 && start >= cursor && start < nodeEnd) {
          startNode = i;
          startOffset = start - cursor;
        }
        if (end > cursor && end <= nodeEnd) {
          endNode = i;
          endOffset = end - cursor;
          break;
        }
        cursor = nodeEnd;
      }
      if (startNode < 0 || endNode < 0) continue;

      for (let i = startNode; i <= endNode; i += 1) {
        const original = textNodes[i].text;
        if (startNode === endNode) {
          textNodes[i].text =
            original.slice(0, startOffset) +
            replacement.target +
            original.slice(endOffset);
        } else if (i === startNode) {
          textNodes[i].text = original.slice(0, startOffset) + replacement.target;
        } else if (i === endNode) {
          textNodes[i].text = original.slice(endOffset);
        } else {
          textNodes[i].text = "";
        }
      }
      combined = textNodes.map((node) => node.text).join("");
    }
  }

  let result = "";
  let cursor = 0;
  for (const node of textNodes) {
    result += paragraphXml.slice(cursor, node.start);
    result += escapeXmlText(node.text);
    cursor = node.end;
  }
  return result + paragraphXml.slice(cursor);
}

/**
 * Keep every literal currency word in the uploaded clause. Give only tokens
 * immediately followed by the source's fixed " Naira" suffix a distinct
 * rendering value, so Kobo amounts can be written as an exact fraction of a
 * Naira without deleting or duplicating that legal text.
 */
function specializeLiteralCurrencySuffix(zip: PizZip): boolean {
  const replacement = {
    source: "{{PAYMENT_AMOUNT_NAIRA_WORDS}}",
    target: "{{PAYMENT_AMOUNT_NAIRA_WORDS_WITH_SUFFIX}}",
    followedBy: " Naira",
  };
  let found = false;
  for (const part of readWordXmlParts(zip)) {
    const normalized = part.xml.replace(
      /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
      (paragraphXml) => {
        const visibleParagraph = collectParagraphText(paragraphXml)[0] ?? "";
        if (!visibleParagraph.includes(`${replacement.source}${replacement.followedBy}`)) {
          return paragraphXml;
        }
        const rendered = replaceAcrossWordRuns(paragraphXml, [replacement]);
        if (rendered !== paragraphXml) found = true;
        return rendered;
      },
    );
    if (normalized !== part.xml) zip.file(part.name, normalized);
  }
  return found;
}

/**
 * Convert only the legacy arithmetic/date fields in the supplied source files.
 * Static legal wording—including the literal Naira suffix—and source graphics,
 * media, relationships and layout are left unchanged.
 * Date parts remain distinct to preserve the literal "DAY OF" construction
 * and are derived with the canonical date from one UTC timestamp.
 */
export function normalizeSuppliedLegalTemplate(buffer: Buffer): Buffer {
  const zip = inspectLegalDocxArchive(buffer);
  const replacements = [
    { source: "{{NUM_UNITS_OWNED*5}}", target: "{{PROPERTY_AREA_SQM}}" },
    { source: "{{CURRENT_DAY}}", target: "{{DOCUMENT_DATE_DAY}}" },
    { source: "{{CURRENT_MONTH}}", target: "{{DOCUMENT_DATE_MONTH}}" },
    { source: "{{CURRENT_YEAR}}", target: "{{DOCUMENT_DATE_YEAR}}" },
  ];

  for (const part of readWordXmlParts(zip)) {
    if (!replacements.some((item) => part.xml.includes(item.source))) continue;
    const normalized = part.xml.replace(
      /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
      (paragraphXml) => replaceAcrossWordRuns(paragraphXml, replacements),
    );
    zip.file(part.name, normalized);
  }

  return zip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export interface IllustrativeLegalTemplatePreview {
  documentType: LegalDocumentType;
  label: "ILLUSTRATIVE PREVIEW — NOT FOR EXECUTION OR SIGNATURE";
  renderedDocx: Buffer;
}

export function renderIllustrativeLegalTemplate(
  templateBuffer: Buffer,
  documentType: LegalDocumentType,
): IllustrativeLegalTemplatePreview {
  return {
    documentType,
    label: "ILLUSTRATIVE PREVIEW — NOT FOR EXECUTION OR SIGNATURE",
    renderedDocx: renderLegalTemplate(
      templateBuffer,
      documentType,
      buildIllustrativeTemplateValues(documentType),
    ),
  };
}

export function getLegalTemplateFilename(documentType: LegalDocumentType): string {
  return documentType === "deed_of_assignment"
    ? "deed_of_assignment.docx"
    : "transfer_exit_rights.docx";
}
