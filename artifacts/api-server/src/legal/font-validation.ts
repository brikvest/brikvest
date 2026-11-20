import { execFileSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { inspectLegalDocxArchive } from "./templates";
import { DRAWING_NS, WORD_NS, fontElements, parseFontXml } from "./font-xml";

const MAX_FONT_FAMILIES = 64;
const MAX_FONT_FAMILY_LENGTH = 128;

export class LegalFontValidationError extends Error {
  constructor(message: string, public kind: "metadata" | "unavailable" | "service") {
    super(message);
    this.name = "LegalFontValidationError";
  }
}

export interface DocxFontRequirements {
  families: string[];
  embeddedFamilies: Set<string>;
}

export interface LegalFontReadiness {
  family: string;
  style?: string;
  matchedFamily: string;
  pathReadable?: boolean;
  installedExactMatch: boolean;
  embeddedInTemplate: boolean;
  ready: boolean;
}

export type FontFamilyResolver = (family: string, style?: string, requireExactMatch?: boolean) => string;

export const LIBERATION_SERIF_STYLES = [
  "Regular",
  "Bold",
  "Italic",
  "Bold Italic",
] as const;

export interface FontconfigFaceMatch {
  family: string;
  style: string;
  file: string;
  exactFamily: boolean;
  exactStyle: boolean;
  readableFile: boolean;
  ready: boolean;
}

function normalizedFamilyKey(family: string): string {
  return family.trim().toLocaleLowerCase("en-US");
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readXmlAttributes(attributes: string): Map<string, string> {
  return new Map(
    Array.from(attributes.matchAll(/([:\w-]+)="([^"]*)"/g), (match) => [
      match[1],
      decodeXmlAttribute(match[2]),
    ]),
  );
}

function resolveEmbeddedFontTarget(target: string): string {
  if (target.startsWith("/")) return path.posix.normalize(target.slice(1));
  return path.posix.normalize(path.posix.join("word", target));
}

