import type { Element } from "@xmldom/xmldom";
import { inspectLegalDocxArchive } from "./templates";
import {
  assessDocxFontReadiness, readDocxFontRequirements, resolveFontconfigFamily,
  LegalFontValidationError, type FontFamilyResolver,
} from "./font-validation";
import { DRAWING_NS, WORD_NS, fontElements, parseFontXml, serializeFontXml } from "./font-xml";

export const LEGAL_FALLBACK_FONT = "Liberation Serif";
export const LEGAL_FALLBACK_POINTS = 12;

function normalizeWordProperties(properties: Element): void {
  const document = properties.ownerDocument!;
  for (const child of Array.from(properties.childNodes)) {
    if (child.nodeType === 1 && (child as Element).namespaceURI === WORD_NS &&
        ["rFonts", "sz", "szCs"].includes((child as Element).localName!)) {
      properties.removeChild(child);
    }
  }
  const fonts = document.createElementNS(WORD_NS, "w:rFonts");
  for (const slot of ["ascii", "hAnsi", "eastAsia", "cs"]) {
    fonts.setAttributeNS(WORD_NS, `w:${slot}`, LEGAL_FALLBACK_FONT);
  }
  properties.insertBefore(fonts, properties.firstChild);
  for (const slot of ["sz", "szCs"]) {
    const size = document.createElementNS(WORD_NS, `w:${slot}`);
    size.setAttributeNS(WORD_NS, "w:val", String(LEGAL_FALLBACK_POINTS * 2));
    properties.appendChild(size);
  }
}

/**
 * Creates a working copy only. Exact-ready documents are byte-identical;
 * fallback never touches source uploads or already persisted artifacts.
 */
