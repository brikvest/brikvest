import { DOMParser, XMLSerializer, type Element, type Document } from "@xmldom/xmldom";
import { inspectLegalDocxArchive } from "./templates";
import { AdminLegalInputError } from "./admin-errors";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML = "http://www.w3.org/XML/1998/namespace";
const parts = /^word\/(?:document|header\d+|footer\d+)\.xml$/;
const MAX_PARAGRAPHS = 5000;
const MAX_TEXT = 20000;
const MAX_EDIT_BYTES = 750000;

export interface TemplateParagraph {
  id: string;
  text: string;
  editable: boolean;
  reason?: string;
  tokens: string[];
  alignment?: string;
}
export interface TemplateSection {
  id: string;
  name: string;
  paragraphs: TemplateParagraph[];
}
type Segment = { element: Element; text: string };
type Paragraph = { element: Element; segments: Segment[]; value: TemplateParagraph };

function rejected(code: string, message: string, status = 422): never {
  throw new AdminLegalInputError(code, message,
    "Keep automatic fields unchanged. Reload the source version if necessary; your live template and investor documents have not changed.", status);
}
function automaticFields(text: string): string[] {
  return text.match(/\{\{[^{}]*\}\}/g) || [];
}
function readSegments(paragraph: Element): Segment[] {
  const segments: Segment[] = [];
  const visit = (element: Element): void => {
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      if (child.namespaceURI === WORD && child.localName === "p") continue;
      if (child.namespaceURI === WORD && ["t", "br", "cr", "tab"].includes(child.localName || "")) {
        segments.push({ element: child, text: child.localName === "t" ? child.textContent || ""
          : child.localName === "tab" ? "\t" : "\n" });
      } else visit(child);
    }
  };
  visit(paragraph);
  return segments;
}
function inspect(buffer: Buffer) {
  const zip = inspectLegalDocxArchive(buffer);
  const sections: TemplateSection[] = [];
  const paragraphs = new Map<string, Paragraph>();
  const documents = new Map<string, Document>();
  for (const part of Object.keys(zip.files).filter(name => parts.test(name)).sort()) {
    const xml = zip.file(part)!.asText();
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) rejected("EDITOR_UNSUPPORTED_XML", "This Word version contains unsupported XML declarations.");
    let document: Document;
    try {
      document = new DOMParser({ onError: () => { throw new Error("Malformed XML"); } })
        .parseFromString(xml, "application/xml");
    } catch { rejected("EDITOR_INVALID_XML", "This Word version contains malformed document XML."); }
    documents.set(part, document);
    const section: TemplateSection = {
      id: part,
      name: part === "word/document.xml" ? "Document" : part.replace("word/", "").replace(".xml", "").replace(/(\d+)/, " $1"),
      paragraphs: [],
    };
    const elements = Array.from(document.getElementsByTagNameNS(WORD, "p"));
    for (let index = 0; index < elements.length; index++) {
      const paragraph = elements[index];
      if (paragraphs.size >= MAX_PARAGRAPHS) rejected("EDITOR_DOCUMENT_TOO_LARGE", "This Word document exceeds the editor’s paragraph limit.");
      // Nested text boxes are separate paragraphs, never duplicate editable text.
      const segments = readSegments(paragraph);
      const complex = ["drawing", "pict", "object", "fldChar", "instrText", "hyperlink",
        "ins", "del", "sdt", "sectPr", "sym", "footnoteReference", "endnoteReference",
        "commentReference", "altChunk", "ptab", "noBreakHyphen", "softHyphen", "lastRenderedPageBreak"]
        .some(name => paragraph.getElementsByTagNameNS(WORD, name).length > 0);
      let nested = false;
      let ancestor = paragraph.parentNode;
      while (ancestor) {
        if (ancestor.nodeType === 1 && (ancestor as Element).namespaceURI === WORD &&
            ["p", "sdt", "ins", "del"].includes((ancestor as Element).localName || "")) nested = true;
        ancestor = ancestor.parentNode;
      }
      const nonTextBreak = segments.some(segment => segment.element.localName === "br" &&
        !!segment.element.getAttributeNS(WORD, "type") && segment.element.getAttributeNS(WORD, "type") !== "textWrapping");
      const text = segments.map(segment => segment.text).join("");
      const editable = !complex && !nested && !nonTextBreak && text.length <= MAX_TEXT;
      const value: TemplateParagraph = {
        id: `${part}:${index}`, text, editable, tokens: automaticFields(text),
        ...(editable ? {} : { reason: "This paragraph contains protected Word layout, images or fields. It is retained unchanged." }),
        alignment: paragraph.getElementsByTagNameNS(WORD, "jc")[0]?.getAttributeNS(WORD, "val") || undefined,
      };
      paragraphs.set(value.id, { element: paragraph, segments, value });
      section.paragraphs.push(value);
    }
    sections.push(section);
  }
  return { zip, sections, paragraphs, documents };
}

export function readTemplateEditor(buffer: Buffer): TemplateSection[] {
  return inspect(buffer).sections;
}

/** Change text only. Keep tables, runs/styles, signatures, relationships and assets. */
function replaceSegment(element: Element, text: string) {
  const document = element.ownerDocument!;
  const parent = element.parentNode!;
  for (const piece of text.split(/(\n|\t)/)) {
    if (!piece) continue;
    const node = document.createElementNS(WORD, piece === "\n" ? "w:br" : piece === "\t" ? "w:tab" : "w:t");
    if (piece !== "\n" && piece !== "\t") {
      node.setAttributeNS(XML, "xml:space", "preserve");
      node.appendChild(document.createTextNode(piece));
    }
    parent.insertBefore(node, element);
  }
  parent.removeChild(element);
}