function collectDocxFontRequirements(buffer: Buffer): DocxFontRequirements {
  const zip: PizZip = inspectLegalDocxArchive(buffer);
  const families = new Set<string>();
  const embeddedFamilies = new Set<string>();

  const themeFonts = new Map<string, string>();
  try {
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !/^word\/theme\/.*\.xml$/i.test(name)) continue;
      const theme = parseFontXml(entry.asText());
      for (const group of ["major", "minor"]) {
        for (const scheme of fontElements(theme, DRAWING_NS, `${group}Font`)) {
          for (const slot of ["latin", "ea", "cs"]) {
            const family = scheme.getElementsByTagNameNS(DRAWING_NS, slot)[0]?.getAttribute("typeface") || "";
            themeFonts.set(`${group}:${slot}`, family);
          }
        }
      }
    }
  } catch {
    throw new LegalFontValidationError("DOCX contains malformed font or theme XML.", "metadata");
  }
  const addFamily = (value: string) => {
    const family = value.trim();
    if (!family || family.length > MAX_FONT_FAMILY_LENGTH || /[\u0000-\u001f\u007f]/.test(family)) {
      throw new LegalFontValidationError("DOCX contains invalid font-family metadata that cannot be verified safely.", "metadata");
    }
    families.add(family);
    if (families.size > MAX_FONT_FAMILIES) {
      throw new LegalFontValidationError("DOCX declares too many font families to verify safely.", "metadata");
    }
  };
  const themeFamily = (reference: string) => {
    const match = reference.match(/^(major|minor)(Ascii|HAnsi|EastAsia|Bidi)$/);
    if (!match) throw new LegalFontValidationError("DOCX contains an invalid theme-font reference.", "metadata");
    const slot = match[2] === "EastAsia" ? "ea" : match[2] === "Bidi" ? "cs" : "latin";
    // Word uses the Latin family when the theme's EA/CS slot is unspecified.
    return themeFonts.get(`${match[1]}:${slot}`) || themeFonts.get(`${match[1]}:latin`) || "";
  };
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^word\/.*\.xml$/i.test(name)) continue;
    let document;
    try { document = parseFontXml(entry.asText()); } catch {
      throw new LegalFontValidationError("DOCX contains malformed font XML.", "metadata");
    }
    for (const fonts of fontElements(document, WORD_NS, "rFonts")) {
      for (const slot of ["ascii", "hAnsi", "eastAsia", "cs"]) {
        const themeAttribute = (slot === "cs" ? ["cstheme", "csTheme"] : [`${slot}Theme`])
          .find((attribute) => fonts.hasAttributeNS(WORD_NS, attribute));
        // Theme formatting takes precedence over a cached explicit family.
        if (themeAttribute) addFamily(themeFamily(fonts.getAttributeNS(WORD_NS, themeAttribute)!));
        else if (fonts.hasAttributeNS(WORD_NS, slot)) addFamily(fonts.getAttributeNS(WORD_NS, slot)!);
      }
    }
    for (const symbol of fontElements(document, WORD_NS, "sym")) {
      if (symbol.hasAttributeNS(WORD_NS, "font")) addFamily(symbol.getAttributeNS(WORD_NS, "font")!);
    }
    if (!/^word\/theme\//i.test(name)) {
      for (const slot of ["latin", "ea", "cs", "sym"]) {
        for (const font of fontElements(document, DRAWING_NS, slot)) {
          const family = font.getAttribute("typeface");
          if (!family) continue;
          const theme = family.match(/^\+(mj|mn)-(lt|ea|cs)$/);
          addFamily(theme
            ? themeFonts.get(`${theme[1] === "mj" ? "major" : "minor"}:${theme[2] === "lt" ? "latin" : theme[2]}`) ||
              themeFonts.get(`${theme[1] === "mj" ? "major" : "minor"}:latin`) || ""
            : family);
        }
      }
    }
  }

  const fontTable = zip.file("word/fontTable.xml")?.asText() ?? "";
  const relationships = zip.file("word/_rels/fontTable.xml.rels")?.asText() ?? "";
  const fontTargets = new Map<string, string>();
  for (const relation of Array.from(
    relationships.matchAll(/<Relationship\b([^>]*)\/?>/g),
  )) {
    const attributes = readXmlAttributes(relation[1]);
    const target = attributes.get("Target")?.replace(/\\/g, "/");
    if (
      attributes.get("Type")?.endsWith("/font") &&
      target &&
      attributes.get("TargetMode")?.toLowerCase() !== "external"
    ) {
      const archivePath = resolveEmbeddedFontTarget(target);
      if (archivePath.startsWith("word/fonts/")) {
        fontTargets.set(attributes.get("Id") || "", archivePath);
      }
    }
  }

  const fontTags = fontTable.match(
    /<w:font\b[^>]*\/>|<w:font\b[^>]*>[\s\S]*?<\/w:font>/g,
  ) ?? [];
  for (const font of fontTags) {
    const openingTag = font.match(/^<w:font\b([^>]*)>/)?.[1] ??
      font.match(/^<w:font\b([^>]*)\/>$/)?.[1] ?? "";
    const family = readXmlAttributes(openingTag).get("w:name")?.trim();
    if (!family) continue;

    const body = font.includes("</w:font>") ? font.slice(font.indexOf(">") + 1) : "";
    const embeddedVariants = Array.from(
      body.matchAll(/<w:embed(?:Regular|Bold|Italic|BoldItalic)\b([^>]*)\/?>/g),
    );
    const embeddedFilesExist =
      embeddedVariants.length > 0 &&
      embeddedVariants.every((embed) => {
        const relationshipId = readXmlAttributes(embed[1]).get("r:id");
        const target = relationshipId ? fontTargets.get(relationshipId) : undefined;
        const entry = target ? zip.file(target) : null;
        return Boolean(entry && !entry.dir && entry.asNodeBuffer().length > 0);
      });
    if (embeddedFilesExist) embeddedFamilies.add(normalizedFamilyKey(family));
  }

  for (const family of Array.from(families)) {
    if (
      family.length > MAX_FONT_FAMILY_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(family)
    ) {
      throw new LegalFontValidationError("DOCX contains invalid font-family metadata that cannot be verified safely.", "metadata");
    }
  }

  return { families: Array.from(families).sort(), embeddedFamilies };
}

export function readDocxFontRequirements(
  buffers: readonly Buffer[],
): DocxFontRequirements {
  const families = new Set<string>();
  const embeddedFamilies = new Set<string>();
  for (const buffer of buffers) {
    const requirements = collectDocxFontRequirements(buffer);
    for (const family of requirements.families) families.add(family);
    for (const family of Array.from(requirements.embeddedFamilies)) {
      embeddedFamilies.add(family);
    }
    if (families.size > MAX_FONT_FAMILIES) {
      throw new LegalFontValidationError("DOCX declares too many font families to verify safely.", "metadata");
    }
  }
  return { families: Array.from(families).sort(), embeddedFamilies };
}

