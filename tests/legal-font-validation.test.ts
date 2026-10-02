import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import {
  assessDocxFontReadiness,
  assertDocxFontsAvailable,
  inspectFontconfigFace,
  LIBERATION_SERIF_STYLES,
  resolveFontconfigFace,
  resolveFontconfigFamily,
  readDocxFontRequirements,
} from "../server/legal/font-validation";
import { convertDocxToPdf, prepareDocxForPdf, verifyAssigneeSignaturePosition } from "../server/legal/converter";
import { normalizeSuppliedLegalTemplate, renderLegalTemplate } from "../server/legal/templates";
import { prepareLegalDocxTypography } from "../server/legal/typography";
import { DRAWING_NS, WORD_NS, fontElements, parseFontXml } from "../server/legal/font-xml";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deedTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/deed_of_assignment_v1.docx"),
);
const transferTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/transfer_exit_rights_v1.docx"),
);

function renderedDeed(): Buffer {
  return renderLegalTemplate(deedTemplate, "deed_of_assignment", {
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

function addUnavailableFontFamily(buffer: Buffer): Buffer {
  const zip = new PizZip(buffer);
  const document = zip.file("word/document.xml")!.asText();
  const family = "Brikvest-Legal-Font-Strict-Gate-Definitely-Uninstalled-7788";
  const paragraph =
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr>` +
    `<w:t>Font gate probe</w:t></w:r></w:p>`;
  if (!document.includes("<w:body>")) {
    throw new Error("Rendered DOCX fixture has no Word document body");
  }
  zip.file("word/document.xml", document.replace("<w:body>", `<w:body>${paragraph}`));
  return zip.generate({ type: "nodebuffer" });
}

describe("DOCX conversion font fidelity", () => {
  it("resolves every licensed Liberation Serif face to an exact readable converter font file", () => {
    const previousConfig = process.env.FONTCONFIG_FILE;
    process.env.FONTCONFIG_FILE = path.join(projectRoot, "server/legal/fonts/fontconfig.conf");
    try {
      for (const style of LIBERATION_SERIF_STYLES) {
        const face = resolveFontconfigFace("Liberation Serif", style);
        expect(face).toMatchObject({
          family: "Liberation Serif",
          style,
          exactFamily: true,
          exactStyle: true,
          readableFile: true,
          ready: true,
        });
        expect(face.file).toMatch(/LiberationSerif.*\.ttf$/);
      }
    } finally {
      if (previousConfig === undefined) delete process.env.FONTCONFIG_FILE;
      else process.env.FONTCONFIG_FILE = previousConfig;
    }
  });

  it("treats an unreadable original-font path as unavailable so new documents may use the authorized fallback", () => {
    const exactButUnreadable = inspectFontconfigFace(
      "Cambria",
      "Regular",
      "Cambria|Regular|/unreadable/Cambria.ttf",
      () => false,
    );
    expect(exactButUnreadable).toMatchObject({
      exactFamily: true,
      exactStyle: true,
      readableFile: false,
      ready: false,
    });

    const prepared = prepareDocxForPdf(addUnavailableFontFamily(renderedDeed()), (family) =>
      family === "Liberation Serif" ? family : "unavailable",
    );
    expect(readDocxFontRequirements([prepared]).families).toEqual(["Liberation Serif"]);
  });

  it("uses per-family exact-match and valid embedded-font evidence", () => {
    const requirements = readDocxFontRequirements([deedTemplate, transferTemplate]);
    const readiness = assessDocxFontReadiness(requirements, (family) =>
      family === "Cambria" ? "Cambria" : "Liberation Serif",
    );

    expect(readiness.find((font) => font.family === "Cambria")).toMatchObject({
      installedExactMatch: true,
      embeddedInTemplate: false,
      ready: true,
    });
    expect(readiness.find((font) => font.family === "Georgia")).toMatchObject({
      installedExactMatch: false,
      embeddedInTemplate: false,
      ready: false,
    });
    expect(readiness.find((font) => font.family === "Palatino Linotype")).toMatchObject({
      installedExactMatch: false,
      embeddedInTemplate: true,
      ready: true,
    });
    expect(() =>
      assertDocxFontsAvailable(deedTemplate, (family) =>
        family === "Cambria" ? "Cambria" : "Liberation Serif",
      ),
    ).toThrow(/Georgia.*no valid embedded font data/i);
    expect(() =>
      assertDocxFontsAvailable(deedTemplate, (family) => family),
    ).not.toThrow();
  });

  it.each(["production", "development"])(
    "uses authorized fallback before attempting real conversion in %s",
    async (environment) => {
      const previousEnvironment = process.env.NODE_ENV;
      process.env.NODE_ENV = environment;
      try {
        await expect(
          convertDocxToPdf(addUnavailableFontFamily(renderedDeed()), {
            libreOfficePath: "/missing/libreoffice",
            resolveFontFamily: (family) => family === "Liberation Serif" ? family : "Liberation Serif",
          }),
        ).rejects.toThrow(
          /LibreOffice DOCX-to-PDF conversion failed|could not start/i,
        );
      } finally {
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
      }
    },
  );

  it("uses the same fallback policy in tests, without a font-verification bypass", async () => {
    await expect(
      convertDocxToPdf(addUnavailableFontFamily(renderedDeed()), {
        libreOfficePath: "/missing/libreoffice",
      }),
    ).rejects.toThrow(/LibreOffice DOCX-to-PDF conversion failed|could not start/);
  });

  it("classifies immutable recovery font failures separately from fallback and font-service failures", async () => {
    const source = addUnavailableFontFamily(renderedDeed());
    await expect(convertDocxToPdf(source, {
      preserveTypography: true,
      resolveFontFamily: () => "Substitute Serif",
    })).rejects.toMatchObject({ kind: "recovery-fonts" });
    await expect(convertDocxToPdf(source, {
      preserveTypography: true,
      resolveFontFamily: () => { throw new Error("font service unavailable"); },
    })).rejects.toMatchObject({ kind: "font-service" });
  });

  it("retains byte-identical original typography and sizing when every required font is ready", () => {
    const original = renderedDeed();
    expect(prepareLegalDocxTypography(original, (family) => family)).toBe(original);
  });

  it("normalizes every supported text part, inheritance and theme without altering wording, emphasis or media", () => {
    const source = addUnavailableFontFamily(renderedDeed());
    const zip = new PizZip(source);
    const fragment = '<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="40"/><w:szCs w:val="32"/><w:b/><w:i/><w:u w:val="single"/></w:rPr><w:t>Clause &amp; {{USER_FULL_NAME}}</w:t></w:r><w:r><w:t>Inherited size</w:t></w:r></w:p>';
    zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("<w:body>", `<w:body><w:tbl><w:tr><w:tc>${fragment}</w:tc></w:tr></w:tbl>`));
    for (const [part, root] of [["header1", "hdr"], ["footer1", "ftr"], ["footnotes", "footnotes"], ["endnotes", "endnotes"], ["comments", "comments"]]) {
      zip.file(`word/${part}.xml`, `<w:${root} xmlns:w="${WORD_NS}">${fragment}</w:${root}>`);
    }
    zip.file("word/drawing.xml", `<a:txBody xmlns:a="${DRAWING_NS}"><a:p><a:r><a:rPr sz="3000" b="1" i="1" u="sng"><a:latin typeface="Missing Serif"/></a:rPr><a:t>Drawing clause</a:t></a:r><a:r><a:t>Inherited drawing text</a:t></a:r></a:p></a:txBody>`);
    zip.file("word/media/preserved.png", Buffer.from("unaltered signature pixels"));
    const input = zip.generate({ type: "nodebuffer" });
    const copy = Buffer.from(input);
    const prepared = prepareLegalDocxTypography(input, () => "Liberation Serif");
    expect(input).toEqual(copy);
    const normalized = new PizZip(prepared);
    expect(readDocxFontRequirements([prepared]).families).toEqual(["Liberation Serif"]);
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (name.endsWith(".rels") && name !== "word/_rels/fontTable.xml.rels" || name.startsWith("word/media/")) {
        expect(normalized.file(name)!.asNodeBuffer(), name).toEqual(entry.asNodeBuffer());
      }
      if (!/^word\/.*\.xml$/.test(name) || name === "word/fontTable.xml") continue;
      const original = parseFontXml(entry.asText());
      const result = parseFontXml(normalized.file(name)!.asText());
      for (const [namespace, tag] of [[WORD_NS, "t"], [DRAWING_NS, "t"], [WORD_NS, "b"], [WORD_NS, "i"], [WORD_NS, "u"]]) {
        expect(fontElements(result, namespace, tag).map((node) => node.toString()), `${name}:${tag}`)
          .toEqual(fontElements(original, namespace, tag).map((node) => node.toString()));
      }
      for (const properties of fontElements(result, WORD_NS, "rPr")) {
        expect(properties.getElementsByTagNameNS(WORD_NS, "rFonts")[0].getAttributeNS(WORD_NS, "ascii")).toBe("Liberation Serif");
        expect(properties.getElementsByTagNameNS(WORD_NS, "sz")[0].getAttributeNS(WORD_NS, "val")).toBe("24");
        expect(properties.getElementsByTagNameNS(WORD_NS, "szCs")[0].getAttributeNS(WORD_NS, "val")).toBe("24");
      }
      expect(normalized.file(name)!.asText()).not.toMatch(/w:(?:ascii|hAnsi|eastAsia|cs)Theme=/);
      for (const properties of fontElements(result, DRAWING_NS, "rPr")) {
        expect(properties.getAttribute("sz")).toBe("1200");
        expect(properties.getElementsByTagNameNS(DRAWING_NS, "latin")[0].getAttribute("typeface")).toBe("Liberation Serif");
      }
    }
    expect(normalized.file("word/_rels/fontTable.xml.rels")).toBeNull();
    expect(Object.keys(normalized.files).filter((name) => name.startsWith("word/fonts/"))).toEqual([]);
    expect(prepareLegalDocxTypography(prepared, () => "Liberation Serif")).toBe(prepared);
  });

  it("distinguishes missing fallback, corrupt metadata, and unavailable verification infrastructure", () => {
    const source = addUnavailableFontFamily(renderedDeed());
    expect(() => prepareDocxForPdf(source, () => "Different Serif")).toThrow(/authorized Liberation Serif.*unavailable/);
    expect(() => prepareDocxForPdf(source, (_family, style) =>
      style === "Bold Italic" ? "Substitute Serif" : "Liberation Serif",
    )).toThrow(/authorized Liberation Serif 12-point fallback is unavailable/);
    for (const resolver of [() => "", () => { throw new Error("service down"); }]) {
      try { prepareDocxForPdf(source, resolver); throw new Error("Expected rejection"); } catch (error) {
        expect(error).toMatchObject({ kind: "font-service" });
      }
    }
    const zip = new PizZip(source);
    zip.file("word/styles.xml", '<w:styles xmlns:w="' + WORD_NS + '"><w:rPr></w:styles>');
    expect(() => prepareDocxForPdf(zip.generate({ type: "nodebuffer" }), () => "Liberation Serif")).toThrow(/malformed font XML/);
    const invalidFamily = new PizZip(source);
    invalidFamily.file("word/document.xml", invalidFamily.file("word/document.xml")!.asText().replace('w:ascii="', `w:ascii="${"X".repeat(129)}`));
    expect(() => prepareDocxForPdf(invalidFamily.generate({ type: "nodebuffer" }), () => "Liberation Serif")).toThrow(/invalid font-family metadata/);
  });

  it("resolves inherited theme-only requirements rather than silently accepting unavailable theme fonts", () => {
    const zip = new PizZip(renderedDeed());
    zip.file("word/styles.xml", `<w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
    zip.file("word/theme/theme1.xml", `<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:fontScheme name="Theme"><a:minorFont><a:latin typeface="Unavailable Theme Serif"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
    const input = zip.generate({ type: "nodebuffer" });
    expect(readDocxFontRequirements([input]).families).toContain("Unavailable Theme Serif");
    expect(readDocxFontRequirements([prepareLegalDocxTypography(input, () => "Liberation Serif")]).families).toEqual(["Liberation Serif"]);
  });

  it("honors theme precedence including complex-script theme references without changing ready documents", () => {
    const zip = new PizZip(renderedDeed());
    zip.file("word/styles.xml", `<w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Stale Cached Family" w:asciiTheme="minorHAnsi" w:cstheme="minorBidi"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
    zip.file("word/theme/theme1.xml", `<a:theme xmlns:a="${DRAWING_NS}"><a:themeElements><a:fontScheme name="Theme"><a:minorFont><a:latin typeface="Verified Theme Serif"/><a:cs typeface="Verified Complex Serif"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
    const input = zip.generate({ type: "nodebuffer" });
    expect(readDocxFontRequirements([input]).families).toContain("Verified Complex Serif");
    expect(readDocxFontRequirements([input]).families).not.toContain("Stale Cached Family");
    expect(prepareLegalDocxTypography(input, (family) => family)).toBe(input);
  });

  it("creates verified document defaults for a valid DOCX without a styles part", () => {
    const zip = new PizZip(addUnavailableFontFamily(renderedDeed()));
    zip.remove("word/styles.xml");
    const prepared = new PizZip(prepareLegalDocxTypography(zip.generate({ type: "nodebuffer" }), () => "Liberation Serif"));
    const styles = parseFontXml(prepared.file("word/styles.xml")!.asText());
    const defaults = fontElements(styles, WORD_NS, "docDefaults")[0];
    expect(defaults.getElementsByTagNameNS(WORD_NS, "sz")[0].getAttributeNS(WORD_NS, "val")).toBe("24");
    expect(prepared.file("word/_rels/document.xml.rels")!.asText()).toContain("/styles");
    expect(prepared.file("[Content_Types].xml")!.asText()).toContain('PartName="/word/styles.xml"');
  });

  it("does not bypass the real signature check when whole-document fallback moves a supplied deed's blocks", async () => {
    const supplied = normalizeSuppliedLegalTemplate(readFileSync(path.join(projectRoot, "attached_assets/DEED_OF_ASSIGNMENT_BRIKVEST_1790828516010.docx")));
    const source = renderLegalTemplate(supplied, "deed_of_assignment", {
      USER_FULL_NAME: "Illustrative Example — Not for Execution",
      USER_HOME_ADDRESS: "1 Example Street, Abuja", PROPERTY_AREA_SQM: "20",
      PAYMENT_AMOUNT_NAIRA_NUMERIC: "1,000,000", PAYMENT_AMOUNT_NAIRA_WORDS: "One Million Naira",
      DOCUMENT_DATE: "30th September 2026", DOCUMENT_DATE_DAY: "30th",
      DOCUMENT_DATE_MONTH: "September", DOCUMENT_DATE_YEAR: "2026",
    });
    const pdf = await convertDocxToPdf(source, { resolveFontFamily: () => "Liberation Serif" });
    await expect(verifyAssigneeSignaturePosition(pdf, {
      assigneeFullName: "Illustrative Example — Not for Execution", templateVersionId: "deed:isolated",
    })).rejects.toMatchObject({ kind: "layout" });
  }, 60_000);

  it.each(["development", "production"])("converts both legal types and checks final fallback PDF positions under %s policy", async (environment) => {
    const previous = process.env.NODE_ENV;
    const previousFontConfig = process.env.FONTCONFIG_FILE;
    process.env.NODE_ENV = environment;
    process.env.FONTCONFIG_FILE = path.join(projectRoot, "server/legal/fonts/fontconfig.conf");
    const directory = mkdtempSync(path.join(tmpdir(), "legal-serif-policy-"));
    try {
      for (const type of ["deed_of_assignment", "transfer_exit_rights"] as const) {
        const supplied = readFileSync(path.join(projectRoot, type === "deed_of_assignment"
          ? "attached_assets/DEED_OF_ASSIGNMENT_BRIKVEST_1790828516010.docx"
          : "attached_assets/TRANSFER_AND_EXIT_RIGHT_AGREEMENT_1790828516011.docx"));
        const fixture = new PizZip(normalizeSuppliedLegalTemplate(supplied));
        const document = fixture.file("word/document.xml")!.asText();
        const section = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)![0];
        const drawing = document.match(/<w:drawing\b[\s\S]*?<\/w:drawing>/)![0];
        const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
        const compactBody = `<w:p><w:r>${drawing}</w:r></w:p>` +
          paragraph("{{USER_HOME_ADDRESS}} / {{PROPERTY_AREA_SQM}} / {{DOCUMENT_DATE}}") +
          (type === "deed_of_assignment" ? paragraph("{{PAYMENT_AMOUNT_NAIRA_NUMERIC}} / {{PAYMENT_AMOUNT_NAIRA_WORDS}}") : "") +
          paragraph("SIGNED SEALED AND DELIVERED") + paragraph("By the within-named ASSIGNEE") +
          paragraph("{{USER_FULL_NAME}}") + section;
        fixture.file("word/document.xml", document.replace(/<w:body>[\s\S]*?<\/w:body>/, `<w:body>${compactBody}</w:body>`));
        const source = renderLegalTemplate(fixture.generate({ type: "nodebuffer" }), type, {
          USER_FULL_NAME: "Ada Lovelace", USER_HOME_ADDRESS: "1 Example Street, Abuja",
          PROPERTY_AREA_SQM: "20", PAYMENT_AMOUNT_NAIRA_NUMERIC: "1,000,000",
          PAYMENT_AMOUNT_NAIRA_WORDS: "One Million Naira", DOCUMENT_DATE: "30th September 2026",
          DOCUMENT_DATE_DAY: "30th", DOCUMENT_DATE_MONTH: "September", DOCUMENT_DATE_YEAR: "2026",
        });
        const deploymentFontResolver = (family: string, style?: string, exact?: boolean) =>
          family === "Liberation Serif"
            ? resolveFontconfigFamily(family, style, exact)
            : "Unavailable source font";
        const working = prepareDocxForPdf(addUnavailableFontFamily(source), deploymentFontResolver);
        const pdf = await convertDocxToPdf(working, {
          preserveTypography: true,
          resolveFontFamily: deploymentFontResolver,
        });
        const filename = path.join(directory, `${type}.pdf`);
        writeFileSync(filename, pdf);
        const fonts = execFileSync("pdffonts", [filename], { encoding: "utf8" });
        expect(fonts).toContain("LiberationSerif");
        expect(fonts).not.toMatch(/Cambria|Georgia|Palatino|Calibri/);
        const images = execFileSync("pdfimages", ["-list", filename], { encoding: "utf8" });
        expect(images).toMatch(/\simage\s/);
        await expect(verifyAssigneeSignaturePosition(pdf, {
          assigneeFullName: "Ada Lovelace", templateVersionId: `${type}:fixture`,
        })).resolves.toMatchObject({ anchorText: "Ada Lovelace" });
        await expect(verifyAssigneeSignaturePosition(pdf, {
          assigneeFullName: "Wrong Person", templateVersionId: `${type}:fixture`,
        })).rejects.toMatchObject({ kind: "layout" });
        await expect(verifyAssigneeSignaturePosition(pdf, {
          assigneeFullName: "Ada Lovelace", templateVersionId: `${type}:fixture`, pdftotextPath: "/missing/extractor",
        })).rejects.toMatchObject({ kind: "service" });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
      if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
      if (previousFontConfig === undefined) delete process.env.FONTCONFIG_FILE;
      else process.env.FONTCONFIG_FILE = previousFontConfig;
    }
  }, 120_000);
});