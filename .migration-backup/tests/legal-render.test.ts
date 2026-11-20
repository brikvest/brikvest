import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import {
  convertDocxToPdf,
  SignaturePositionValidationError,
  verifyAssigneeSignaturePosition,
} from "../server/legal/converter";
import {
  LegalTemplateValidationError,
  getLegalTemplateFieldMetadata,
  normalizeSuppliedLegalTemplate,
  renderIllustrativeLegalTemplate,
  renderLegalTemplate,
  validateLegalTemplate,
} from "../server/legal/templates";
import {
  amountToWordsNaira,
  buildIllustrativeTemplateValues,
  buildLegalTemplateValues,
  formatNairaNumeric,
  formatLegalDocumentDate,
} from "../server/legal/values";
import type { LegalDocumentType } from "../server/legal/templates";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deedSource = readFileSync(
  path.join(projectRoot, "attached_assets/DEED_OF_ASSIGNMENT_BRIKVEST_1790828516010.docx"),
);
const transferSource = readFileSync(
  path.join(projectRoot, "attached_assets/TRANSFER_AND_EXIT_RIGHT_AGREEMENT_1790828516011.docx"),
);
const deedV1 = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/deed_of_assignment_v1.docx"),
);
const transferV1 = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/transfer_exit_rights_v1.docx"),
);

const FIXED_DATE = new Date("2026-09-30T17:41:00.000Z");

function getVisibleText(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  return Object.entries(zip.files)
    .filter(([name, file]) => name.startsWith("word/") && name.endsWith(".xml") && !file.dir)
    .flatMap(([, file]) => {
      const xml = file.asText();
      return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) =>
        match[1]
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&"),
      );
    })
    .join("");
}

function maskDynamicFields(text: string): string {
  return text.replace(/\{\{[^{}]*\}\}/g, "{{FIELD}}").replace(/\s+/g, " ").trim();
}

function getEmbeddedFontAssets(buffer: Buffer): Record<string, string> {
  const zip = new PizZip(buffer);
  return Object.fromEntries(
    Object.entries(zip.files)
      .filter(([name, file]) => name.startsWith("word/fonts/") && !file.dir)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, file]) => [
        name,
        Buffer.from(file.asBinary(), "binary").toString("base64"),
      ]),
  );
}

function getDocumentParagraphs(buffer: Buffer): string[] {
  const xml = new PizZip(buffer).file("word/document.xml")!.asText();
  return Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g), (match) => match[0]);
}

function getExecutionGraphicsCount(buffer: Buffer): number {
  let inExecution = false;
  let count = 0;
  for (const paragraph of getDocumentParagraphs(buffer)) {
    const text = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) => match[1])
      .join("")
      .replace(/[^A-Z0-9]+/gi, " ")
      .toUpperCase();
    if (!inExecution && /SIGNED\s+SEALED\s+AND\s+DELIVERED/.test(text)) {
      inExecution = true;
    }
    if (inExecution) {
      count += Array.from(
        paragraph.matchAll(
          /<w:drawing\b[\s\S]*?<\/w:drawing\s*>|<w:pict\b[\s\S]*?<\/w:pict\s*>|<w:object\b[\s\S]*?<\/w:object\s*>|<w:objectLink\b[^>]*(?:\/>|>[\s\S]*?<\/w:objectLink\s*>)|<w:altChunk\b[^>]*\/?>|<v:shape\b[\s\S]*?<\/v:shape\s*>|<a:blip\b[^>]*\/?>|<v:imagedata\b[^>]*\/?>/gi,
        ),
      ).length;
    }
  }
  return count;
}

function getExecutionDrawing(buffer: Buffer): string {
  let inExecution = false;
  for (const paragraph of getDocumentParagraphs(buffer)) {
    const text = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) => match[1])
      .join("")
      .replace(/[^A-Z0-9]+/gi, " ")
      .toUpperCase();
    if (!inExecution && /SIGNED\s+SEALED\s+AND\s+DELIVERED/.test(text)) {
      inExecution = true;
    }
    if (inExecution) {
      const drawing = paragraph.match(/<w:drawing\b[\s\S]*?<\/w:drawing\s*>/i)?.[0];
      if (drawing) return drawing;
    }
  }
  throw new Error("No execution-section drawing found in source fixture");
}

