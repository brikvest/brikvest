import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import {
  getLegalTemplateFieldMetadata,
  LegalTemplateValidationError,
  validateLegalTemplate,
} from "../server/legal/templates";

const REQUIRED_TRANSFER_FIELDS =
  "{{USER_FULL_NAME}} {{USER_HOME_ADDRESS}} {{PROPERTY_AREA_SQM}} {{DOCUMENT_DATE}}";

function makeDocx(xml: string): Buffer {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file("word/document.xml", xml);
  return zip.generate({ type: "nodebuffer" });
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function getValidationError(buffer: Buffer): LegalTemplateValidationError {
  try {
    validateLegalTemplate(buffer, "transfer_exit_rights");
  } catch (error) {
    if (error instanceof LegalTemplateValidationError) return error;
    throw error;
  }
  throw new Error("Expected template validation to fail");
}

describe("legal template correction diagnostics", () => {
  it("reports unsupported and malformed tokens with exact token, friendly part, and centered excerpt", () => {
    const buffer = makeDocx(
      `<w:document>${paragraph(
        `Clause text ${"context ".repeat(15)}{{UNKNOWN_FIELD}}`,
      )}${paragraph("A split token: {{USER_</w:t></w:r><w:r><w:t>FULL_NAME}}")}${paragraph(
        "Broken placeholder {{USER_HOME_ADDRESS",
      )}${paragraph(REQUIRED_TRANSFER_FIELDS)}</w:document>`,
    );
    const error = getValidationError(buffer);
    const unsupported = error.correctionIssues.find((issue) => issue.code === "unsupported_placeholder");
    expect(unsupported).toMatchObject({
      token: "UNKNOWN_FIELD",
      location: "Main document, paragraph 1",
      instruction: expect.stringContaining("supported"),
    });
    expect(unsupported?.excerpt).toContain("{{UNKNOWN_FIELD}}");
    expect(unsupported?.excerpt?.length).toBeLessThanOrEqual(161);
    expect(error.correctionIssues.some((issue) => issue.code === "malformed_placeholder")).toBe(true);
    expect(error.correctionIssues.find((issue) =>
      issue.code === "malformed_placeholder" && issue.location === "Main document, paragraph 3",
    )).toMatchObject({ token: "{{USER_HOME_ADDRESS", location: "Main document, paragraph 3" });
    expect(error.issues.some((issue) => issue.includes("Unsupported placeholder"))).toBe(true);
    expect(error.issues.some((issue) => issue.includes("Malformed or unclosed placeholder"))).toBe(true);
  });

  it("does not invent a location or excerpt for missing required tokens", () => {
    const buffer = makeDocx(`<w:document>${paragraph(
      "{{USER_FULL_NAME}} {{USER_HOME_ADDRESS}} {{DOCUMENT_DATE}}",
    )}</w:document>`);
    const issue = getValidationError(buffer).correctionIssues.find(
      (entry) => entry.code === "missing_required_placeholder" && entry.token === "PROPERTY_AREA_SQM",
    );
    expect(issue).toBeDefined();
    expect(issue).not.toHaveProperty("location");
    expect(issue).not.toHaveProperty("excerpt");
    expect(issue?.message).toContain("{{PROPERTY_AREA_SQM}}");
  });

  it("returns structured parser issues alongside backwards-compatible string issues in field metadata", () => {
    const buffer = makeDocx(
      `<w:document>${paragraph(
        `${REQUIRED_TRANSFER_FIELDS} {{UNKNOWN_FIELD}} {{UNKNOWN_FIELD}}`,
      )}</w:document>`,
    );
    const metadata = getLegalTemplateFieldMetadata(buffer, "transfer_exit_rights");
    expect(metadata.issues.some((issue) => issue.includes("Unsupported placeholder"))).toBe(true);
    expect(metadata.correctionIssues.filter((issue) => issue.code === "unsupported_placeholder")).toHaveLength(1);
    expect(metadata.correctionIssues[0]).toMatchObject({
      token: "UNKNOWN_FIELD",
      location: "Main document, paragraph 1",
      excerpt: expect.stringContaining("{{UNKNOWN_FIELD}}"),
    });
  });

  it("accepts complete split-run placeholders and the split-date alternative", () => {
    const splitRunXml =
      `<w:document><w:p><w:r><w:t>{{USER_</w:t></w:r><w:r><w:t>FULL_NAME}}</w:t></w:r></w:p>` +
      `${paragraph("{{USER_HOME_ADDRESS}} {{PROPERTY_AREA_SQM}}")}` +
      `<w:p><w:r><w:t>{{DOCUMENT_DATE_DAY}}</w:t></w:r><w:r><w:t>{{DOCUMENT_DATE_MONTH}}</w:t></w:r>` +
      `<w:r><w:t>{{DOCUMENT_DATE_YEAR}}</w:t></w:r></w:p></w:document>`;
    const validation = validateLegalTemplate(makeDocx(splitRunXml), "transfer_exit_rights", {
      requireCanonicalDate: true,
    });
    expect(validation.placeholderCounts.USER_FULL_NAME).toBe(1);
    expect(validation.placeholderCounts.DOCUMENT_DATE_DAY).toBe(1);
  });

  it("distinguishes corrupt, oversized, and unsafe DOCX uploads without leaking archive names or exceptions", () => {
    const corrupt = getValidationError(Buffer.from("not a zip archive"));
    expect(corrupt.correctionIssues[0]).toMatchObject({ code: "corrupt_docx" });
    expect(corrupt.issues.join(" ")).not.toContain("Error:");

    const oversized = getValidationError(Buffer.alloc(20 * 1024 * 1024 + 1));
    expect(oversized.correctionIssues[0]).toMatchObject({ code: "file_size" });

    const unsafeZip = new PizZip(makeDocx(`<w:document>${paragraph(REQUIRED_TRANSFER_FIELDS)}</w:document>`));
    unsafeZip.file("../private/customer-data.xml", "sensitive");
    const unsafe = getValidationError(unsafeZip.generate({ type: "nodebuffer" }));
    expect(unsafe.correctionIssues[0]).toMatchObject({ code: "unsafe_archive" });
    expect(unsafe.issues.join(" ")).not.toContain("customer-data");
    expect(unsafe.issues.join(" ")).not.toContain("../");
  });
});