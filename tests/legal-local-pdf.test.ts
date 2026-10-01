import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import {
  getLocalSigningFontSha256,
  renderLocalSigningEvidencePdf,
  renderLocallySignedPdf,
  sha256Hex,
  validateSignaturePng,
} from "../server/legal/local-pdf-signature";

const approvedName = "Ọládélé Ajáyí";
const unsignedPdfSha256 = "a".repeat(64);
const signaturePngSha256 = "b".repeat(64);
const signedPdfSha256 = "c".repeat(64);
let directory: string;

function createInkPng(width = 320, height = 100): Buffer {
  const png = new PNG({ width, height });
  for (let step = 0; step < 100; step += 1) {
    const x = 20 + step * 2;
    const y = 68 - Math.round(Math.sin(step / 7) * 22);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const index = ((y + dy) * width + (x + dx)) * 4;
        png.data[index] = 28;
        png.data[index + 1] = 38;
        png.data[index + 2] = 52;
        png.data[index + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

async function createUnsignedPdf(dense = false): Promise<Buffer> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  if (dense) {
    for (let y = 250; y <= 550; y += 12) {
      page.drawText(`Static legal text line at ${y} — no signing area`, {
        x: 36,
        y,
        size: 9,
        font,
      });
    }
  } else {
    page.drawText("Verified Investor", { x: 60, y: 400, size: 12, font });
  }
  return Buffer.from(await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  }));
}

