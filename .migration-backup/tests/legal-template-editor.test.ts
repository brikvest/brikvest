import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { editTemplateWording, readTemplateEditor } from "../server/legal/template-editor";
import { validateLegalTemplate } from "../server/legal/templates";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function source(extra = "") {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file("word/document.xml", `<w:document xmlns:w="${WORD}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>DEED OF ASSIGNMENT</w:t></w:r></w:p>
    <w:p><w:r><w:t>Granted to </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>{{USER_</w:t></w:r><w:r><w:t>FULL_NAME}}</w:t></w:r><w:r><w:t> at {{USER_HOME_ADDRESS}}.</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>The land is {{PROPERTY_AREA_SQM}} sqm.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>Consideration {{PAYMENT_AMOUNT_NAIRA_NUMERIC}} ({{PAYMENT_AMOUNT_NAIRA_WORDS}}) on {{DOCUMENT_DATE}}.</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><w:picture/></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>First</w:t><w:br/><w:t>Second</w:t><w:tab/><w:t>Third</w:t></w:r></w:p>
    <w:p/><w:p><w:r><w:t>Emoji 😀 and café &amp; land</w:t></w:r></w:p>
    ${extra}<w:sectPr/></w:body></w:document>`);
  zip.file("word/header1.xml", `<w:hdr xmlns:w="${WORD}"><w:p><w:r><w:t>Original heading</w:t></w:r></w:p></w:hdr>`);
  zip.file("word/footer1.xml", `<w:ftr xmlns:w="${WORD}"><w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:t>1</w:t></w:r></w:p></w:ftr>`);
  zip.file("word/media/signature.png", Buffer.from("immutable-signature-image"));
  zip.file("word/styles.xml", "<styles>immutable formatting</styles>");
  zip.file("word/_rels/document.xml.rels", "<Relationships>immutable references</Relationships>");
  return zip.generate({ type: "nodebuffer" });
}
const bodyParagraphs = (bytes: Buffer) => readTemplateEditor(bytes).find(section => section.id === "word/document.xml")!.paragraphs;
const change = (index: number, text: string) => ({ id: `word/document.xml:${index}`, text });