function visibleParagraphText(paragraphXml: string): string {
  return [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("");
}

function renderTestDocument(type: LegalDocumentType, template: Buffer): Buffer {
  return renderLegalTemplate(template, type, {
    USER_FULL_NAME: "Ada Lovelace",
    USER_HOME_ADDRESS: "1 Example Street, Abuja",
    PROPERTY_AREA_SQM: "20",
    PAYMENT_AMOUNT_NAIRA_NUMERIC: "1,000,000",
    PAYMENT_AMOUNT_NAIRA_WORDS: "One Million Naira",
    DOCUMENT_DATE: "30th September 2026",
    DOCUMENT_DATE_DAY: "30th",
    DOCUMENT_DATE_MONTH: "September",
    DOCUMENT_DATE_YEAR: "2026",
  });
}

describe("legal Word template rendering", () => {
  it("normalizes only legacy dynamic fields and keeps split Word runs/styles", () => {
    for (const [type, source, normalized] of [
      ["deed_of_assignment", deedSource, deedV1],
      ["transfer_exit_rights", transferSource, transferV1],
    ] as const) {
      const untouchedSource = Buffer.from(source);
      const generated = normalizeSuppliedLegalTemplate(source);
      expect(source.equals(untouchedSource)).toBe(true);
      const originalXml = new PizZip(source).file("word/document.xml")!.asText();
      const normalizedXml = new PizZip(generated).file("word/document.xml")!.asText();
      expect(maskDynamicFields(getVisibleText(generated))).toBe(
        maskDynamicFields(getVisibleText(source)),
      );
      expect(getExecutionGraphicsCount(source)).toBeGreaterThan(0);
      expect(getExecutionGraphicsCount(generated)).toBe(getExecutionGraphicsCount(source));
      // Every archive part other than technically normalized text is exact.
      const originalZip = new PizZip(source);
      const generatedZip = new PizZip(generated);
      expect(Object.keys(generatedZip.files).sort()).toEqual(Object.keys(originalZip.files).sort());
      for (const [name, file] of Object.entries(originalZip.files)) {
        if (file.dir || name === "word/document.xml") continue;
        expect(generatedZip.file(name)!.asBinary(), name).toBe(file.asBinary());
      }
      expect(getDocumentParagraphs(generated).filter((p) => /<w:drawing|<w:pict/.test(p)))
        .toEqual(getDocumentParagraphs(source).filter((p) => /<w:drawing|<w:pict/.test(p)));
      expect(getEmbeddedFontAssets(generated)).toEqual(getEmbeddedFontAssets(source));
      expect(validateLegalTemplate(generated, type).placeholderCounts).toEqual(
        validateLegalTemplate(normalized, type).placeholderCounts,
      );
      expect(normalizedXml).not.toMatch(/CURRENT_(?:DAY|MONTH|YEAR)|NUM_UNITS_OWNED\*5/);
      expect(normalizedXml.match(/<w:rPr\b/g)?.length).toBe(
        originalXml.match(/<w:rPr\b/g)?.length,
      );
      expect(normalizedXml.match(/<w:tbl\b/g)?.length).toBe(
        originalXml.match(/<w:tbl\b/g)?.length,
      );
      expect(normalizedXml.match(/<w:p(?:\s[^>]*)?>/g)?.length).toBe(
        originalXml.match(/<w:p(?:\s[^>]*)?>/g)?.length,
      );
      expect(validateLegalTemplate(normalized, type).totalPlaceholders).toBeGreaterThan(0);
    }

    const deedXml = new PizZip(deedV1).file("word/document.xml")!.asText();
    expect(deedXml).toContain("{{PROPERTY_AREA_SQM}}");
    expect(deedXml).toContain("{{DOCUMENT_DATE_DAY}}");
    expect(getVisibleText(deedV1)).toContain("DAY OF");

    const originalSignatureParagraph = getDocumentParagraphs(deedSource).find((paragraph) =>
      visibleParagraphText(paragraph).includes("SIGNATURE:"),
    )!;
    const normalizedSignatureParagraph = getDocumentParagraphs(normalizeSuppliedLegalTemplate(deedSource)).find((paragraph) =>
      visibleParagraphText(paragraph).includes("SIGNATURE:"),
    )!;
    expect(normalizedSignatureParagraph).toBe(originalSignatureParagraph);
    expect(getVisibleText(deedV1)).toContain("COMMISSIONER FOR OATHS/NOTARY PUBLIC");

    const sourceZip = new PizZip(deedSource);
    const normalizedZip = new PizZip(normalizeSuppliedLegalTemplate(deedSource));
    const sourceRelationships = sourceZip.file("word/_rels/document.xml.rels")!.asText();
    const normalizedRelationships = normalizedZip.file("word/_rels/document.xml.rels")!.asText();
    const retainedRelationshipIds = new Set(
      Array.from(
        sourceZip.file("word/document.xml")!.asText().matchAll(
          /<w:drawing\b[\s\S]*?<\/w:drawing\s*>/g,
        ),
      )
        .flatMap((match) => Array.from(match[0].matchAll(/(?:r:embed|r:id)="([^"]+)"/g)))
        .map((match) => match[1]),
    );
    expect(normalizedRelationships).toBe(sourceRelationships);
    for (const id of Array.from(retainedRelationshipIds)) {
      const relation = sourceRelationships.match(
        new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*>`),
      )?.[0];
      const target = relation?.match(/\bTarget="([^"]+)"/)?.[1];
      expect(normalizedRelationships).toContain(`Id="${id}"`);
      if (target) expect(normalizedZip.file(`word/${target}`)!.asBinary())
        .toBe(sourceZip.file(`word/${target}`)!.asBinary());
    }
  });

  it("accepts execution-region signatures while preserving body logos and header graphics", () => {
    for (const [type, source] of [
      ["deed_of_assignment", deedSource],
      ["transfer_exit_rights", transferSource],
    ] as const) {
      const normalized = normalizeSuppliedLegalTemplate(source);
      expect(validateLegalTemplate(normalized, type).totalPlaceholders).toBeGreaterThan(0);
      for (const rendered of [
        renderTestDocument(type, normalized),
        renderIllustrativeLegalTemplate(normalized, type).renderedDocx,
      ]) {
        expect(getExecutionGraphicsCount(rendered)).toBe(getExecutionGraphicsCount(source));
        expect(getExecutionDrawing(rendered)).toBe(getExecutionDrawing(source));
        const sourceZip = new PizZip(source);
        const renderedZip = new PizZip(rendered);
        for (const [name, file] of Object.entries(sourceZip.files)) {
          if (!file.dir && (name.startsWith("word/media/") || name.endsWith(".rels"))) {
            expect(renderedZip.file(name)!.asBinary(), name).toBe(file.asBinary());
          }
        }
      }
    }

    const sourceZip = new PizZip(deedSource);
    const sourceXml = sourceZip.file("word/document.xml")!.asText();
    const drawing = getExecutionDrawing(deedSource);
    let inserted = false;
    const withBodyGraphic = sourceXml.replace(
      /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
      (paragraph) => {
        if (inserted || /SIGNED\s*,?\s*SEALED\s+AND\s+DELIVERED/i.test(visibleParagraphText(paragraph))) {
          return paragraph;
        }
        inserted = true;
        return paragraph.replace("</w:p>", `<w:r>${drawing}</w:r></w:p>`);
      },
    );
    expect(inserted).toBe(true);
    sourceZip.file("word/document.xml", withBodyGraphic);
    const normalizedWithBodyGraphic = normalizeSuppliedLegalTemplate(
      sourceZip.generate({ type: "nodebuffer" }),
    );
    expect(getExecutionGraphicsCount(normalizedWithBodyGraphic)).toBe(getExecutionGraphicsCount(deedSource));
    expect(validateLegalTemplate(normalizedWithBodyGraphic, "deed_of_assignment").totalPlaceholders)
      .toBeGreaterThan(0);

    const normalizedZip = new PizZip(normalizedWithBodyGraphic);
    const normalizedXml = normalizedZip.file("word/document.xml")!.asText();
    const executionStart = normalizedXml.search(/SIGNED(?:,|\s)+SEALED\s+AND\s+DELIVERED/i);
    expect(normalizedXml.slice(0, executionStart)).toContain("<w:drawing");
    const bodyRelationshipId = drawing.match(/(?:r:embed|r:id)="([^"]+)"/)?.[1];
    expect(bodyRelationshipId).toBeDefined();
    expect(normalizedZip.file("word/_rels/document.xml.rels")!.asText())
      .toContain(`Id="${bodyRelationshipId}"`);
    const sourceHeaderNames = Object.keys(sourceZip.files).filter((name) =>
      /^word\/(?:header|footer)\d+\.xml$/i.test(name),
    );
    for (const name of sourceHeaderNames) {
      expect(normalizedZip.file(name)?.asBinary()).toEqual(sourceZip.file(name)?.asBinary());
    }
  });

  it("preserves inline and anchored images even without a recognized execution heading", () => {
    for (const [type, source] of [
      ["deed_of_assignment", deedSource],
      ["transfer_exit_rights", transferSource],
    ] as const) {
      for (const anchored of [false, true]) {
        const zip = new PizZip(normalizeSuppliedLegalTemplate(source));
        let xml = zip.file("word/document.xml")!.asText();
        // Replace every heading text without changing any drawing markup.
        xml = xml.replace(/SIGNED/gi, "EXECUTED");
        if (anchored) {
          xml = xml.replace(/<wp:inline\b([^>]*)>/g,
            '<wp:anchor$1 simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:wrapNone/>')
            .replace(/<\/wp:inline>/g, "</wp:anchor>");
        }
        zip.file("word/document.xml", xml);
        const input = zip.generate({ type: "nodebuffer" });
        const normalized = normalizeSuppliedLegalTemplate(input);
        expect(validateLegalTemplate(normalized, type).totalPlaceholders).toBeGreaterThan(0);
        expect(new PizZip(normalized).file("word/document.xml")!.asText()).toBe(xml);
        const rendered = new PizZip(renderTestDocument(type, normalized));
        const graphics = (value: string) => Array.from(
          value.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g), (match) => match[0],
        );
        expect(graphics(xml).length).toBeGreaterThan(0);
        expect(graphics(rendered.file("word/document.xml")!.asText())).toEqual(graphics(xml));
        for (const [name, file] of Object.entries(zip.files)) {
          if (!file.dir && (name.startsWith("word/media/") || name.endsWith(".rels"))) {
            expect(rendered.file(name)!.asBinary()).toBe(file.asBinary());
          }
        }
      }
    }
  });

  it("still rejects invalid placeholders and unsafe archives with embedded signatures", () => {
    for (const [type, source] of [
      ["deed_of_assignment", deedSource],
      ["transfer_exit_rights", transferSource],
    ] as const) {
      const template = normalizeSuppliedLegalTemplate(source);
      for (const [token, issue] of [
        ["{{UNKNOWN_FIELD}}", "Unsupported placeholder"],
        ["", "Required placeholder is missing"],
        ["{{USER_FULL_NAME", "Malformed"],
      ]) {
        const zip = new PizZip(template);
        zip.file("word/document.xml", zip.file("word/document.xml")!.asText()
          .replaceAll("{{USER_FULL_NAME}}", token));
        const invalid = zip.generate({ type: "nodebuffer" });
        expect(() => validateLegalTemplate(invalid, type)).toThrow(issue);
        expect(() => renderTestDocument(type, invalid)).toThrow(issue);
      }
      for (const [name, content, issue] of [
        ["word/vbaProject.bin", "macro", "Macro-enabled"],
        ["../escape.xml", "unsafe", "Unsafe DOCX archive entry"],
        ["word/bomb.xml", "A".repeat(2 * 1024 * 1024), "suspicious compression ratio"],
      ]) {
        const zip = new PizZip(template);
        zip.file(name, content);
        const invalid = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
        expect(() => validateLegalTemplate(invalid, type)).toThrow(issue);
        expect(() => normalizeSuppliedLegalTemplate(invalid)).toThrow(issue);
      }
    }
  });

  it("validates type-specific required fields and reports malformed templates", () => {
    const deedValidation = validateLegalTemplate(deedV1, "deed_of_assignment");
    const transferValidation = validateLegalTemplate(transferV1, "transfer_exit_rights");

    expect(deedValidation.placeholderCounts.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBeGreaterThan(0);
    expect(transferValidation.placeholderCounts.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBeUndefined();

    const zip = new PizZip(transferV1);
    const documentXml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", documentXml.replace("{{USER_HOME_ADDRESS}}", "{{MISSING_ADDRESS}}"));
    const missingRequired = zip.generate({ type: "nodebuffer" });
    expect(() => validateLegalTemplate(missingRequired, "transfer_exit_rights")).toThrow(
      LegalTemplateValidationError,
    );
    expect(() => validateLegalTemplate(missingRequired, "transfer_exit_rights")).toThrow(
      "Unsupported placeholder",
    );
    expect(
      validateLegalTemplate(transferV1, "transfer_exit_rights", {
        requireCanonicalDate: true,
      }).placeholderCounts.DOCUMENT_DATE_DAY,
    ).toBeGreaterThan(0);

    const canonicalDateZip = new PizZip(transferV1);
    const canonicalDateXml = canonicalDateZip.file("word/document.xml")!.asText()
      .replaceAll("{{DOCUMENT_DATE_DAY}}", "{{DOCUMENT_DATE}}")
      .replaceAll("{{DOCUMENT_DATE_MONTH}}", "")
      .replaceAll("{{DOCUMENT_DATE_YEAR}}", "");
    canonicalDateZip.file("word/document.xml", canonicalDateXml);
    expect(
      validateLegalTemplate(
        canonicalDateZip.generate({ type: "nodebuffer" }),
        "transfer_exit_rights",
        { requireCanonicalDate: true },
      ).placeholderCounts.DOCUMENT_DATE,
    ).toBeGreaterThan(0);

    const malformedZip = new PizZip(transferV1);
    malformedZip.file(
      "word/document.xml",
      malformedZip.file("word/document.xml")!.asText().replace("{{USER_FULL_NAME}}", "{{USER_FULL_NAME"),
    );
    expect(() =>
      validateLegalTemplate(malformedZip.generate({ type: "nodebuffer" }), "transfer_exit_rights"),
    ).toThrow("Malformed");
  });

  it("replaces all repeated values without flattening Word formatting", () => {
    const rendered = renderTestDocument("deed_of_assignment", deedV1);
    const zip = new PizZip(rendered);
    const xml = zip.file("word/document.xml")!.asText();
    const visibleText = getVisibleText(rendered);

    expect(xml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(visibleText).toContain("Ada Lovelace");
    expect(visibleText).toContain("20");
    expect(visibleText).toContain("1,000,000");
    expect(visibleText).toContain("One Million Naira");
    expect(visibleText).toContain("30th DAY OF September, 2026");
    expect(xml.match(/<w:rPr\b/g)?.length).toBe(
      new PizZip(deedV1).file("word/document.xml")!.asText().match(/<w:rPr\b/g)?.length,
    );

    const illustrative = renderIllustrativeLegalTemplate(transferV1, "transfer_exit_rights");
    expect(illustrative.label).toContain("NOT FOR EXECUTION OR SIGNATURE");
    expect(getVisibleText(illustrative.renderedDocx)).toContain(
      "Illustrative Example — Not for Execution",
    );
  });

  it("reports actual distinct fields across split runs, tables, headers and footers", () => {
    const zip = new PizZip(transferV1);
    const originalXml = zip.file("word/document.xml")!.asText();
    const counts = validateLegalTemplate(transferV1, "transfer_exit_rights").placeholderCounts;
    zip.file("word/document.xml", originalXml.replace("</w:body>",
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{PAYMENT_AMOUNT_</w:t></w:r><w:r><w:t>NAIRA_NUMERIC}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>"));
    zip.file("word/header1.xml", '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>{{USER_</w:t></w:r><w:r><w:t>FULL_NAME}}</w:t></w:r></w:p></w:hdr>');
    zip.file("word/footer1.xml", '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>{{DOCUMENT_DATE_YEAR}}</w:t></w:r></w:p></w:ftr>');
    const buffer = zip.generate({ type: "nodebuffer" });
    const metadata = getLegalTemplateFieldMetadata(buffer, "transfer_exit_rights");
    expect(metadata.issues).toEqual([]);
    expect(metadata.fields.find((field) => field.token === "USER_FULL_NAME")?.count)
      .toBe(counts.USER_FULL_NAME + 1);
    expect(metadata.fields.find((field) => field.token === "DOCUMENT_DATE_YEAR")?.count)
      .toBe(counts.DOCUMENT_DATE_YEAR + 1);
    expect(metadata.fields.find((field) => field.token === "PAYMENT_AMOUNT_NAIRA_NUMERIC"))
      .toEqual(expect.objectContaining({ count: 1, source: expect.stringContaining("Verified land consideration") }));
    expect(metadata.fields.some((field) => field.token === "PAYMENT_AMOUNT_NAIRA_WORDS")).toBe(false);
    expect(zip.file("word/document.xml")!.asText()).toContain(originalXml.slice(0, originalXml.indexOf("</w:body>")));

    zip.file("word/footer1.xml", "<w:p><w:r><w:t>{{UNKNOWN_FIELD}} {{USER_FULL_NAME</w:t></w:r></w:p>");
    const invalid = getLegalTemplateFieldMetadata(zip.generate({ type: "nodebuffer" }), "transfer_exit_rights");
    expect(invalid.issues.join("; ")).toContain("Unsupported placeholder");
    expect(invalid.issues.join("; ")).toContain("Malformed");
    expect(getLegalTemplateFieldMetadata(Buffer.from("not docx"), "transfer_exit_rights").issues.length).toBeGreaterThan(0);
  });

  it("populates transfer payment tokens and rejects blank values for every actual token", () => {
    const zip = new PizZip(transferV1);
    zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("</w:body>",
      "<w:p><w:r><w:t>Payment: {{PAYMENT_AMOUNT_NAIRA_NUMERIC}} / {{PAYMENT_AMOUNT_NAIRA_WORDS}}</w:t></w:r></w:p></w:body>"));
    const buffer = zip.generate({ type: "nodebuffer" });
    const data = {
      verifiedFullName: "Ada Lovelace", verifiedHomeAddress: "1 Example Street",
      propertyAreaSqm: 20, documentDate: FIXED_DATE,
    };
    expect(() => renderLegalTemplate(buffer, "transfer_exit_rights",
      buildLegalTemplateValues("transfer_exit_rights", data))).toThrow("PAYMENT_AMOUNT_NAIRA_NUMERIC");
    const values = buildLegalTemplateValues("transfer_exit_rights", {
      ...data, approvedPaymentAmountNaira: "1000000.50",
    });
    expect(getVisibleText(renderLegalTemplate(buffer, "transfer_exit_rights", values)))
      .toContain("Payment: 1,000,000.50 / One Million Naira and Fifty Kobo");
    expect(() => renderLegalTemplate(buffer, "transfer_exit_rights", {
      ...values, DOCUMENT_DATE_DAY: "",
    })).toThrow("DOCUMENT_DATE_DAY");
  });

  it("uses one approved amount and one date source for all tokens", () => {
    expect(amountToWordsNaira("1000000")).toBe("One Million Naira");
    expect(amountToWordsNaira("1000000.50")).toBe(
      "One Million Naira and Fifty Kobo",
    );
    expect(amountToWordsNaira(101)).toBe("One Hundred One Naira");
    expect(amountToWordsNaira("0.01")).toBe("Zero Naira and One Kobo");
    expect(formatNairaNumeric("1000000.05")).toBe("1,000,000.05");
    expect(formatLegalDocumentDate(FIXED_DATE)).toEqual({
      DOCUMENT_DATE: "30th September 2026",
      DOCUMENT_DATE_DAY: "30th",
      DOCUMENT_DATE_MONTH: "September",
      DOCUMENT_DATE_YEAR: "2026",
    });

    const values = buildLegalTemplateValues("deed_of_assignment", {
      verifiedFullName: "Ada Lovelace",
      verifiedHomeAddress: "1 Example Street",
      propertyAreaSqm: 20,
      approvedPaymentAmountNaira: "1000000",
      documentDate: FIXED_DATE,
    });
    expect(values.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBe("1,000,000");
    expect(values.PAYMENT_AMOUNT_NAIRA_WORDS).toBe("One Million Naira");
    const koboValues = buildLegalTemplateValues("deed_of_assignment", {
      verifiedFullName: "Ada Lovelace",
      verifiedHomeAddress: "1 Example Street",
      propertyAreaSqm: "1.25",
      approvedPaymentAmountNaira: "1000000.50",
      documentDate: FIXED_DATE,
    });
    expect(koboValues.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBe("1,000,000.50");
    expect(koboValues.PAYMENT_AMOUNT_NAIRA_WORDS).toBe(
      "One Million Naira and Fifty Kobo",
    );
    expect(koboValues.PROPERTY_AREA_SQM).toBe("1.25");
    const koboRendered = renderLegalTemplate(
      deedV1,
      "deed_of_assignment",
      koboValues,
    );
    expect(getVisibleText(koboRendered)).toContain(
      "One Million and Fifty Hundredths of a Naira",
    );
    expect(getVisibleText(koboRendered)).not.toContain(
      "One Million Naira and Fifty Kobo Naira",
    );
    const transferValues = buildLegalTemplateValues("transfer_exit_rights", {
      verifiedFullName: "Ada Lovelace",
      verifiedHomeAddress: "1 Example Street",
      propertyAreaSqm: 20,
      documentDate: FIXED_DATE,
    });
    expect(transferValues.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBe("");
    expect(transferValues.PAYMENT_AMOUNT_NAIRA_WORDS).toBe("");
    expect(
      getVisibleText(renderLegalTemplate(transferV1, "transfer_exit_rights", transferValues)),
    ).toContain("Ada Lovelace");
    expect(() =>
      buildLegalTemplateValues("deed_of_assignment", {
        verifiedFullName: "Ada Lovelace",
        verifiedHomeAddress: "1 Example Street",
        propertyAreaSqm: 20,
        approvedPaymentAmountNaira: "1000000.500",
        documentDate: FIXED_DATE,
      }),
    ).toThrow("no more than two kobo digits");
    expect(buildIllustrativeTemplateValues("transfer_exit_rights").USER_FULL_NAME).toContain(
      "Not for Execution",
    );
  });
});

describe("legal PDF conversion and assignee position verification", () => {
  it("keeps source signatures visible in both real illustrative preview PDFs", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "legal-presigned-preview-"));
    try {
      for (const [type, source] of [
        ["deed_of_assignment", deedSource],
        ["transfer_exit_rights", transferSource],
      ] as const) {
        const preview = renderIllustrativeLegalTemplate(normalizeSuppliedLegalTemplate(source), type);
        // Controlled exact-font resolution keeps this original-layout regression
        // distinct from the serif-normalization cases in legal-font-validation.
        const pdf = await convertDocxToPdf(preview.renderedDocx, { resolveFontFamily: (family) => family });
        const pdfPath = path.join(directory, `${type}.pdf`);
        writeFileSync(pdfPath, pdf);
        const images = execFileSync("pdfimages", ["-list", pdfPath], { encoding: "utf8", timeout: 20_000 });
        expect(images.split(/\r?\n/).filter((line) => /^\s*\d+\s+\d+\s+image\s/.test(line)).length)
          .toBeGreaterThan(0);
        const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8", timeout: 20_000 });
        expect(text).toContain("Not for Execution");
        await expect(verifyAssigneeSignaturePosition(pdf, {
          assigneeFullName: buildIllustrativeTemplateValues(type).USER_FULL_NAME,
          templateVersionId: `preview:${type}`,
        })).resolves.toMatchObject({ anchorText: buildIllustrativeTemplateValues(type).USER_FULL_NAME });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("fails closed if the LibreOffice executable is missing", async () => {
    const rendered = renderTestDocument("deed_of_assignment", deedV1);
    await expect(convertDocxToPdf(deedV1)).rejects.toThrow("Unresolved template delimiters");
    await expect(
      convertDocxToPdf(rendered, { libreOfficePath: "/missing/libreoffice" }),
    ).rejects.toThrow(/LibreOffice DOCX-to-PDF conversion failed|could not start/);
  });

  it("converts both rendered templates and locates only the assignee signature block", async () => {
    for (const [type, template, version] of [
      ["deed_of_assignment", deedV1, "deed-v1"],
      ["transfer_exit_rights", transferV1, "transfer-v1"],
    ] as const) {
      const rendered = renderTestDocument(type, template);
      const pdf = await convertDocxToPdf(rendered, { resolveFontFamily: (family) => family });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const placement = await verifyAssigneeSignaturePosition(pdf, {
        assigneeFullName: "Ada Lovelace",
        templateVersionId: version,
      });
      expect(placement.templateVersionId).toBe(version);
      expect(placement.pageNumber).toBeGreaterThan(0);
      expect(placement.width).toBeGreaterThan(30);
      expect(placement.height).toBeGreaterThan(10);
      expect(placement.x + placement.width).toBeLessThanOrEqual(placement.pageWidth + 1);
      expect(placement.y + placement.height).toBeLessThanOrEqual(placement.pageHeight + 1);
      expect(placement.anchorText).toBe("Ada Lovelace");

      await expect(
        verifyAssigneeSignaturePosition(pdf, {
          assigneeFullName: "Different Person",
          templateVersionId: version,
        }),
      ).rejects.toBeInstanceOf(SignaturePositionValidationError);
    }
  }, 120_000);

  it("verifies a wrapped long assignee name below a signed heading across a real page break", async () => {
    const fullName =
      "Alexandria Beatrice Catherine Delilah Elizabeth Florence Genevieve Isabella Josephine Montgomery Fitzwilliam";
    const address =
      "Apartment 1, Building 2, Example Boulevard, Example District, Abuja, " +
      "Additional Address Detail, Example District, Abuja";
    const rendered = renderLegalTemplate(deedV1, "deed_of_assignment", {
      USER_FULL_NAME: fullName,
      USER_HOME_ADDRESS: address,
      PROPERTY_AREA_SQM: "1.25",
      PAYMENT_AMOUNT_NAIRA_NUMERIC: "1,000,000.50",
      PAYMENT_AMOUNT_NAIRA_WORDS: "One Million Naira and Fifty Kobo",
      DOCUMENT_DATE: "30th September 2026",
      DOCUMENT_DATE_DAY: "30th",
      DOCUMENT_DATE_MONTH: "September",
      DOCUMENT_DATE_YEAR: "2026",
    });
    const pdf = await convertDocxToPdf(rendered, { resolveFontFamily: (family) => family });
    const placement = await verifyAssigneeSignaturePosition(pdf, {
      assigneeFullName: fullName,
      templateVersionId: "deed_of_assignment:v1",
    });
    expect(placement.anchorText).toBe(fullName);
    expect(placement.signatureHeadingPageNumber).toBe(placement.pageNumber - 1);
    expect(placement.height).toBeGreaterThan(25);
    expect(placement.x + placement.width).toBeLessThanOrEqual(placement.pageWidth + 1);
    expect(placement.y + placement.height).toBeLessThanOrEqual(placement.pageHeight + 1);
  }, 120_000);
});
