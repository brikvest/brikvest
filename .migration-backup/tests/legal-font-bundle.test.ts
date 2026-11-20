import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  assertLiberationSerifFacesAvailable,
  LIBERATION_SERIF_STYLES,
  resolveFontconfigFace,
} from "../server/legal/font-validation";

const bundle = path.resolve("server/legal/fonts/liberation");
const digests = {
  Regular: "6052dc6b3310ad99f6206a3b0e33c1c133a2e5413839bfbf0fb955cd697cbdf4",
  Bold: "fcef5305c2f775b0af6838a294e33c403f2b1c0e9334cccb3b5cfb54afce5d07",
  Italic: "f7a665b7df8253406c3d3e444aeb326a7edb3ba65a5ad9e684ef7f908bf9aaf7",
  BoldItalic: "5b60606fd80783afc64a7dfefd4b0cc287472f6b2a90dae6f66759dabaa98170",
};
let directory: string | undefined;
const originalConfig = process.env.FONTCONFIG_FILE;

afterEach(() => {
  if (originalConfig === undefined) delete process.env.FONTCONFIG_FILE;
  else process.env.FONTCONFIG_FILE = originalConfig;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

it("ships unmodified licensed regular, bold, italic and bold-italic faces", () => {
  for (const [face, sha256] of Object.entries(digests)) {
    const bytes = readFileSync(path.join(bundle, `LiberationSerif-${face}.ttf`));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  }
  const license = readFileSync(path.join(bundle, "LICENSE"), "utf8");
  expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
  expect(license).toContain("Copyright (c) 2012 Red Hat, Inc.");
});

it("resolves every fallback face with no host font directories or system config", () => {
  directory = mkdtempSync(path.join(tmpdir(), "legal-bundled-fonts-"));
  const config = path.join(directory, "fonts.conf");
  writeFileSync(config, `<?xml version="1.0"?><fontconfig><dir>${bundle}</dir><cachedir>${directory}/cache</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE = config;
  assertLiberationSerifFacesAvailable();
  for (const style of LIBERATION_SERIF_STYLES) {
    const face = resolveFontconfigFace("Liberation Serif", style, true);
    expect(face.ready).toBe(true);
    expect(path.dirname(face.file)).toBe(bundle);
  }
});

it("reports genuine fallback absence when neither bundled nor host faces exist", () => {
  directory = mkdtempSync(path.join(tmpdir(), "legal-empty-fonts-"));
  const config = path.join(directory, "fonts.conf");
  writeFileSync(config, `<?xml version="1.0"?><fontconfig><dir>${directory}</dir><cachedir>${directory}/cache</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE = config;
  expect(() => assertLiberationSerifFacesAvailable()).toThrow(
    expect.objectContaining({ kind: "unavailable" }),
  );
});