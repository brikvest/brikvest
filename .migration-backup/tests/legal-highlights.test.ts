import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import PizZip from "pizzip";
import type { Element } from "@xmldom/xmldom";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { removeLegalDocxHighlights } from "../server/legal/highlights";
import { convertDocxToPdf, prepareDocxForPdf, verifyAssigneeSignaturePosition } from "../server/legal/converter";
import { normalizeSuppliedLegalTemplate, renderIllustrativeLegalTemplate, renderLegalTemplate } from "../server/legal/templates";
import { WORD_NS, DRAWING_NS, parseFontXml, fontElements } from "../server/legal/font-xml";
import { buildIllustrativeTemplateValues } from "../server/legal/values";
import { renderLocallySignedPdf, sha256Hex } from "../server/legal/local-pdf-signature";
import { expectWhiteTextBackgrounds, inspectPdfTextBackgrounds } from "./helpers/legal-highlight-pdf";

const templates = {
  deed_of_assignment: readFileSync(new URL("../server/legal/template-assets/deed_of_assignment_v1.docx", import.meta.url)),
  transfer_exit_rights: readFileSync(new URL("../server/legal/template-assets/transfer_exit_rights_v1.docx", import.meta.url)),
};
const suppliedTemplates = {
  deed_of_assignment: readFileSync(new URL("../attached_assets/DEED_OF_ASSIGNMENT_BRIKVEST_1790828516010.docx", import.meta.url)),
  transfer_exit_rights: readFileSync(new URL("../attached_assets/TRANSFER_AND_EXIT_RIGHT_AGREEMENT_1790828516011.docx", import.meta.url)),
};
const values = {
  USER_FULL_NAME: "Ada Lovelace", USER_HOME_ADDRESS: "1 Example Street, Abuja",
  PROPERTY_AREA_SQM: "20", PAYMENT_AMOUNT_NAIRA_NUMERIC: "1,000,000",
  PAYMENT_AMOUNT_NAIRA_WORDS: "One Million Naira", DOCUMENT_DATE: "30th September 2026",
  DOCUMENT_DATE_DAY: "30th", DOCUMENT_DATE_MONTH: "September", DOCUMENT_DATE_YEAR: "2026",
};
const colors = ["yellow", "green", "cyan", "magenta", "blue", "red", "darkBlue", "darkCyan",
  "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray", "black", "white"];
const probes = colors.map((_, index) => `ColorProbe${index}`);
const run = (text: string, properties = "") =>
  `<w:r><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/><w:sz w:val="24"/>${properties}</w:rPr><w:t>${text}</w:t></w:r>`;
const paragraph = (text: string, properties = "") => `<w:p>${run(text, properties)}</w:p>`;