function extractPdfText(pdfPath: string): string {
  const result = spawnSync(
    process.env.PDFTOTEXT_PATH || "pdftotext",
    ["-enc", "UTF-8", pdfPath, "-"],
    { encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(result.stderr || "pdftotext failed");
  return result.stdout;
}

function evidenceInput(renderFontSha256: string) {
  return {
    documentType: "deed_of_assignment",
    documentId: 7,
    pairId: 4,
    operationId: 12,
    reservationId: 3,
    propertyName: "Ọjà Heights",
    propertyLocation: "Ṣàngótè, Lagos",
    units: "2",
    areaSqm: "10",
    signerName: approvedName,
    signatureMethod: "typed" as const,
    renderFontSha256,
    unsignedPdfSha256,
    signedPdfSha256,
    signaturePngSha256,
    consentVersion: "brikvest-local-signing-v1",
    consentText: "I reviewed and consent to a Brikvest in-app acknowledgment.",
    consentedAt: new Date("2025-03-08T11:15:30.000Z"),
    reauthenticatedAt: new Date("2025-03-08T11:15:30.000Z"),
    reviewedAt: new Date("2025-03-08T11:15:30.000Z"),
    signedAt: new Date("2025-03-08T11:15:30.000Z"),
  };
}

describe("deterministic local PDF signature rendering", () => {
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("preflights and decodes a nonblank, bounded signature PNG", () => {
    const png = createInkPng();
    expect(validateSignaturePng(png)).toMatchObject({
      width: 320,
      height: 100,
    });

    const blank = PNG.sync.write(new PNG({ width: 100, height: 40 }));
    expect(() => validateSignaturePng(blank)).toThrow(/blank/i);

    const oversized = PNG.sync.write(new PNG({ width: 1601, height: 40 }));
    expect(() => validateSignaturePng(oversized)).toThrow(/1600×600/i);
  });

  it("places the image in a clear area near the verified name and renders identical signed bytes on retry", async () => {
    const unsignedPdf = await createUnsignedPdf();
    const signaturePng = createInkPng();
    const placement = {
      templateVersionId: "1",
      pageNumber: 1,
      x: 60,
      y: 380,
      width: 120,
      height: 20,
      pageWidth: 612,
      pageHeight: 792,
      coordinateSystem: "pdf-points-top-left",
      anchorText: "Verified Investor",
    };
    const input = {
      unsignedPdf,
      signaturePng,
      placement,
      signerName: approvedName,
      signatureMethod: "drawn" as const,
      documentType: "deed_of_assignment",
      operationId: 12,
      unsignedPdfSha256: sha256Hex(unsignedPdf),
      signaturePngSha256: sha256Hex(signaturePng),
      signedAt: new Date("2025-03-08T11:15:30.000Z"),
    };

    const first = await renderLocallySignedPdf(input);
    const second = await renderLocallySignedPdf(input);
    expect(first).toEqual(second);
    expect(first).not.toEqual(unsignedPdf);
    const signed = await PDFDocument.load(first, { updateMetadata: false });
    const metadata = JSON.parse(signed.getSubject() || "{}");
    expect(metadata).toMatchObject({
      signerName: approvedName,
      signatureMethod: "drawn",
      unsignedPdfSha256: sha256Hex(unsignedPdf),
      externalExecutionSeparatelyRequired: true,
      qualifiedDigitalSignature: false,
      identityCertificate: false,
    });
  });

  it("fails closed when no clear signature box exists near the name", async () => {
    const unsignedPdf = await createUnsignedPdf(true);
    const signaturePng = createInkPng();
    await expect(renderLocallySignedPdf({
      unsignedPdf,
      signaturePng,
      placement: {
        templateVersionId: "1",
        pageNumber: 1,
        x: 60,
        y: 380,
        width: 120,
        height: 20,
        pageWidth: 612,
        pageHeight: 792,
        coordinateSystem: "pdf-points-top-left",
        anchorText: "Verified Investor",
      },
      signerName: approvedName,
      signatureMethod: "drawn",
      documentType: "deed_of_assignment",
      operationId: 13,
      unsignedPdfSha256: sha256Hex(unsignedPdf),
      signaturePngSha256: sha256Hex(signaturePng),
      signedAt: new Date("2025-03-08T11:15:30.000Z"),
    })).rejects.toThrow(/no clear signature area|unsafe/i);
  });

  it("renders the exact Unicode-approved name and deterministic evidence PDF, including the selected image method", async () => {
    const renderFontSha256 = await getLocalSigningFontSha256();
    const input = evidenceInput(renderFontSha256);
    const first = await renderLocalSigningEvidencePdf(input);
    const second = await renderLocalSigningEvidencePdf(input);
    expect(first).toEqual(second);
    const document = await PDFDocument.load(first, { updateMetadata: false });
    const subject = JSON.parse(document.getSubject() || "{}");
    expect(subject.signerName).toBe(approvedName);
    expect(subject.signatureMethod).toBe("typed");
    expect(subject.qualifiedDigitalSignature).toBe(false);
    expect(subject.identityCertificate).toBe(false);

    directory = await mkdtemp(path.join(os.tmpdir(), "local-signing-pdf-test-"));
    const evidencePath = path.join(directory, "evidence.pdf");
    await writeFile(evidencePath, first, { mode: 0o600 });
    const visibleText = extractPdfText(evidencePath);
    expect(visibleText).toContain(approvedName);
    expect(visibleText).toContain("Signature image method (investor-selected)");
    expect(visibleText).toContain("typed");
    expect(visibleText).toContain("external execution");
    expect(visibleText).not.toContain("handwritten signature");
  });

  it("refuses recovery if the frozen Unicode font bytes have changed", async () => {
    const input = evidenceInput("d".repeat(64));
    await expect(renderLocalSigningEvidencePdf(input)).rejects.toThrow(/font changed/i);
  });

  it("preflights glyph coverage before accepting Unicode evidence text", async () => {
    await expect(getLocalSigningFontSha256("漢字")).rejects.toThrow(/cannot display U\+6F22/i);
  });

  it("flows realistic long evidence across deterministic pages without clipping the separate-execution notice", async () => {
    const renderFontSha256 = await getLocalSigningFontSha256();
    const fullConsent =
      ("I reviewed the full legal document, understand this is only an in-app acknowledgment, " +
        "and will complete any separate execution or statutory requirement where applicable. ").repeat(38);
    const longName = `Ọládélé ${"FamilyName".repeat(14)}`;
    const input = {
      ...evidenceInput(renderFontSha256),
      signerName: longName,
      propertyName: `Ọjà${"Heights".repeat(35)}`,
      propertyLocation: "Ṣàngótè, Lagos",
      consentText: fullConsent,
    };
    const first = await renderLocalSigningEvidencePdf(input);
    const second = await renderLocalSigningEvidencePdf(input);
    expect(first).toEqual(second);

    const document = await PDFDocument.load(first, { updateMetadata: false });
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(JSON.parse(document.getSubject() || "{}").signerName).toBe(longName);

    directory = await mkdtemp(path.join(os.tmpdir(), "local-signing-long-evidence-test-"));
    const evidencePath = path.join(directory, "long-evidence.pdf");
    await writeFile(evidencePath, first, { mode: 0o600 });
    const visibleText = extractPdfText(evidencePath)
      .replace(/Page \d+ of \d+/g, " ")
      .replace(/BRIKVEST — LOCAL IN-APP SIGNING RECORD \(CONTINUED\)/g, " ")
      .replace(/\s+/g, " ");
    const visibleTextWithoutWhitespace = visibleText.replace(/\s/g, "");
    const completeNotice =
      "This record evidences a Brikvest in-app electronic acknowledgment only. It is not a " +
      "signature issued by a qualified trust service provider and is not an identity-verification " +
      "certificate. Any external execution, witness, attestation, notarization, registration, or " +
      "other statutory requirement remains separate and must be completed where applicable.";
    expect(visibleText).toContain(fullConsent.trim());
    expect(visibleText).toContain(completeNotice);
    expect(visibleText).toContain("where applicable.");
    expect(visibleTextWithoutWhitespace).toContain(longName.replace(/\s/g, ""));
    expect(visibleTextWithoutWhitespace).toContain(
      input.propertyName.replace(/\s/g, ""),
    );
  });
});
