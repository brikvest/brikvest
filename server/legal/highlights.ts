import type { Element } from "@xmldom/xmldom";
import { inspectLegalDocxArchive } from "./templates";
import { DRAWING_NS, WORD_NS, fontElements, parseFontXml } from "./font-xml";

// Strict OOXML uses different namespace URIs, not merely different prefixes.
const WORD_NAMESPACES = [WORD_NS, "http://purl.oclc.org/ooxml/wordprocessingml/main"];
const DRAWING_NAMESPACES = [DRAWING_NS, "http://purl.oclc.org/ooxml/drawingml/main"];

/**
 * Remove an element without reserializing the surrounding XML. This keeps
 * drawings, signatures, text, whitespace and unrelated formatting verbatim.
 * The namespace-aware parser supplies positions in the original XML.
 */
function elementRange(xml: string, lineStarts: number[], element: Element): [number, number] {
  const start = lineStarts[element.lineNumber! - 1] + element.columnNumber! - 1;
  const opening = xml.slice(start).match(/^<([^\s/>]+)(?:[^"'<>]|"[^"]*"|'[^']*')*>/);
  if (!opening || opening[1] !== element.tagName) {
    throw new Error("Unable to locate text-highlight XML");
  }
  if (/\/>$/.test(opening[0])) return [start, start + opening[0].length];
  const closing = `</${element.tagName}`;
  const endStart = xml.indexOf(closing, start + opening[0].length);
  const end = endStart < 0 ? -1 : xml.indexOf(">", endStart);
  if (end < 0) throw new Error("Unable to locate text-highlight XML end");
  return [start, end + 1];
}

/**
 * Output policy only: callers must never replace retained templates/evidence
 * with this result. All text highlights (including styles/defaults) and Word
 * run shading are authoring markers. Paragraph, table/cell, shape and page
 * backgrounds, text foreground colours and embedded media are document design.
 * Only changed XML parts are written; a clean input is returned byte-identical.
 */
export function removeLegalDocxHighlights(buffer: Buffer): Buffer {
  const zip = inspectLegalDocxArchive(buffer);
  let changed = false;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^word\/.*\.xml$/i.test(name)) continue;
    const xml = entry.asText();
    // Avoid parsing unrelated/clean parts. This is only a candidate filter;
    // actual removal below always resolves namespace URIs and property scope.
    if (!/<(?:[^\s:<>]+:)?(?:highlight|shd)(?=[\s/>])/.test(xml)) continue;
    const document = parseFontXml(xml);
    const markers: Element[] = [];
    for (const namespace of WORD_NAMESPACES) {
      markers.push(...fontElements(document, namespace, "highlight"));
      markers.push(...fontElements(document, namespace, "shd").filter((element) => {
        const parent = element.parentNode as Element | null;
        return parent?.namespaceURI === namespace && parent.localName === "rPr";
      }));
    }
    for (const namespace of DRAWING_NAMESPACES) {
      markers.push(...fontElements(document, namespace, "highlight"));
    }
    if (!markers.length) continue;
    const lineStarts = [0];
    for (const match of Array.from(xml.matchAll(/\r\n|\r|\n/g))) lineStarts.push(match.index! + match[0].length);
    const ranges = markers.map((marker) => elementRange(xml, lineStarts, marker))
      .sort((a, b) => a[0] - b[0]);
    // Nested markers are removed with their containing marker.
    const disjoint: Array<[number, number]> = [];
    for (const range of ranges) {
      if (!disjoint.length || range[0] >= disjoint[disjoint.length - 1][1]) disjoint.push(range);
    }
    let cleaned = xml;
    for (const [start, end] of disjoint.reverse()) cleaned = cleaned.slice(0, start) + cleaned.slice(end);
    zip.file(name, cleaned);
    changed = true;
  }
  return changed ? zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) : buffer;
}