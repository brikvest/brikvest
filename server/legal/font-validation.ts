import { execFileSync } from "node:child_process";
import path from "node:path";
import PizZip from "pizzip";
import { inspectLegalDocxArchive } from "./templates";

const MAX_FONT_FAMILIES = 64;
const MAX_FONT_FAMILY_LENGTH = 128;

export class LegalFontValidationError extends Error {
  constructor(message: string, public kind: "metadata" | "unavailable") {
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
  matchedFamily: string;
  installedExactMatch: boolean;
  embeddedInTemplate: boolean;
  ready: boolean;
}

export type FontFamilyResolver = (family: string) => string;

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

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^word\/.*\.xml$/i.test(name)) continue;
    const xml = entry.asText();
    for (const fontsTag of Array.from(xml.matchAll(/<w:rFonts\b([^>]*)\/?>/g))) {
      for (const familyMatch of Array.from(
        fontsTag[1].matchAll(/\bw:(?:ascii|hAnsi|eastAsia|cs)="([^"]+)"/g),
      )) {
        const family = decodeXmlAttribute(familyMatch[1]).trim();
        if (family) families.add(family);
        if (families.size > MAX_FONT_FAMILIES) {
          throw new LegalFontValidationError("DOCX declares too many font families to verify safely.", "metadata");
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

export function resolveFontconfigFamily(family: string): string {
  try {
    return execFileSync("fc-match", ["-f", "%{family}", family], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    }).trim();
  } catch {
    return "";
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
    } catch {
      matchedFamily = "";
    }
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
    `${details.join(" ")} Install the licensed font family in the conversion environment or provide a valid embedded font in the DOCX; font substitution is not permitted outside isolated NODE_ENV=test layout tests.`,
    "unavailable",
  );
}