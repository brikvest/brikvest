import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { expect } from "vitest";

/** Actual rendered pixels around extracted words, not annotation metadata. */
export function inspectPdfTextBackgrounds(pdf: Buffer, tokens: string[]): Record<string, number> {
  const dir = mkdtempSync(path.join(tmpdir(), "legal-highlight-pixels-"));
  try {
    const file = path.join(dir, "document.pdf");
    writeFileSync(file, pdf);
    const bbox = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
    execFileSync("pdftoppm", ["-png", "-r", "72", file, path.join(dir, "page")], { timeout: 30_000 });
    const images = readdirSync(dir).filter((name) => /^page-\d+\.png$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
      .map((name) => PNG.sync.read(readFileSync(path.join(dir, name))));
    const found: Record<string, number[]> = {};
    const pages = [...bbox.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)];
    pages.forEach((page, index) => {
      const image = images[index];
      for (const word of page[1].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)) {
        const token = word[2].replace(/[.,;:!?]+$/, "");
        if (!tokens.includes(token)) continue;
        const coordinate = (key: string) => Number(word[1].match(new RegExp(`${key}="([^"]+)"`))![1]);
        const left = Math.max(0, Math.floor(coordinate("xMin")));
        const right = Math.min(image.width, Math.ceil(coordinate("xMax")));
        const top = Math.max(0, Math.floor(coordinate("yMin")));
        const bottom = Math.min(image.height, Math.ceil(coordinate("yMax")));
        let white = 0;
        let pixels = 0;
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const offset = (y * image.width + x) * 4;
          if (image.data[offset] >= 245 && image.data[offset + 1] >= 245 && image.data[offset + 2] >= 245) white++;
          pixels++;
        }
        (found[token] ??= []).push(white / pixels);
      }
    });
    for (const token of tokens) expect(found[token]?.length ?? 0, `PDF must contain ${token}`).toBeGreaterThan(0);
    return Object.fromEntries(Object.entries(found).map(([token, fractions]) => [token, Math.min(...fractions)]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function expectWhiteTextBackgrounds(pdf: Buffer, tokens: string[]): void {
  for (const [token, fraction] of Object.entries(inspectPdfTextBackgrounds(pdf, tokens))) {
    expect(fraction, `${token} must have a white background behind its glyphs`).toBeGreaterThan(0.55);
  }
}