export function prepareLegalDocxTypography(
  buffer: Buffer,
  resolveFamily: FontFamilyResolver = resolveFontconfigFamily,
): Buffer {
  const requirements = readDocxFontRequirements([buffer]);
  if (!requirements.families.length) {
    throw new LegalFontValidationError("The DOCX declares no verifiable font families. Ask the author to save explicit font formatting.", "metadata");
  }
  const unavailable = assessDocxFontReadiness(requirements, resolveFamily).some((font) => !font.ready);
  if (!unavailable) return buffer;
  const fallback = assessDocxFontReadiness({
    families: [LEGAL_FALLBACK_FONT], embeddedFamilies: new Set(),
  }, resolveFamily)[0];
  if (!fallback.ready) {
    throw new LegalFontValidationError("The authorized Liberation Serif 12-point fallback is unavailable. Install the licensed Liberation Serif family in the conversion environment and retry the saved draft.", "unavailable");
  }

  const zip = inspectLegalDocxArchive(buffer);
  if (!zip.file("word/styles.xml")) {
    zip.file("word/styles.xml", `<w:styles xmlns:w="${WORD_NS}"/>`);
    const relationNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
    const relationPath = "word/_rels/document.xml.rels";
    const relationships = parseFontXml(zip.file(relationPath)?.asText() || `<Relationships xmlns="${relationNamespace}"/>`);
    const entries = fontElements(relationships, relationNamespace, "Relationship");
    if (!entries.some((entry) => entry.getAttribute("Type")?.endsWith("/styles"))) {
      const relationship = relationships.createElementNS(relationNamespace, "Relationship");
      const ids = new Set(entries.map((entry) => entry.getAttribute("Id")));
      let id = "rIdLegalTypographyStyles";
      while (ids.has(id)) id += "_";
      relationship.setAttribute("Id", id);
      relationship.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles");
      relationship.setAttribute("Target", "styles.xml");
      relationships.documentElement!.appendChild(relationship);
      zip.file(relationPath, serializeFontXml(relationships));
    }
    const contentTypes = parseFontXml(zip.file("[Content_Types].xml")!.asText());
    const typeNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
    if (!fontElements(contentTypes, typeNamespace, "Override").some((entry) => entry.getAttribute("PartName") === "/word/styles.xml")) {
      const override = contentTypes.createElementNS(typeNamespace, "Override");
      override.setAttribute("PartName", "/word/styles.xml");
      override.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml");
      contentTypes.documentElement!.appendChild(override);
      zip.file("[Content_Types].xml", serializeFontXml(contentTypes));
    }
  }
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^word\/.*\.xml$/i.test(name) || name === "word/fontTable.xml") continue;
    const document = parseFontXml(entry.asText());
    if (name === "word/styles.xml") {
      let defaults = fontElements(document, WORD_NS, "docDefaults")[0];
      if (!defaults) {
        defaults = document.createElementNS(WORD_NS, "w:docDefaults");
        document.documentElement!.insertBefore(defaults, document.documentElement!.firstChild);
      }
      let runDefaults = defaults.getElementsByTagNameNS(WORD_NS, "rPrDefault")[0];
      if (!runDefaults) {
        runDefaults = document.createElementNS(WORD_NS, "w:rPrDefault");
        defaults.insertBefore(runDefaults, defaults.firstChild);
      }
      if (!runDefaults.getElementsByTagNameNS(WORD_NS, "rPr").length) {
        runDefaults.appendChild(document.createElementNS(WORD_NS, "w:rPr"));
      }
      for (const style of fontElements(document, WORD_NS, "style")) {
        if (!Array.from(style.childNodes).some((node) => node.nodeType === 1 &&
            (node as Element).namespaceURI === WORD_NS && (node as Element).localName === "rPr")) {
          style.appendChild(document.createElementNS(WORD_NS, "w:rPr"));
        }
      }
    }
    // Defaults, styles, numbering, tables, notes, headers, footers, text boxes,
    // and tracked formatting all share these namespace-qualified properties.
    for (const properties of fontElements(document, WORD_NS, "rPr")) normalizeWordProperties(properties);
    for (const run of fontElements(document, WORD_NS, "r")) {
      let properties = Array.from(run.childNodes).find((node) =>
        node.nodeType === 1 && (node as Element).namespaceURI === WORD_NS &&
        (node as Element).localName === "rPr") as Element | undefined;
      if (!properties) {
        properties = document.createElementNS(WORD_NS, "w:rPr");
        run.insertBefore(properties, run.firstChild);
        normalizeWordProperties(properties);
      }
    }
    for (const fonts of fontElements(document, WORD_NS, "rFonts")) {
      for (const attribute of Array.from(fonts.attributes)) fonts.removeAttributeNode(attribute);
      for (const slot of ["ascii", "hAnsi", "eastAsia", "cs"]) fonts.setAttributeNS(WORD_NS, `w:${slot}`, LEGAL_FALLBACK_FONT);
    }
    for (const size of [...fontElements(document, WORD_NS, "sz"), ...fontElements(document, WORD_NS, "szCs")]) {
      size.setAttributeNS(WORD_NS, "w:val", "24");
    }
    for (const symbol of fontElements(document, WORD_NS, "sym")) symbol.setAttributeNS(WORD_NS, "w:font", LEGAL_FALLBACK_FONT);
    for (const run of [...fontElements(document, DRAWING_NS, "r"), ...fontElements(document, DRAWING_NS, "fld")]) {
      if (!Array.from(run.childNodes).some((node) => node.nodeType === 1 &&
          (node as Element).namespaceURI === DRAWING_NS && (node as Element).localName === "rPr")) {
        run.insertBefore(document.createElementNS(DRAWING_NS, "a:rPr"), run.firstChild);
      }
    }
    for (const slot of ["rPr", "defRPr", "endParaRPr"]) {
      for (const properties of fontElements(document, DRAWING_NS, slot)) {
        properties.setAttribute("sz", "1200");
        for (const fontSlot of ["latin", "ea", "cs", "sym"]) {
          const fonts = document.createElementNS(DRAWING_NS, `a:${fontSlot}`);
          fonts.setAttribute("typeface", LEGAL_FALLBACK_FONT);
          for (const old of Array.from(properties.childNodes)) {
            if (old.nodeType === 1 && (old as Element).namespaceURI === DRAWING_NS && (old as Element).localName === fontSlot) properties.removeChild(old);
          }
          properties.appendChild(fonts);
        }
      }
    }
    // Theme declarations cannot override the explicit normalized run formatting.
    for (const slot of ["latin", "ea", "cs", "font"]) {
      for (const font of fontElements(document, DRAWING_NS, slot)) {
        if (font.hasAttribute("typeface")) font.setAttribute("typeface", LEGAL_FALLBACK_FONT);
      }
    }
    zip.file(name, serializeFontXml(document));
  }
  // Remove stale font declarations/embedding references in the working copy.
  // Image/media parts and their relationships are never removed or rewritten.
  zip.file("word/fontTable.xml", `<?xml version="1.0" encoding="UTF-8"?><w:fonts xmlns:w="${WORD_NS}"><w:font w:name="${LEGAL_FALLBACK_FONT}"/></w:fonts>`);
  const fontRelationshipPath = "word/_rels/fontTable.xml.rels";
  const fontRelationships = zip.file(fontRelationshipPath);
  if (fontRelationships) {
    const relationships = parseFontXml(fontRelationships.asText());
    for (const relation of Array.from(relationships.documentElement!.childNodes)) {
      if (relation.nodeType === 1 && (relation as Element).getAttribute("Type")?.endsWith("/font")) {
        relationships.documentElement!.removeChild(relation);
      }
    }
    if (Array.from(relationships.documentElement!.childNodes).some((node) => node.nodeType === 1)) {
      zip.file(fontRelationshipPath, serializeFontXml(relationships));
    } else zip.remove(fontRelationshipPath);
  }
  for (const name of Object.keys(zip.files)) if (name.startsWith("word/fonts/")) zip.remove(name);
  const types = parseFontXml(zip.file("[Content_Types].xml")!.asText());
  for (const element of Array.from(types.documentElement!.childNodes)) {
    if (element.nodeType === 1 && /^\/word\/fonts\//.test((element as Element).getAttribute("PartName") || "")) types.documentElement!.removeChild(element);
  }
  zip.file("[Content_Types].xml", serializeFontXml(types));
  const prepared = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  inspectLegalDocxArchive(prepared);
  return prepared;
}