function patchTextSpan(paragraph: Paragraph, text: string) {
  const old = paragraph.value.text;
  if (!paragraph.segments.length) {
    const run = paragraph.element.ownerDocument!.createElementNS(WORD, "w:r");
    const node = paragraph.element.ownerDocument!.createElementNS(WORD, "w:t");
    run.appendChild(node);
    paragraph.element.appendChild(run);
    replaceSegment(node, text);
    return;
  }
  let prefix = 0;
  while (prefix < old.length && prefix < text.length && old[prefix] === text[prefix]) prefix++;
  // Never split a surrogate pair when an edit shares only its high surrogate.
  if (prefix && /[\uD800-\uDBFF]/.test(old[prefix - 1])) prefix--;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < text.length - prefix &&
      old[old.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(old[old.length - suffix])) suffix--;
  const end = old.length - suffix;
  const insertion = text.slice(prefix, text.length - suffix);
  let offset = 0;
  let inserted = false;
  paragraph.segments.forEach((segment, index) => {
    const segmentEnd = offset + segment.text.length;
    const anchor = !inserted && (segmentEnd > prefix || index === paragraph.segments.length - 1);
    const before = segment.text.slice(0, Math.max(0, Math.min(segment.text.length, prefix - offset)));
    const after = segment.text.slice(Math.max(0, Math.min(segment.text.length, end - offset)));
    const value = before + (anchor ? insertion : "") + after;
    if (anchor) inserted = true;
    if (value !== segment.text) replaceSegment(segment.element, value);
    offset = segmentEnd;
  });
}

function patchParagraph(paragraph: Paragraph, text: string) {
  const tokens = paragraph.value.tokens;
  if (!tokens.length) return patchTextSpan(paragraph, text);
  // Anchor edits around fields so even multiple wording changes cannot move a
  // split placeholder into another run or discard its original run formatting.
  const oldParts = paragraph.value.text.split(/\{\{[^{}]*\}\}/g);
  const newParts = text.split(/\{\{[^{}]*\}\}/g);
  let offset = 0;
  const starts = oldParts.map((part, index) => {
    const start = offset;
    offset += part.length + (tokens[index]?.length || 0);
    return start;
  });
  for (let index = oldParts.length - 1; index >= 0; index--) {
    if (oldParts[index] === newParts[index]) continue;
    const current = paragraph.value.text;
    const next = current.slice(0, starts[index]) + newParts[index] +
      current.slice(starts[index] + oldParts[index].length);
    patchTextSpan(paragraph, next);
    paragraph.segments = readSegments(paragraph.element);
    paragraph.value.text = next;
  }
}

export function editTemplateWording(buffer: Buffer, changes: unknown): { bytes: Buffer; changedParagraphs: number } {
  if (!Array.isArray(changes) || !changes.length || changes.length > MAX_PARAGRAPHS) {
    rejected("EDITOR_CHANGES_REQUIRED", "Supply at least one changed paragraph.", 400);
  }
  if (Buffer.byteLength(JSON.stringify(changes), "utf8") > MAX_EDIT_BYTES) {
    rejected("EDITOR_CHANGES_TOO_LARGE", "The wording changes exceed the editor’s save limit.", 413);
  }
  const source = inspect(buffer);
  const ids = new Set<string>();
  const changedParts = new Set<string>();
  let changedParagraphs = 0;
  for (const change of changes) {
    if (!change || typeof change.id !== "string" || typeof change.text !== "string" ||
        change.text.length > MAX_TEXT || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(change.text)) {
      rejected("EDITOR_INVALID_CHANGE", "A paragraph change contains invalid or oversized text.", 400);
    }
    if (ids.has(change.id)) rejected("EDITOR_DUPLICATE_CHANGE", "A paragraph was submitted more than once.", 400);
    ids.add(change.id);
    const paragraph = source.paragraphs.get(change.id);
    if (!paragraph) rejected("EDITOR_PARAGRAPH_NOT_FOUND", "A changed paragraph is not in this source version.", 409);
    if (!paragraph.value.editable) rejected("EDITOR_PROTECTED_PARAGRAPH", "Protected Word layout and signature-image paragraphs cannot be edited.");
    const text = change.text.replace(/\r\n?/g, "\n");
    if (JSON.stringify(automaticFields(text)) !== JSON.stringify(paragraph.value.tokens)) {
      rejected("EDITOR_PROTECTED_FIELDS", "Keep every automatic {{FIELD}} unchanged and in its original paragraph.");
    }
    if (text === paragraph.value.text) continue;
    patchParagraph(paragraph, text);
    changedParts.add(change.id.slice(0, change.id.lastIndexOf(":")));
    changedParagraphs++;
  }
  if (!changedParagraphs) rejected("EDITOR_NO_CHANGES", "No wording has changed. Edit a paragraph before saving.", 400);
  for (const part of Array.from(changedParts)) source.zip.file(part, new XMLSerializer().serializeToString(source.documents.get(part)!));
  return { bytes: source.zip.generate({ type: "nodebuffer", compression: "DEFLATE" }), changedParagraphs };
}