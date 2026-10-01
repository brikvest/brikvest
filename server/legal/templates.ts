import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import path from "node:path";
import {
  amountToWordsNairaBeforeCurrencySuffix,
  buildIllustrativeTemplateValues,
  type LegalTemplateValues,
} from "./values";

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
): { fields: LegalTemplateFieldMetadata[]; issues: string[] } {
  let zip: PizZip;
  try {
    zip = inspectLegalDocxArchive(buffer);
  } catch (error) {
    if (error instanceof LegalTemplateValidationError) return { fields: [], issues: error.issues };
    throw error;
  }
  const issues: string[] = [];
  const counts = getPlaceholderCounts(zip, issues);
  try {
    validateLegalTemplate(buffer, documentType);
  } catch (error) {
    if (error instanceof LegalTemplateValidationError) issues.push(...error.issues);
    else throw error;
  }
  return {
    fields: Object.entries(counts).map(([token, count]) => ({
      token,
      ...FIELD_DESCRIPTIONS[token as keyof LegalTemplateValues],
      count,
    })),
    issues: Array.from(new Set(issues)),
  };
}

export class LegalTemplateValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Legal template validation failed: ${issues.join("; ")}`);
    this.name = "LegalTemplateValidationError";
    this.issues = issues;
  }
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
      `DOCX must be between 1 byte and ${MAX_DOCX_BYTES} bytes`,
    ]);
  }

  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch (error) {
    throw new LegalTemplateValidationError([
      `File is not a readable DOCX archive${error instanceof Error ? `: ${error.message}` : ""}`,
    ]);
  }

  const entries = Object.entries(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new LegalTemplateValidationError(["DOCX archive contains too many entries"]);
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
      throw new LegalTemplateValidationError([`Unsafe DOCX archive entry: ${name}`]);
    }

    if (/vbaProject\.bin$/i.test(normalized) || /macroEnabled/i.test(normalized)) {
      throw new LegalTemplateValidationError(["Macro-enabled Word files are not accepted"]);
    }

    const uncompressedSize = Number(metadata?.uncompressedSize ?? 0);
    const compressedSize = Number(metadata?.compressedSize ?? 0);
    if (!Number.isFinite(uncompressedSize) || uncompressedSize < 0 || uncompressedSize > MAX_ENTRY_BYTES) {
      throw new LegalTemplateValidationError([`DOCX archive entry is too large: ${name}`]);
    }
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new LegalTemplateValidationError(["DOCX archive expands beyond the allowed size"]);
    }
    if (
      uncompressedSize > 1024 * 1024 &&
      compressedSize > 0 &&
      uncompressedSize / compressedSize > 250
    ) {
      throw new LegalTemplateValidationError([`DOCX archive entry has a suspicious compression ratio: ${name}`]);
    }
  }

  if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) {
    throw new LegalTemplateValidationError(["DOCX is missing required Word document parts"]);
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

const EXECUTION_GRAPHIC_PATTERN =
  /<w:drawing\b[\s\S]*?<\/w:drawing\s*>|<w:pict\b[\s\S]*?<\/w:pict\s*>|<w:object\b[\s\S]*?<\/w:object\s*>|<w:objectLink\b[^>]*(?:\/>|>[\s\S]*?<\/w:objectLink\s*>)|<w:altChunk\b[^>]*\/?>|<v:shape\b[\s\S]*?<\/v:shape\s*>|<a:blip\b[^>]*\/?>|<v:imagedata\b[^>]*\/?>/gi;
const EXECUTION_HEADING = /SIGNED\s+SEALED\s+AND\s+DELIVERED/;

function isExecutionHeadingParagraph(paragraphXml: string): boolean {
  const text = (collectParagraphText(paragraphXml)[0] ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("en-US")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return EXECUTION_HEADING.test(text);
}

function executionSectionStart(documentXml: string): number {
  const paragraphPattern = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  for (const match of Array.from(documentXml.matchAll(paragraphPattern))) {
    if (isExecutionHeadingParagraph(match[0])) return match.index ?? 0;
  }
  return -1;
}

function xmlAttribute(element: string, attribute: string): string | undefined {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return element.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, "i"))?.[1];
}

function relationshipIdsInXml(xml: string): Set<string> {
  return new Set(
    Array.from(
      xml.matchAll(/\b(?:r:(?:id|embed|link|dm|lo)|o:relid)="([^"]+)"/g),
      (match) => match[1],
    ),
  );
}

function inlineGraphicHeightTwips(graphicXml: string): number {
  if (/<wp:anchor\b/i.test(graphicXml)) return 0;

  const extents = Array.from(
    graphicXml.matchAll(/<(?:wp|w):extent\b[^>]*\bcy="(\d+)"/gi),
    (match) => Number(match[1]),
  ).filter((height) => Number.isSafeInteger(height) && height > 0);
  if (extents.length > 0) return Math.ceil(Math.max(...extents) / 635);

  const shapeStyle = graphicXml.match(/<v:shape\b[^>]*\bstyle="([^"]*)"/i)?.[1] ?? "";
  const heightMatch = shapeStyle.match(/(?:^|;)\s*height\s*:\s*([\d.]+)\s*(pt|px|in|cm|mm)\b/i);
  if (heightMatch) {
    const value = Number(heightMatch[1]);
    const emuPerUnit: Record<string, number> = {
      pt: 12_700,
      px: 9_525,
      in: 914_400,
      cm: 360_000,
      mm: 36_000,
    };
    const emu = value * emuPerUnit[heightMatch[2].toLowerCase()];
    if (Number.isFinite(emu) && emu > 0) return Math.ceil(emu / 635);
  }

  if (/<wp:inline\b|<w:pict\b|<w:object\b|<w:objectLink\b|<v:shape\b/i.test(graphicXml)) {
    throw new LegalTemplateValidationError([
      "An inline execution-section image has no measurable height; remove it manually so its reserved signature spacing can be preserved.",
    ]);
  }
  return 0;
}

function preserveParagraphHeight(paragraphXml: string, minimumLineTwips: number): string {
  if (minimumLineTwips < 1) return paragraphXml;

  const pPr = paragraphXml.match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/);
  if (!pPr) {
    return paragraphXml.replace(
      /(<w:p(?:\s[^>]*)?>)/,
      `$1<w:pPr><w:spacing w:line="${minimumLineTwips}" w:lineRule="atLeast"/></w:pPr>`,
    );
  }

  const spacing = pPr[0].match(/<w:spacing\b[^>]*\/?>/);
  if (!spacing) {
    const updated = pPr[0].replace(
      /<\/w:pPr>$/,
      `<w:spacing w:line="${minimumLineTwips}" w:lineRule="atLeast"/></w:pPr>`,
    );
    return paragraphXml.replace(pPr[0], updated);
  }

  const previousLine = Number(xmlAttribute(spacing[0], "w:line") ?? 0);
  const previousRule = xmlAttribute(spacing[0], "w:lineRule");
  const line = Math.max(Number.isSafeInteger(previousLine) ? previousLine : 0, minimumLineTwips);
  const rule = previousRule === "exact" && previousLine >= minimumLineTwips
    ? "exact"
    : "atLeast";
  const firstAttribute = spacing[0].search(/\s/);
  const attributes = (firstAttribute < 0 ? "" : spacing[0].slice(firstAttribute + 1))
    .replace(/\/?>$/, "")
    .replace(/\s+w:line="[^"]*"/g, "")
    .replace(/\s+w:lineRule="[^"]*"/g, "");
  const ending = spacing[0].endsWith("/>") ? "/>" : ">";
  const updatedSpacing = `<w:spacing${attributes ? ` ${attributes}` : ""} w:line="${line}" w:lineRule="${rule}"${ending}`;
  const updatedProperties = pPr[0].replace(spacing[0], updatedSpacing);
  return paragraphXml.replace(pPr[0], updatedProperties);
}

function relationshipPartSourcePath(relationshipPath: string): string {
  if (relationshipPath.toLowerCase() === "_rels/.rels") return "";
  return relationshipPath.replace(/\/_rels\/([^/]+)\.rels$/i, "/$1");
}

function resolveRelationshipTarget(
  relationshipPath: string,
  target: string,
): string {
  if (target.startsWith("/")) return path.posix.normalize(target.slice(1));
  const sourcePath = relationshipPartSourcePath(relationshipPath);
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target));
}

function relationshipElements(xml: string): string[] {
  return Array.from(
    xml.matchAll(/<Relationship\b[^>]*(?:\/>|>[\s\S]*?<\/Relationship\s*>)/g),
    (match) => match[0],
  );
}

function removeUnusedExecutionImageRelationships(
  zip: PizZip,
  documentXml: string,
  removedRelationshipIds: Set<string>,
): void {
  const relationshipsPath = "word/_rels/document.xml.rels";
  const relationshipsFile = zip.file(relationshipsPath);
  if (!relationshipsFile || removedRelationshipIds.size === 0) return;

  const removedTargets = new Set<string>();
  const originalRelationshipsXml = relationshipsFile.asText();
  const relationshipsXml = originalRelationshipsXml.replace(
    /<Relationship\b[^>]*(?:\/>|>[\s\S]*?<\/Relationship\s*>)/g,
    (relationship) => {
      const id = xmlAttribute(relationship, "Id");
      if (!id || !removedRelationshipIds.has(id)) return relationship;
      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const stillReferenced = new RegExp(
        `\\b(?:r:(?:id|embed|link|dm|lo)|o:relid)="${escapedId}"`,
      ).test(documentXml);
      if (stillReferenced) return relationship;

      const target = xmlAttribute(relationship, "Target");
      if (
        target &&
        xmlAttribute(relationship, "TargetMode")?.toLowerCase() !== "external"
      ) {
        removedTargets.add(resolveRelationshipTarget(relationshipsPath, target));
      }
      return "";
    },
  );
  if (relationshipsXml !== originalRelationshipsXml) {
    zip.file(relationshipsPath, relationshipsXml);
  }

  if (removedTargets.size === 0) return;
  const remainingTargets = new Set<string>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || !name.endsWith(".rels")) continue;
    for (const relationship of relationshipElements(file.asText())) {
      if (xmlAttribute(relationship, "TargetMode")?.toLowerCase() === "external") continue;
      const target = xmlAttribute(relationship, "Target");
      if (target) remainingTargets.add(resolveRelationshipTarget(name, target));
    }
  }

  for (const target of Array.from(removedTargets)) {
    if (target.startsWith("word/media/") && !remainingTargets.has(target)) {
      zip.remove(target);
    }
  }
}

function sanitizeExecutionSectionGraphics(zip: PizZip): void {
  const documentPath = "word/document.xml";
  const documentFile = zip.file(documentPath);
  if (!documentFile) return;

  const removedRelationshipIds = new Set<string>();
  let inExecutionSection = false;
  let changed = false;
  const originalXml = documentFile.asText();
  const normalizedXml = originalXml.replace(
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
    (paragraphXml) => {
      if (!inExecutionSection && isExecutionHeadingParagraph(paragraphXml)) {
        inExecutionSection = true;
      }
      if (!inExecutionSection) return paragraphXml;

      const graphics = Array.from(paragraphXml.matchAll(EXECUTION_GRAPHIC_PATTERN));
      if (graphics.length === 0) return paragraphXml;
      changed = true;

      let minimumLineTwips = 0;
      for (const graphic of graphics) {
        const graphicXml = graphic[0];
        for (const relationshipId of Array.from(relationshipIdsInXml(graphicXml))) {
          removedRelationshipIds.add(relationshipId);
        }
        minimumLineTwips = Math.max(
          minimumLineTwips,
          inlineGraphicHeightTwips(graphicXml),
        );
      }

      const withoutGraphics = paragraphXml.replace(EXECUTION_GRAPHIC_PATTERN, "");
      return preserveParagraphHeight(withoutGraphics, minimumLineTwips);
    },
  );

  if (!changed) return;
  zip.file(documentPath, normalizedXml);
  removeUnusedExecutionImageRelationships(zip, normalizedXml, removedRelationshipIds);
}

function validateExecutionSectionGraphics(documentXml: string, issues: string[]): void {
  const start = executionSectionStart(documentXml);
  if (start < 0) {
    if (new RegExp(EXECUTION_GRAPHIC_PATTERN.source, "i").test(documentXml)) {
      issues.push(
        "Document graphics cannot be safely classified without a SIGNED, SEALED AND DELIVERED execution heading; remove the graphics or restore the execution heading.",
      );
    }
    return;
  }

  if (new RegExp(EXECUTION_GRAPHIC_PATTERN.source, "i").test(documentXml.slice(start))) {
    issues.push(
      "Execution-section images/drawings, including signatures, seals, and stamps, are not allowed. Remove them from the director/witness/notary execution section before saving or activating the template; logos outside that section are permitted.",
    );
  }
}

function readWordXmlParts(zip: PizZip): Array<{ name: string; xml: string }> {
  return Object.entries(zip.files)
    .filter(([name, file]) => !file.dir && /^word\/.*\.xml$/i.test(name))
    .map(([name, file]) => ({ name, xml: file.asText() }));
}

function getPlaceholderCounts(
  zip: PizZip,
  issues: string[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const part of readWordXmlParts(zip)) {
    for (const paragraph of collectParagraphText(part.xml)) {
      const found: string[] = [];
      for (const match of Array.from(paragraph.matchAll(/\{\{([^{}]*)\}\}/g))) {
        const name = match[1].trim();
        found.push(name);
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
          issues.push(`Malformed placeholder in ${part.name}: {{${match[1]}}}`);
        } else if (!ALLOWED_PLACEHOLDERS.has(name)) {
          issues.push(`Unsupported placeholder in ${part.name}: {{${name}}}`);
        } else {
          counts[name] = (counts[name] || 0) + 1;
        }
      }

      // A dangling opening or closing delimiter usually means a Word run was
      // edited incompletely.  Counting exact tags catches this even when the
      // malformed placeholder is split between multiple w:r / w:t nodes.
      const opens = paragraph.match(/\{\{/g)?.length || 0;
      const closes = paragraph.match(/\}\}/g)?.length || 0;
      if (opens !== found.length || closes !== found.length) {
        issues.push(`Malformed or unclosed placeholder delimiters in ${part.name}`);
      }
    }
  }

  return counts;
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
  const issues: string[] = [];
  let zip: PizZip;
  try {
    zip = inspectLegalDocxArchive(buffer);
  } catch (error) {
    if (error instanceof LegalTemplateValidationError) throw error;
    throw new LegalTemplateValidationError(["Could not inspect DOCX archive"]);
  }

  validateExecutionSectionGraphics(zip.file("word/document.xml")!.asText(), issues);
  const placeholderCounts = getPlaceholderCounts(zip, issues);
  for (const required of LEGAL_TEMPLATE_PLACEHOLDERS[documentType]) {
    if (
      required === "DOCUMENT_DATE" &&
      DOCUMENT_DATE_PARTS.every((part) => placeholderCounts[part] > 0)
    ) {
      // The existing wording can use separate day/month/year tokens.
      continue;
    }
    if (!placeholderCounts[required]) {
      issues.push(`Required placeholder is missing: {{${required}}}`);
    }
  }

  if (issues.length > 0) throw new LegalTemplateValidationError(issues);
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
 * Static legal wording—including the literal Naira suffix—is left unchanged.
 * Date parts remain distinct to preserve the literal "DAY OF" construction
 * and are derived with the canonical date from one UTC timestamp.
 */
export function normalizeSuppliedLegalTemplate(buffer: Buffer): Buffer {
  const zip = inspectLegalDocxArchive(buffer);
  sanitizeExecutionSectionGraphics(zip);
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
