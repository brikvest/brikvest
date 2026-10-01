import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import {
  assessDocxFontReadiness,
  assertDocxFontsAvailable,
  readDocxFontRequirements,
} from "../server/legal/font-validation";
import { convertDocxToPdf } from "../server/legal/converter";
import { renderLegalTemplate } from "../server/legal/templates";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deedTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/deed_of_assignment_v1.docx"),
);
const transferTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/transfer_exit_rights_v1.docx"),
);

function renderedDeed(): Buffer {
  return renderLegalTemplate(deedTemplate, "deed_of_assignment", {
    USER_FULL_NAME: "Ada Lovelace",
    USER_HOME_ADDRESS: "1 Example Street, Abuja",
    PROPERTY_AREA_SQM: "20",
    PAYMENT_AMOUNT_NAIRA_NUMERIC: "1,000,000",
    PAYMENT_AMOUNT_NAIRA_WORDS: "One Million Naira",
    DOCUMENT_DATE: "30th September 2026",
    DOCUMENT_DATE_DAY: "30th",
    DOCUMENT_DATE_MONTH: "September",
    DOCUMENT_DATE_YEAR: "2026",
  });
}

function addUnavailableFontFamily(buffer: Buffer): Buffer {
  const zip = new PizZip(buffer);
  const document = zip.file("word/document.xml")!.asText();
  const family = "Brikvest-Legal-Font-Strict-Gate-Definitely-Uninstalled-7788";
  const paragraph =
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr>` +
    `<w:t>Font gate probe</w:t></w:r></w:p>`;
  if (!document.includes("<w:body>")) {
    throw new Error("Rendered DOCX fixture has no Word document body");
  }
  zip.file("word/document.xml", document.replace("<w:body>", `<w:body>${paragraph}`));
  return zip.generate({ type: "nodebuffer" });
}

describe("DOCX conversion font fidelity", () => {
  it("uses per-family exact-match and valid embedded-font evidence", () => {
    const requirements = readDocxFontRequirements([deedTemplate, transferTemplate]);
    const readiness = assessDocxFontReadiness(requirements, (family) =>
      family === "Cambria" ? "Cambria" : "Liberation Serif",
    );

    expect(readiness.find((font) => font.family === "Cambria")).toMatchObject({
      installedExactMatch: true,
      embeddedInTemplate: false,
      ready: true,
    });
    expect(readiness.find((font) => font.family === "Georgia")).toMatchObject({
      installedExactMatch: false,
      embeddedInTemplate: false,
      ready: false,
    });
    expect(readiness.find((font) => font.family === "Palatino Linotype")).toMatchObject({
      installedExactMatch: false,
      embeddedInTemplate: true,
      ready: true,
    });
    expect(() =>
      assertDocxFontsAvailable(deedTemplate, (family) =>
        family === "Cambria" ? "Cambria" : "Liberation Serif",
      ),
    ).toThrow(/Georgia.*no valid embedded font data/i);
    expect(() =>
      assertDocxFontsAvailable(deedTemplate, (family) => family),
    ).not.toThrow();
  });

  it.each(["production", "development"])(
    "blocks conversion before LibreOffice in %s when the actual DOCX has an unavailable family",
    async (environment) => {
      const previousEnvironment = process.env.NODE_ENV;
      process.env.NODE_ENV = environment;
      try {
        await expect(
          convertDocxToPdf(addUnavailableFontFamily(renderedDeed()), {
            libreOfficePath: "/missing/libreoffice",
          }),
        ).rejects.toThrow(
          /Brikvest-Legal-Font-Strict-Gate-Definitely-Uninstalled-7788.*no valid embedded font data/i,
        );
      } finally {
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
      }
    },
  );

  it("allows isolated NODE_ENV=test layout conversion to exercise real LibreOffice", async () => {
    await expect(
      convertDocxToPdf(addUnavailableFontFamily(renderedDeed()), {
        libreOfficePath: "/missing/libreoffice",
      }),
    ).rejects.toThrow(/LibreOffice DOCX-to-PDF conversion failed|could not start/);
  });
});