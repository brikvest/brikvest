import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";

export const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

/** Reject malformed XML rather than repairing untrusted font metadata. */
export function parseFontXml(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported XML declarations");
  return new DOMParser({
    onError: () => { throw new Error("Malformed document XML"); },
  }).parseFromString(xml, "application/xml");
}

export function fontElements(document: Document, namespace: string, name: string): Element[] {
  return Array.from(document.getElementsByTagNameNS(namespace, name));
}

export function serializeFontXml(document: Document): string {
  return new XMLSerializer().serializeToString(document);
}