function isReadableFontFile(file: string): boolean {
  try {
    if (!path.isAbsolute(file) || !statSync(file).isFile()) return false;
    accessSync(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse the same fontconfig response used both by conversion and readiness.
 * Fontconfig's fallback match is not an exact match, even when it returns a
 * perfectly readable substitute font.
 */
export function inspectFontconfigFace(
  requestedFamily: string,
  requestedStyle: string,
  output: string,
  readableFile: (file: string) => boolean = isReadableFontFile,
): FontconfigFaceMatch {
  const [family = "", style = "", file = ""] = output.trim().split("|");
  const names = family.split(",").map((name) => name.trim().toLocaleLowerCase("en-US"));
  const exactFamily = names.includes(requestedFamily.trim().toLocaleLowerCase("en-US"));
  const exactStyle = style.trim().toLocaleLowerCase("en-US") === requestedStyle.trim().toLocaleLowerCase("en-US");
  const hasReadableFile = Boolean(file && readableFile(file));
  return {
    family: family.trim(),
    style: style.trim(),
    file: file.trim(),
    exactFamily,
    exactStyle,
    readableFile: hasReadableFile,
    ready: exactFamily && exactStyle && hasReadableFile,
  };
}

export function resolveFontconfigFace(
  family: string,
  style = "Regular",
  requireExactMatch = false,
): FontconfigFaceMatch {
  let output: string;
  try {
    output = execFileSync(
      process.env.FC_MATCH_PATH || "fc-match",
      ["-f", "%{family}|%{style}|%{file}", `${family}:style=${style}`],
      {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      },
    );
  } catch {
    throw new LegalFontValidationError("Font verification service (fc-match) is unavailable. Restore fontconfig before retrying the saved draft.", "service");
  }
  const match = inspectFontconfigFace(family, style, output);
  if (requireExactMatch && !match.ready) {
    throw new LegalFontValidationError(
      `Fontconfig did not resolve an exact, readable ${style} face for "${family}".`,
      "unavailable",
    );
  }
  return match;
}

export function fontconfigFaceReadiness(
  family: string,
  style: string,
  output: string,
): LegalFontReadiness {
  const match = inspectFontconfigFace(family, style, output);
  return {
    family,
    style,
    matchedFamily: match.family || "unavailable",
    pathReadable: match.readableFile,
    installedExactMatch: match.exactFamily && match.exactStyle,
    embeddedInTemplate: false,
    ready: match.ready,
  };
}

export function resolveFontconfigFamily(
  family: string,
  style = "Regular",
  requireExactMatch = false,
): string {
  const match = resolveFontconfigFace(family, style, requireExactMatch);
  return match.readableFile ? match.family : "unavailable";
}

export function assertLiberationSerifFacesAvailable(
  resolveFamily: FontFamilyResolver = resolveFontconfigFamily,
): void {
  for (const style of LIBERATION_SERIF_STYLES) {
    let matchedFamily = "";
    try {
      matchedFamily = resolveFamily("Liberation Serif", style, true).trim();
    } catch (error) {
      if (error instanceof LegalFontValidationError) throw error;
      throw new LegalFontValidationError(
        "Font verification service is unavailable. Restore fontconfig before retrying the saved draft.",
        "service",
      );
    }
    if (!matchedFamily) {
      throw new LegalFontValidationError(
        `The authorized Liberation Serif ${style} face is unavailable.`,
        "unavailable",
      );
    }
    const exact = matchedFamily.split(",").some(
      (candidate) => candidate.trim().toLocaleLowerCase("en-US") === "liberation serif",
    );
    if (!exact) {
      throw new LegalFontValidationError(
        `The authorized Liberation Serif ${style} face is unavailable; fontconfig resolved a substitute.`,
        "unavailable",
      );
    }
  }
}

export function assessDocxFontReadiness(
  requirements: DocxFontRequirements,
  resolveFamily: FontFamilyResolver = resolveFontconfigFamily,
): LegalFontReadiness[] {
  return requirements.families.map((family) => {
    let matchedFamily = "";
    try {
      matchedFamily = resolveFamily(family).trim();
    } catch (error) {
      // Preserve an exact-font or verification-service classification emitted
      // by the shared fontconfig resolver instead of conflating both failures.
      if (error instanceof LegalFontValidationError) throw error;
      throw new LegalFontValidationError("Font verification service is unavailable. Restore fontconfig before retrying the saved draft.", "service");
    }
    if (!matchedFamily) throw new LegalFontValidationError("Font verification service returned no family. Restore fontconfig before retrying the saved draft.", "service");
    const installedExactMatch = matchedFamily
      .split(",")
      .some((candidate) => candidate.trim().toLocaleLowerCase("en-US") === family.toLocaleLowerCase("en-US"));
    const embeddedInTemplate = requirements.embeddedFamilies.has(normalizedFamilyKey(family));
    return {
      family,
      matchedFamily: matchedFamily || "unavailable",
      installedExactMatch,
      embeddedInTemplate,
      ready: installedExactMatch || embeddedInTemplate,
    };
  });
}

export function assertDocxFontsAvailable(
  buffer: Buffer,
  resolveFamily: FontFamilyResolver = resolveFontconfigFamily,
): void {
  const requirements = collectDocxFontRequirements(buffer);
  if (requirements.families.length === 0) {
    throw new LegalFontValidationError(
      "The DOCX declares no font families, so exact legal-document font rendering cannot be verified. Add explicit fonts or valid embedded font data.",
      "metadata",
    );
  }
  const unavailable = assessDocxFontReadiness(requirements, resolveFamily)
    .filter((font) => !font.ready);
  if (unavailable.length === 0) return;

  const details = unavailable.map((font) => {
    const match = font.matchedFamily === "unavailable"
      ? "fontconfig could not resolve the family"
      : `fontconfig resolved "${font.matchedFamily}" instead of an exact family match`;
    return `Required DOCX font family "${font.family}" is unavailable: ${match}, and the DOCX has no valid embedded font data.`;
  });
  throw new LegalFontValidationError(
    `${details.join(" ")} New working documents may use the authorized whole-document Liberation Serif 12-point fallback. Existing immutable Word files cannot be reformatted during recovery; restore their original fonts to convert them unchanged.`,
    "unavailable",
  );
}