function fixture(): Buffer {
  const zip = new PizZip(templates.deed_of_assignment);
  zip.file("word/styles.xml", `<w:styles xmlns:w="${WORD_NS}">
    <w:docDefaults><w:rPrDefault><w:rPr><w:highlight w:val="yellow"/><w:shd w:fill="00FF00"/></w:rPr></w:rPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="Base"><w:rPr><w:highlight w:val="cyan"/><w:shd w:fill="FF00FF"/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="Derived"><w:basedOn w:val="Base"/><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:type="table" w:styleId="Design"><w:tblPr><w:shd w:fill="112233"/></w:tblPr><w:tcPr><w:shd w:fill="ABCDEF"/></w:tcPr></w:style>
  </w:styles>`);
  const document = zip.file("word/document.xml")!.asText();
  const section = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)![0];
  const content = colors.map((color, index) => paragraph(probes[index], `<w:highlight w:val="${color}"/>`)).join("") +
    paragraph("DefaultProbe") + paragraph("InheritedProbe", '<w:rStyle w:val="Derived"/>') +
    paragraph("ShadingProbe", '<w:shd w:val="clear" w:fill="FFA500"/>') +
    `<w:p>${run("{{USER_", '<w:highlight w:val="green"/>')}${run("FULL_NAME}}", '<w:highlight w:val="red"/>')}</w:p>` +
    paragraph("{{USER_HOME_ADDRESS}} {{PROPERTY_AREA_SQM}} {{PAYMENT_AMOUNT_NAIRA_NUMERIC}} {{PAYMENT_AMOUNT_NAIRA_WORDS}} {{DOCUMENT_DATE}}") +
    `<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="FFFFFF"/></w:tcPr>${paragraph("TableProbe", '<w:highlight w:val="magenta"/>')}</w:tc></w:tr></w:tbl>` +
    `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="Box" style="width:200pt;height:30pt" stroked="f" filled="f"><v:textbox><w:txbxContent>${paragraph("BoxProbe", '<w:highlight w:val="cyan"/>')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>` +
    paragraph("SIGNED SEALED AND DELIVERED") + paragraph("By the within-named ASSIGNEE") + paragraph("{{USER_FULL_NAME}}") + section;
  zip.file("word/document.xml", document.replace(/<w:body>[\s\S]*?<\/w:body>/, `<w:body>${content}</w:body>`));
  zip.file("word/header1.xml", `<w:hdr xmlns:w="${WORD_NS}">${paragraph("HeaderProbe", '<w:highlight w:val="green"/>')}</w:hdr>`);
  zip.file("word/footer1.xml", `<w:ftr xmlns:w="${WORD_NS}">${paragraph("FooterProbe", '<w:highlight w:val="yellow"/>')}</w:ftr>`);
  let rels = zip.file("word/_rels/document.xml.rels")!.asText();
  // Deterministic header reference, whether or not the base template has one.
  rels = rels.replace(/<Relationship\b[^>]*Target="header1.xml"[^>]*\/>/g, "");
  if (!rels.includes('Target="header1.xml"')) {
    zip.file("word/_rels/document.xml.rels", rels.replace("</Relationships>", '<Relationship Id="rIdProbeHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>'));
  }
  const types = zip.file("[Content_Types].xml")!.asText();
  if (!types.includes('/word/header1.xml')) zip.file("[Content_Types].xml", types.replace("</Types>", '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
  const xml = zip.file("word/document.xml")!.asText().replace(/<w:headerReference\b[^>]*\/>/g, "");
  zip.file("word/document.xml", xml.replace(/(<w:sectPr[^>]*>)/, '$1<w:headerReference w:type="default" r:id="rIdProbeHeader"/>'));
  return zip.generate({ type: "nodebuffer" });
}

function expectClean(buffer: Buffer): void {
  for (const [name, entry] of Object.entries(new PizZip(buffer).files)) {
    if (entry.dir || !/^word\/.*\.xml$/.test(name)) continue;
    const xml = parseFontXml(entry.asText());
    for (const namespace of [WORD_NS, DRAWING_NS, "http://purl.oclc.org/ooxml/wordprocessingml/main", "http://purl.oclc.org/ooxml/drawingml/main"]) {
      expect(fontElements(xml, namespace, "highlight"), name).toHaveLength(0);
    }
    for (const shading of fontElements(xml, WORD_NS, "shd")) expect((shading.parentNode as Element).localName).not.toBe("rPr");
  }
}

describe("output-only legal highlight policy", () => {
  it("cleans all parts and inherited markers losslessly, with alternate prefixes and strict namespaces", () => {
    const source = fixture();
    const zip = new PizZip(source);
    zip.file("word/notes.xml", `<?xml version="1.0"?>\r\n<x:root xmlns:x="${WORD_NS}" xmlns:d="${DRAWING_NS}" xmlns:other="urn:unrelated">
      <x:rPr><x:highlight x:val='darkBlue'></x:highlight><x:shd x:fill="ABCDEF"/><x:b/><x:i/><x:color x:val="00FF00"/></x:rPr>
      <d:rPr><d:highlight><d:srgbClr val="FFAA00"/></d:highlight><d:solidFill><d:srgbClr val="123456"/></d:solidFill></d:rPr>
      <d:defRPr><d:highlight><d:schemeClr val="accent1"/></d:highlight></d:defRPr><d:endParaRPr><d:highlight><d:sysClr val="window"/></d:highlight></d:endParaRPr>
      <x:pPr><x:shd x:fill="778899"/></x:pPr><x:tcPr><x:shd x:fill="334455"/></x:tcPr>
      <other:highlight>not a marker</other:highlight><x:t>Static wording &amp; values</x:t>
      <s:rPr xmlns:s="http://purl.oclc.org/ooxml/wordprocessingml/main"><s:highlight s:val="red"/><s:shd s:fill="000000"/></s:rPr>
      <q:rPr xmlns:q="http://purl.oclc.org/ooxml/drawingml/main"><q:highlight><q:srgbClr val="ABCDEF"/></q:highlight></q:rPr>
      <rPr xmlns="${WORD_NS}"><highlight val="green"/><shd fill="FF00FF"/><b/></rPr>
    </x:root>`);
    const input = zip.generate({ type: "nodebuffer" });
    const snapshot = Buffer.from(input);
    const output = removeLegalDocxHighlights(input);
    expectClean(output);
    expect(input).toEqual(snapshot);
    expect(removeLegalDocxHighlights(output)).toBe(output);
    const cleanZip = new PizZip(output);
    expect(Object.keys(cleanZip.files)).toEqual(Object.keys(zip.files));
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const xml = name.endsWith(".xml") ? entry.asText() : "";
      if (!xml.includes(":highlight") && !xml.includes("<w:shd") && !xml.includes("<x:shd") && !xml.includes("<s:shd")) {
        expect(cleanZip.file(name)!.asNodeBuffer(), name).toEqual(entry.asNodeBuffer());
      }
    }
    const notes = cleanZip.file("word/notes.xml")!.asText();
    expect(notes).toContain('<x:b/><x:i/><x:color x:val="00FF00"/>');
    expect(notes).toContain('<d:solidFill><d:srgbClr val="123456"/></d:solidFill>');
    expect(notes).toContain('<x:pPr><x:shd x:fill="778899"/></x:pPr>');
    expect(notes).toContain('<x:tcPr><x:shd x:fill="334455"/></x:tcPr>');
    expect(notes).toContain("<other:highlight>not a marker</other:highlight>");
    expect(notes).toContain("Static wording &amp; values");
    expect(notes).toContain(`<rPr xmlns="${WORD_NS}"><b/></rPr>`);
    expect(cleanZip.file("word/styles.xml")!.asText()).toContain('<w:tcPr><w:shd w:fill="ABCDEF"/></w:tcPr>');
  });

  it("cleans both bundled rendered working copies and previews without altering template or media bytes", () => {
    for (const [type, source] of Object.entries(templates) as Array<[keyof typeof templates, Buffer]>) {
      const before = Buffer.from(source);
      expect(new PizZip(source).file("word/document.xml")!.asText()).toContain("w:highlight");
      for (const output of [renderLegalTemplate(source, type, values), renderIllustrativeLegalTemplate(source, type).renderedDocx]) {
        expectClean(output);
        for (const [name, entry] of Object.entries(new PizZip(source).files)) {
          if (!entry.dir && (name.startsWith("word/media/") || name.endsWith(".rels"))) {
            expect(new PizZip(output).file(name)!.asNodeBuffer(), name).toEqual(entry.asNodeBuffer());
          }
        }
      }
      expect(source).toEqual(before);
    }
    const split = renderLegalTemplate(fixture(), "deed_of_assignment", values);
    expectClean(split);
    expect(new PizZip(split).file("word/document.xml")!.asText()).toContain("Ada Lovelace");
    const rehighlighted = new PizZip(split);
    rehighlighted.file("word/document.xml", rehighlighted.file("word/document.xml")!.asText().replace("<w:rPr>", '<w:rPr><w:highlight w:val="green"/>'));
    expectClean(prepareDocxForPdf(rehighlighted.generate({ type: "nodebuffer" }), (family) => family));
  });

  it("removes visible backgrounds in real LibreOffice output in BOTH conversion branches, with positive dirty controls", async () => {
    const rendered = renderLegalTemplate(fixture(), "deed_of_assignment", values);
    // Reintroduce every marker into an already-rendered disposable working copy,
    // so neither boundary check can pass merely because the renderer was clean.
    const dirty = new PizZip(fixture());
    const clean = new PizZip(rendered);
    dirty.file("word/document.xml", clean.file("word/document.xml")!.asText().replace(
      /<w:rPr>([\s\S]*?)<\/w:rPr><w:t>(ColorProbe(\d+)|ShadingProbe|DefaultProbe|InheritedProbe|HeaderProbe|FooterProbe|TableProbe|BoxProbe)/g,
      (_match, properties, token, index) => `<w:rPr>${properties}${index === undefined ? '<w:shd w:fill="FFA500"/>' : `<w:highlight w:val="${colors[Number(index)]}"/>`}</w:rPr><w:t>${token}`,
    ));
    const input = dirty.generate({ type: "nodebuffer" });
    const snapshot = Buffer.from(input);
    const tokens = [...probes, "ShadingProbe", "DefaultProbe", "InheritedProbe", "TableProbe", "BoxProbe", "HeaderProbe", "FooterProbe"];
    const dir = mkdtempSync(path.join(tmpdir(), "legal-dirty-control-"));
    try {
      writeFileSync(path.join(dir, "dirty.docx"), input);
      execFileSync("soffice", [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "pdf", "--outdir", dir, path.join(dir, "dirty.docx")], { timeout: 60_000 });
      const fractions = inspectPdfTextBackgrounds(readFileSync(path.join(dir, "dirty.pdf")), tokens);
      for (const token of probes.filter((_, index) => colors[index] !== "white")) expect(fractions[token], `dirty control ${token}`).toBeLessThan(0.35);
      for (const preserveTypography of [false, true]) {
        const pdf = await convertDocxToPdf(input, { preserveTypography, resolveFontFamily: (family) => family });
        expectWhiteTextBackgrounds(pdf, tokens);
        await expect(verifyAssigneeSignaturePosition(pdf, { assigneeFullName: values.USER_FULL_NAME, templateVersionId: "highlight-fixture" })).resolves.toMatchObject({ anchorText: values.USER_FULL_NAME });
      }
      expect(input).toEqual(snapshot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("keeps both real illustrative PDFs and their supplied signatures clean, and signs a clean base without altering it", async () => {
    for (const [type, source] of [...Object.entries(templates), ...Object.entries(suppliedTemplates)] as Array<[keyof typeof templates, Buffer]>) {
      const hasSuppliedImages = Object.keys(new PizZip(source).files).some((name) => name.startsWith("word/media/"));
      const preview = renderIllustrativeLegalTemplate(normalizeSuppliedLegalTemplate(source), type);
      const pdf = await convertDocxToPdf(preview.renderedDocx, { resolveFontFamily: (family) => family });
      expectWhiteTextBackgrounds(pdf, ["Illustrative", "September", "2026"]);
      const dir = mkdtempSync(path.join(tmpdir(), "legal-highlight-media-"));
      try {
        const file = path.join(dir, "preview.pdf");
        writeFileSync(file, pdf);
        if (hasSuppliedImages) expect(execFileSync("pdfimages", ["-list", file], { encoding: "utf8" })).toMatch(/\d+\s+\d+\s+image/);
        const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
        expect(text).toContain("SIGNED");
        expect(text).toContain("ASSIGNEE");
        await verifyAssigneeSignaturePosition(pdf, { assigneeFullName: buildIllustrativeTemplateValues(type).USER_FULL_NAME, templateVersionId: type });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    const pdf = await convertDocxToPdf(renderLegalTemplate(fixture(), "deed_of_assignment", values));
    const baseHash = sha256Hex(pdf);
    const placement = await verifyAssigneeSignaturePosition(pdf, { assigneeFullName: values.USER_FULL_NAME, templateVersionId: "clean-signing" });
    const png = new PNG({ width: 100, height: 30 });
    for (let x = 5; x < 95; x++) {
      const offset = (15 * png.width + x) * 4;
      png.data[offset + 3] = 255;
      png.data[offset + png.width * 4 + 3] = 255;
    }
    const signaturePng = PNG.sync.write(png);
    const signed = await renderLocallySignedPdf({
      unsignedPdf: pdf, signaturePng, placement, signerName: values.USER_FULL_NAME, signatureMethod: "drawn",
      documentType: "deed_of_assignment", operationId: 159, unsignedPdfSha256: baseHash,
      signaturePngSha256: sha256Hex(signaturePng), signedAt: new Date("2026-10-02T12:00:00Z"),
    });
    expect(sha256Hex(pdf)).toBe(baseHash);
    expectWhiteTextBackgrounds(signed, [...probes, "DefaultProbe", "InheritedProbe", "ShadingProbe"]);
  }, 180_000);
});