describe("in-app legal template wording", () => {
  it("extracts body, table, header and footer text, including split placeholders", () => {
    const sections = readTemplateEditor(source());
    expect(sections.map(section => section.name)).toEqual(["Document", "footer 1", "header 1"]);
    const paragraphs = sections[0].paragraphs;
    expect(paragraphs[1].tokens).toEqual(["{{USER_FULL_NAME}}", "{{USER_HOME_ADDRESS}}"]);
    expect(paragraphs[2].alignment).toBe("center");
    expect(paragraphs[4].editable).toBe(false);
    expect(paragraphs[5].text).toBe("First\nSecond\tThird");
    expect(sections[1].paragraphs[0].editable).toBe(false);
  });
  it("updates wording while retaining assets, table layout, styles, source and field counts", () => {
    const original = source();
    const snapshot = Buffer.from(original);
    const edited = editTemplateWording(original, [change(1, "Assigned to {{USER_FULL_NAME}} at {{USER_HOME_ADDRESS}}.")]);
    expect(edited.changedParagraphs).toBe(1);
    const zip = new PizZip(edited.bytes);
    for (const path of ["word/media/signature.png", "word/styles.xml", "word/_rels/document.xml.rels", "word/header1.xml", "word/footer1.xml"]) {
      expect(zip.file(path)!.asUint8Array()).toEqual(new PizZip(original).file(path)!.asUint8Array());
    }
    const xml = zip.file("word/document.xml")!.asText();
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("<w:drawing>");
    expect(original.equals(snapshot)).toBe(true);
    expect(bodyParagraphs(edited.bytes)[1].text).toBe("Assigned to {{USER_FULL_NAME}} at {{USER_HOME_ADDRESS}}.");
    expect(validateLegalTemplate(edited.bytes, "deed_of_assignment").placeholderCounts)
      .toEqual(validateLegalTemplate(original, "deed_of_assignment").placeholderCounts);
  });
  it("escapes XML text, preserves whitespace and supports line breaks, tabs and empty paragraphs", () => {
    const edited = editTemplateWording(source(), [
      change(0, "  DEED <literal> & ASSIGNMENT  "),
      change(5, "First\nReplacement\tLast"),
      change(6, "An additional clause.\nAnother line."),
      change(7, "Emoji 😁 and café & land"),
    ]);
    const paragraphs = bodyParagraphs(edited.bytes);
    expect(paragraphs[0].text).toBe("  DEED <literal> & ASSIGNMENT  ");
    expect(paragraphs[5].text).toBe("First\nReplacement\tLast");
    expect(paragraphs[6].text).toBe("An additional clause.\nAnother line.");
    expect(paragraphs[7].text).toBe("Emoji 😁 and café & land");
    expect(paragraphs[6].editable).toBe(true);
    const xml = new PizZip(edited.bytes).file("word/document.xml")!.asText();
    expect(xml).toContain("&lt;literal&gt;");
    expect(xml).toContain('xml:space="preserve"');
    expect(new DOMParser().parseFromString(xml, "application/xml").getElementsByTagNameNS(WORD, "p").length).toBe(8);
  });
  it("supports editing an already edited draft and a header", () => {
    const first = editTemplateWording(source(), [change(0, "New title\nSecond line")]);
    const second = editTemplateWording(first.bytes, [
      change(0, "Final title\nThird line"),
      { id: "word/header1.xml:0", text: "New heading" },
    ]);
    expect(bodyParagraphs(second.bytes)[0].text).toBe("Final title\nThird line");
    expect(readTemplateEditor(second.bytes).find(section => section.id === "word/header1.xml")!.paragraphs[0].text).toBe("New heading");
  });
  it("retains the formatting of split fields even when wording changes on both sides", () => {
    const text = "Assigned happily to {{USER_FULL_NAME}} now residing at {{USER_HOME_ADDRESS}}; accepted.";
    const edited = editTemplateWording(source(), [change(1, text)]);
    const xml = new PizZip(edited.bytes).file("word/document.xml")!.asText();
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const italic = document.getElementsByTagNameNS(WORD, "i")[0].parentNode!.parentNode!;
    expect(italic.textContent).toBe("{{USER_");
    expect(bodyParagraphs(edited.bytes)[1].text).toBe(text);
  });
  it.each([
    [1, "Missing name at {{USER_HOME_ADDRESS}}."],
    [1, "Changed {{RENAMED_FIELD}} at {{USER_HOME_ADDRESS}}."],
    [1, "{{USER_HOME_ADDRESS}} followed by {{USER_FULL_NAME}}."],
    [1, "{{USER_FULL_NAME}} {{USER_FULL_NAME}} {{USER_HOME_ADDRESS}}."],
    [0, "New {{USER_FULL_NAME}}"],
  ])("rejects moving, renaming, removing or duplicating automatic fields", (index, text) => {
    expect(() => editTemplateWording(source(), [change(index, text)])).toThrow("automatic {{FIELD}}");
  });
  it("rejects protected structures, nonexistent paragraphs, invalid data and unchanged saves", () => {
    expect(() => editTemplateWording(source(), [change(4, "replace image")])).toThrow("Protected Word");
    expect(() => editTemplateWording(source(), [{ id: "word/footer1.xml:0", text: "Replace page field" }])).toThrow("Protected Word");
    expect(() => editTemplateWording(source(), [change(99, "unknown")])).toThrow("not in this source");
    expect(() => editTemplateWording(source(), [change(0, "one"), change(0, "two")])).toThrow("more than once");
    expect(() => editTemplateWording(source(), [change(0, "invalid\u0000")])).toThrow("invalid");
    expect(() => editTemplateWording(source(), [change(0, "x".repeat(20001))])).toThrow("oversized");
    expect(() => editTemplateWording(source(), [])).toThrow("at least one");
    expect(() => editTemplateWording(source(), [change(0, "DEED OF ASSIGNMENT")])).toThrow("No wording");
  });
  it("keeps Word section/page breaks, tracked text and text boxes read-only", () => {
    const bytes = source(`<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>section</w:t></w:r></w:p>
      <w:p><w:r><w:t>page</w:t><w:br w:type="page"/></w:r></w:p>
      <w:p><w:ins><w:r><w:t>tracked</w:t></w:r></w:ins></w:p>
      <w:p><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>nested</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>`);
    expect(bodyParagraphs(bytes).slice(8).every(paragraph => !paragraph.editable)).toBe(true);
    expect(() => editTemplateWording(bytes, [change(12, "nested update")])).toThrow("Protected Word");
  });
});