import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { LegalFileNotFoundError, type LegalStorageReference } from "../server/legal/files";
import { renderLegalTemplate, validateLegalTemplate } from "../server/legal/templates";
import { createLegalWorker } from "../server/legal/worker";
import type { LegalJobClaim } from "../server/legal/repository";
import type { PdfTextPosition } from "../server/legal/converter";
import { convertDocxToPdf, prepareDocxForPdf, verifyAssigneeSignaturePosition } from "../server/legal/converter";
import { readDocxFontRequirements } from "../server/legal/font-validation";

vi.mock("../server/emailService", () => ({
  sendEmail: vi.fn(async () => true),
}));

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deedTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/deed_of_assignment_v1.docx"),
);
const transferTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/transfer_exit_rights_v1.docx"),
);
const validPdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(128, 65)]);
const approvedAt = new Date("2026-09-30T17:41:00.000Z");
const fullName = "Ada <Lovelace> & Friends";
const address = "1 Example Street, Abuja";
const embeddedImage = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082",
  "hex",
);

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function addBodyImage(template: Buffer): Buffer {
  const zip = new PizZip(template);
  let documentXml = zip.file("word/document.xml")!.asText();
  const namespaces: Record<string, string> = {
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  };
  documentXml = documentXml.replace(/<w:document\b[^>]*>/, (root) => {
    const missing = Object.entries(namespaces)
      .filter(([prefix]) => !new RegExp(`\\bxmlns:${prefix}=`).test(root))
      .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
      .join("");
    return root.slice(0, -1) + missing + ">";
  });
  const drawing = '<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="143" name="Task143 body image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdTask143Image"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  documentXml = documentXml.replace(/<\/w:p>/, `${drawing}</w:p>`);
  zip.file("word/document.xml", documentXml);
  const relationships = zip.file("word/_rels/document.xml.rels")!.asText();
  zip.file(
    "word/_rels/document.xml.rels",
    relationships.replace(
      "</Relationships>",
      '<Relationship Id="rIdTask143Image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/task143.png"/></Relationships>',
    ),
  );
  const contentTypes = zip.file("[Content_Types].xml")!.asText();
  if (!/Extension="png"/i.test(contentTypes)) {
    zip.file(
      "[Content_Types].xml",
      contentTypes.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>'),
    );
  }
  zip.file("word/media/task143.png", embeddedImage);
  return zip.generate({ type: "nodebuffer" });
}

function expectImageParts(docx: Buffer): void {
  const zip = new PizZip(docx);
  expect(zip.file("word/media/task143.png")?.asNodeBuffer()).toEqual(embeddedImage);
  expect(zip.file("word/_rels/document.xml.rels")!.asText()).toContain('Id="rIdTask143Image"');
  expect(zip.file("word/document.xml")!.asText()).toContain('r:embed="rIdTask143Image"');
}

function createPairResult(options?: {
  ready?: boolean;
  pdfKeys?: string[];
}): {
  pair: Record<string, unknown>;
  documents: Array<Record<string, unknown>>;
} {
  const documents = [
    {
      id: 501,
      document_type: "deed_of_assignment",
      template_id: 101,
      source_docx_key: null,
      unsigned_pdf_key: null,
      unsigned_pdf_sha256: null,
      signature_placement: options?.pdfKeys ? placement("deed_of_assignment:v1") : null,
    },
    {
      id: 502,
      document_type: "transfer_exit_rights",
      template_id: 202,
      source_docx_key: null,
      unsigned_pdf_key: null,
      unsigned_pdf_sha256: null,
      signature_placement: options?.pdfKeys ? placement("transfer_exit_rights:v1") : null,
    },
  ];
  if (options?.pdfKeys) {
    documents.forEach((document, index) => {
      document.source_docx_key = `legal/documents/00000000-0000-5000-8000-00000000000${index}/source_docx`;
      document.unsigned_pdf_key = options.pdfKeys?.[index];
      document.unsigned_pdf_sha256 = sha256(validPdf);
    });
  }
  return {
    pair: {
      id: 60,
      property_id: 7,
      reservation_id: 12,
      user_id: 40,
      status: options?.ready ? "documents_ready" : "generating",
      full_name_snapshot: fullName,
      home_address_snapshot: address,
      property_area_sqm: "1.25",
      units_snapshot: "0.25",
      square_meters_per_unit: "5.00",
      payment_amount_naira: "1000000.50",
      payment_currency: "NGN",
      effective_at: approvedAt,
      deed_template_id: 101,
      transfer_template_id: 202,
      documents_ready_at: options?.ready ? approvedAt : null,
      data_snapshot: {
        userFullName: fullName,
        userHomeAddress: address,
        propertyAreaSqm: "1.25",
        paymentAmountNaira: "1000000.50",
        paymentCurrency: "NGN",
        effectiveAt: approvedAt.toISOString(),
        units: "0.25",
        squareMetersPerUnit: "5.00",
      },
    },
    documents,
  };
}

function claim(kind: LegalJobClaim["kind"], id = 10): LegalJobClaim {
  return {
    id,
    pairId: 60,
    kind,
    leaseToken: `lease-${id}`,
    attempts: 1,
  };
}

const placement = (version: string): PdfTextPosition => ({
  templateVersionId: version,
  pageNumber: 1,
  x: 100,
  y: 500,
  width: 140,
  height: 20,
  pageWidth: 612,
  pageHeight: 792,
  coordinateSystem: "pdf-points-top-left",
  anchorText: fullName,
});

function createGenerationDependencies(overrides: Record<string, unknown> = {}) {
  const stored = new Map<string, Buffer>();
  const pairResult = createPairResult();
  const templates = new Map([
    ["legal/templates/deed_of_assignment/v1", deedTemplate],
    ["legal/templates/transfer_exit_rights/v1", transferTemplate],
  ]);
  const dependencies = {
    claimNextLegalJob: vi.fn<() => Promise<LegalJobClaim | null>>().mockResolvedValue(claim("generation")),
    completeLegalJob: vi.fn(async () => undefined),
    failLegalJob: vi.fn(async () => undefined),
    getPairWithDocuments: vi.fn(async () => pairResult),
    getPinnedLegalTemplate: vi.fn(async (templateId: number) =>
      templateId === 101
        ? {
            id: 101,
            documentType: "deed_of_assignment" as const,
            version: 1,
            storageKey: "legal/templates/deed_of_assignment/v1",
            sha256: sha256(deedTemplate),
          }
        : {
            id: 202,
            documentType: "transfer_exit_rights" as const,
            version: 1,
            storageKey: "legal/templates/transfer_exit_rights/v1",
            sha256: sha256(transferTemplate),
          },
    ),
    getLegalNotificationRecipient: vi.fn(async () => ({ email: "ada@example.test", propertyName: "North Estate" })),
    beginLegalNotificationAttempt: vi.fn(async () => ({ state: "send" as const, attempt: 1 })),
    recordLegalNotificationSent: vi.fn(async () => undefined),
    recordLegalNotificationFailed: vi.fn(async () => undefined),
    markLegalNotificationUncertain: vi.fn(async () => undefined),
    recordUnsignedArtifact: vi.fn(async () => undefined),
    markPairReady: vi.fn(async () => undefined),
    readLegalDocument: vi.fn(async (reference: string) => {
      const contents = stored.get(reference);
      if (!contents) throw new LegalFileNotFoundError();
      return contents;
    }),
    readLegalTemplateVersion: vi.fn(async (reference: string) => {
      const contents = templates.get(reference);
      if (!contents) throw new Error("template file missing");
      return contents;
    }),
    storeLegalDocument: vi.fn(async (options: {
      recordKey: string;
      kind: string;
      contents: Buffer;
    }) => {
      const reference =
        `legal/documents/${options.recordKey}/${options.kind}` as LegalStorageReference;
      stored.set(reference, options.contents);
      return reference;
    }),
    renderLegalTemplate: vi.fn(renderLegalTemplate),
    prepareDocxForPdf: vi.fn((bytes: Buffer) => prepareDocxForPdf(bytes, () => "Liberation Serif")),
    validateLegalTemplate: vi.fn(validateLegalTemplate),
    convertDocxToPdf: vi.fn(async () => validPdf),
    verifyAssigneeSignaturePosition: vi.fn(async (_pdf: Buffer, options: {
      assigneeFullName: string;
      templateVersionId: string;
    }) => placement(options.templateVersionId)),
    reconcilePairSigning: vi.fn(async (pairId: number) => ({
      pairId,
      checked: 0,
      completedDocumentIds: [],
      pending: false,
    })),
    sendEmail: vi.fn(async () => true),
    ...overrides,
  };
  return { dependencies, pairResult, stored };
}

describe("legal durable job worker", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://brikvest.example";
  });

  it("generates and stores the pinned pair using frozen values and recovers artifacts on retry", async () => {
    const { dependencies, pairResult, stored } = createGenerationDependencies();
    dependencies.claimNextLegalJob
      .mockResolvedValueOnce(claim("generation", 10))
      .mockResolvedValueOnce(claim("generation", 11))
      .mockResolvedValueOnce(null);
    const worker = createLegalWorker(dependencies);

    const result = await worker.dispatchLegalJobs(2);

    expect(result).toEqual({
      claimed: 2,
      completed: 2,
      failed: 0,
      quarantined: 0,
    });
    expect(dependencies.renderLegalTemplate).toHaveBeenCalledTimes(2);
    expect(dependencies.prepareDocxForPdf).toHaveBeenCalledTimes(2);
    const deedValues = dependencies.renderLegalTemplate.mock.calls[0][2];
    expect(deedValues.USER_FULL_NAME).toBe(fullName);
    expect(deedValues.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBe("1,000,000.50");
    expect(deedValues.PAYMENT_AMOUNT_NAIRA_WORDS).toBe(
      "One Million Naira and Fifty Kobo",
    );
    expect(deedValues.PROPERTY_AREA_SQM).toBe("1.25");
    expect(deedValues.DOCUMENT_DATE).toBe("30th September 2026");
    expect(dependencies.convertDocxToPdf).toHaveBeenCalledTimes(2);
    expect(dependencies.readLegalTemplateVersion).toHaveBeenCalledTimes(2);
    expect(dependencies.recordUnsignedArtifact).toHaveBeenCalledTimes(4);
    expect(dependencies.markPairReady).toHaveBeenCalledTimes(2);
    expect(dependencies.completeLegalJob).toHaveBeenCalledTimes(2);
    expect(dependencies.failLegalJob).not.toHaveBeenCalled();
    expect(stored.size).toBe(4);
    expect(pairResult.documents).toHaveLength(2);
  });

  it("stores the prepared Word bytes used for real PDF conversion and reuses them on a partial retry", async () => {
    const templates = new Map<string, Buffer>();
    for (const [type, source] of [["deed_of_assignment", deedTemplate], ["transfer_exit_rights", transferTemplate]] as const) {
      const zip = new PizZip(source);
      const xml = zip.file("word/document.xml")!.asText();
      const paragraph = (text: string) => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Unavailable Original Serif"/><w:sz w:val="40"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
      const body = paragraph("{{USER_HOME_ADDRESS}} / {{PROPERTY_AREA_SQM}} / {{DOCUMENT_DATE}}") +
        (type === "deed_of_assignment" ? paragraph("{{PAYMENT_AMOUNT_NAIRA_NUMERIC}} / {{PAYMENT_AMOUNT_NAIRA_WORDS}}") : "") +
        paragraph("SIGNED SEALED AND DELIVERED") + paragraph("By the within-named ASSIGNEE") +
        paragraph("{{USER_FULL_NAME}}") + xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)![0];
      zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?<\/w:body>/, `<w:body>${body}</w:body>`));
      templates.set(`legal/templates/${type}/v1`, zip.generate({ type: "nodebuffer" }));
    }
    const { dependencies, stored } = createGenerationDependencies({
      claimNextLegalJob: vi.fn().mockResolvedValueOnce(claim("generation", 10))
        .mockResolvedValueOnce(claim("generation", 11)).mockResolvedValueOnce(null),
      getPinnedLegalTemplate: vi.fn(async (templateId: number) => {
        const documentType = templateId === 101 ? "deed_of_assignment" as const : "transfer_exit_rights" as const;
        const storageKey = `legal/templates/${documentType}/v1`;
        return { id: templateId, documentType, version: 1, storageKey, sha256: sha256(templates.get(storageKey)!) };
      }),
      readLegalTemplateVersion: vi.fn(async (reference: string) => templates.get(reference)!),
      convertDocxToPdf: vi.fn(convertDocxToPdf).mockRejectedValueOnce(new Error("temporary converter outage")),
      verifyAssigneeSignaturePosition: vi.fn(verifyAssigneeSignaturePosition),
    });
    const result = await createLegalWorker(dependencies).dispatchLegalJobs(2);
    expect(result).toMatchObject({ completed: 1, failed: 1 });
    expect(dependencies.prepareDocxForPdf).toHaveBeenCalledTimes(2);
    const writes = dependencies.storeLegalDocument.mock.calls.filter(([options]) => options.kind === "source_docx");
    expect(writes).toHaveLength(2);
    const converted = dependencies.convertDocxToPdf.mock.calls;
    expect(converted).toHaveLength(3);
    expect(converted[0][0]).toEqual(converted[1][0]);
    for (const [docx, options] of converted) {
      expect(options).toEqual({ preserveTypography: true });
      expect(readDocxFontRequirements([docx]).families).toEqual(["Liberation Serif"]);
      expect(writes.some(([write]) => write.contents.equals(docx))).toBe(true);
    }
    expect(stored.size).toBe(4);
    expect(dependencies.recordUnsignedArtifact).toHaveBeenCalledTimes(2);
  }, 120_000);

  it("never rewrites historical generated or investor-signed artifacts during recovery", async () => {
    const { dependencies, stored, pairResult } = createGenerationDependencies();
    // First establish deterministic keys, then replace the in-memory artifacts
    // with a historical original-typography Word/PDF pair.
    await createLegalWorker(dependencies).dispatchLegalJobs(1);
    for (const key of stored.keys()) {
      if (key.endsWith("/source_docx")) stored.set(key, Buffer.from(deedTemplate));
    }
    const retained = new Map(Array.from(stored, ([key, bytes]) => [key, Buffer.from(bytes)]));
    vi.clearAllMocks();
    pairResult.pair.status = "investor_signed";
    pairResult.documents.forEach((document) => { (document as Record<string, unknown>).status = "investor_signed"; });
    await createLegalWorker(dependencies).dispatchLegalJobs(1);
    expect(dependencies.prepareDocxForPdf).not.toHaveBeenCalled();
    expect(dependencies.renderLegalTemplate).not.toHaveBeenCalled();
    expect(dependencies.convertDocxToPdf).not.toHaveBeenCalled();
    expect(dependencies.storeLegalDocument).not.toHaveBeenCalled();
    for (const [key, bytes] of retained) expect(stored.get(key)).toEqual(bytes);
    // A missing signed artifact is not permission to create a replacement.
    const docxKey = Array.from(stored.keys()).find((key) => key.endsWith("/source_docx"))!;
    stored.delete(docxKey);
    await createLegalWorker(dependencies).dispatchLegalJobs(1);
    expect(dependencies.storeLegalDocument).not.toHaveBeenCalled();
    expect(dependencies.convertDocxToPdf).not.toHaveBeenCalled();
    expect(dependencies.failLegalJob).toHaveBeenCalled();
  });

  it("does not persist a newly rendered document if the authorized fallback cannot be verified", async () => {
    const { dependencies } = createGenerationDependencies({
      prepareDocxForPdf: vi.fn((bytes: Buffer) => prepareDocxForPdf(bytes, () => "Not Liberation Serif")),
    });
    expect((await createLegalWorker(dependencies).dispatchLegalJobs(1)).failed).toBe(1);
    expect(dependencies.storeLegalDocument).not.toHaveBeenCalled();
    expect(dependencies.recordUnsignedArtifact).not.toHaveBeenCalled();
    expect(dependencies.markPairReady).not.toHaveBeenCalled();
  });

  it("preserves source images for both document types through worker rendering and PDF conversion", async () => {
    const imageTemplates = new Map([
      ["legal/templates/deed_of_assignment/v1", addBodyImage(deedTemplate)],
      ["legal/templates/transfer_exit_rights/v1", addBodyImage(transferTemplate)],
    ]);
    const dependencies = createGenerationDependencies({
      claimNextLegalJob: vi.fn()
        .mockResolvedValueOnce(claim("generation"))
        .mockResolvedValue(null),
      getPinnedLegalTemplate: vi.fn(async (templateId: number) => {
        const documentType = templateId === 101 ? "deed_of_assignment" as const : "transfer_exit_rights" as const;
        const storageKey = `legal/templates/${documentType}/v1`;
        return {
          id: templateId,
          documentType,
          version: 1,
          storageKey,
          sha256: sha256(imageTemplates.get(storageKey)!),
        };
      }),
      readLegalTemplateVersion: vi.fn(async (reference: string) => {
        const contents = imageTemplates.get(reference);
        if (!contents) throw new Error(`Missing image fixture: ${reference}`);
        return contents;
      }),
    }).dependencies;

    const result = await createLegalWorker(dependencies).dispatchLegalJobs(1);

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, quarantined: 0 });
    expect(dependencies.renderLegalTemplate).toHaveBeenCalledTimes(2);
    expect(dependencies.renderLegalTemplate.mock.calls.map(([template]) => template)).toEqual(
      expect.arrayContaining([imageTemplates.get("legal/templates/deed_of_assignment/v1"), imageTemplates.get("legal/templates/transfer_exit_rights/v1")]),
    );
    expect(dependencies.convertDocxToPdf).toHaveBeenCalledTimes(2);
    for (const [docx] of dependencies.convertDocxToPdf.mock.calls) {
      expectImageParts(docx as Buffer);
    }
    const sourceDocxWrites = dependencies.storeLegalDocument.mock.calls
      .filter(([options]) => options.kind === "source_docx");
    expect(sourceDocxWrites).toHaveLength(2);
    for (const [options] of sourceDocxWrites) {
      expectImageParts(options.contents);
    }
  });

  it("fails closed on a frozen area mismatch without writing artifacts", async () => {
    const { dependencies, pairResult } = createGenerationDependencies();
    pairResult.pair.property_area_sqm = "1.30";
    const worker = createLegalWorker(dependencies);

    const result = await worker.dispatchLegalJobs(1);

    expect(result.failed).toBe(1);
    expect(dependencies.storeLegalDocument).not.toHaveBeenCalled();
    expect(dependencies.recordUnsignedArtifact).not.toHaveBeenCalled();
    expect(dependencies.failLegalJob).toHaveBeenCalledWith(
      10,
      "lease-10",
      expect.stringContaining("snapshot"),
    );
  });

  it("sends one escaped holding link only after both hashed PDFs exist and records success", async () => {
    const pdfKeys = [
      "legal/documents/00000000-0000-5000-8000-000000000001/unsigned_pdf",
      "legal/documents/00000000-0000-5000-8000-000000000002/unsigned_pdf",
    ];
    const pairResult = createPairResult({ ready: true, pdfKeys });
    const dependencies = createGenerationDependencies({
      claimNextLegalJob: vi.fn(async () => claim("notify")),
      getPairWithDocuments: vi.fn(async () => pairResult),
      readLegalDocument: vi.fn(async () => validPdf),
      sendEmail: vi.fn(async () => true),
    }).dependencies;
    const worker = createLegalWorker(dependencies);

    const result = await worker.dispatchLegalJobs(1);

    expect(result.completed).toBe(1);
    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
    const email = dependencies.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("ada@example.test");
    expect(email.html).toContain("Ada &lt;Lovelace&gt; &amp; Friends");
    expect(email.html).toContain('alt="Brikvest Logo"');
    expect(email.html).toContain("Review &amp; Sign Your Documents");
    expect(email.html).toContain("not full legal execution");
    expect(email.html).toContain("North Estate");
    expect(email.html).not.toContain("OceanView Estate");
    expect(email).not.toHaveProperty("attachments");
    expect(email.html).toContain("The Brikvest Team");
    expect(email.html).toContain(
      "https://brikvest.example/dashboard?holding=12",
    );
    expect(dependencies.recordLegalNotificationSent).toHaveBeenCalledWith(
      10,
      "lease-10",
      1,
    );
  });
  it("requires retained placement integrity and never sends a fully signed pair another request", async () => {
    const pairResult = createPairResult({ ready: true, pdfKeys: [
      "legal/documents/00000000-0000-5000-8000-000000000001/unsigned_pdf",
      "legal/documents/00000000-0000-5000-8000-000000000002/unsigned_pdf",
    ] });
    const dependencies = createGenerationDependencies({
      claimNextLegalJob: vi.fn(async () => claim("notify")),
      getPairWithDocuments: vi.fn(async () => pairResult),
      readLegalDocument: vi.fn(async () => validPdf),
    }).dependencies;
    pairResult.documents[1].signature_placement = null;
    expect((await createLegalWorker(dependencies).dispatchLegalJobs(1)).failed).toBe(1);
    expect(dependencies.sendEmail).not.toHaveBeenCalled();
    expect(dependencies.beginLegalNotificationAttempt).not.toHaveBeenCalled();
    pairResult.documents[1].signature_placement = placement("transfer_exit_rights:v1");
    pairResult.pair.status = "partially_signed";
    pairResult.documents[0].status = "investor_signed";
    expect((await createLegalWorker(dependencies).dispatchLegalJobs(1)).completed).toBe(1);
    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
    pairResult.pair.status = "investor_signed";
    pairResult.documents[1].status = "investor_signed";
    expect((await createLegalWorker(dependencies).dispatchLegalJobs(1)).completed).toBe(1);
    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
    expect(dependencies.storeLegalDocument).not.toHaveBeenCalled();
  });

  it("treats a false email result as failure and quarantines stale uncertain delivery", async () => {
    const pdfKeys = [
      "legal/documents/00000000-0000-5000-8000-000000000001/unsigned_pdf",
      "legal/documents/00000000-0000-5000-8000-000000000002/unsigned_pdf",
    ];
    const pairResult = createPairResult({ ready: true, pdfKeys });
    const failedDependencies = createGenerationDependencies({
      claimNextLegalJob: vi.fn(async () => claim("notify")),
      getPairWithDocuments: vi.fn(async () => pairResult),
      readLegalDocument: vi.fn(async () => validPdf),
      sendEmail: vi.fn(async () => false),
    }).dependencies;
    const result = await createLegalWorker(failedDependencies).dispatchLegalJobs(1);
    expect(result.failed).toBe(1);
    expect(failedDependencies.recordLegalNotificationFailed).toHaveBeenCalledWith(
      10,
      "lease-10",
      1,
      "sendEmail returned false",
    );
    expect(failedDependencies.recordLegalNotificationSent).not.toHaveBeenCalled();
    expect(failedDependencies.failLegalJob).toHaveBeenCalled();

    const uncertainDependencies = createGenerationDependencies({
      claimNextLegalJob: vi.fn(async () => claim("notify")),
      getPairWithDocuments: vi.fn(async () => pairResult),
      readLegalDocument: vi.fn(async () => validPdf),
      beginLegalNotificationAttempt: vi.fn(async () => ({ state: "uncertain" as const })),
    }).dependencies;
    const quarantined = await createLegalWorker(uncertainDependencies).dispatchLegalJobs(1);
    expect(quarantined).toEqual({
      claimed: 1,
      completed: 0,
      failed: 0,
      quarantined: 1,
    });
    expect(uncertainDependencies.sendEmail).not.toHaveBeenCalled();
    expect(uncertainDependencies.completeLegalJob).not.toHaveBeenCalled();
    expect(uncertainDependencies.failLegalJob).not.toHaveBeenCalled();
  });

  it("marks a thrown SMTP result uncertain and does not automatically retry the ambiguous delivery", async () => {
    const pdfKeys = [
      "legal/documents/00000000-0000-5000-8000-000000000001/unsigned_pdf",
      "legal/documents/00000000-0000-5000-8000-000000000002/unsigned_pdf",
    ];
    const pairResult = createPairResult({ ready: true, pdfKeys });
    const dependencies = createGenerationDependencies({
      claimNextLegalJob: vi.fn(async () => claim("notify")),
      getPairWithDocuments: vi.fn(async () => pairResult),
      readLegalDocument: vi.fn(async () => validPdf),
      sendEmail: vi.fn(async () => {
        throw new Error("SMTP connection ended without a delivery result");
      }),
    }).dependencies;

    const result = await createLegalWorker(dependencies).dispatchLegalJobs(1);

    expect(result).toEqual({
      claimed: 1,
      completed: 0,
      failed: 0,
      quarantined: 1,
    });
    expect(dependencies.markLegalNotificationUncertain).toHaveBeenCalledWith(
      10,
      "lease-10",
      1,
      "sendEmail threw before returning a definitive delivery result",
    );
    expect(dependencies.failLegalJob).not.toHaveBeenCalled();
    expect(dependencies.completeLegalJob).not.toHaveBeenCalled();
  });

  it("does not duplicate an audited notification and rejects a non-HTTPS base URL", async () => {
    const pdfKeys = [
      "legal/documents/00000000-0000-5000-8000-000000000001/unsigned_pdf",
      "legal/documents/00000000-0000-5000-8000-000000000002/unsigned_pdf",
    ];
    const pairResult = createPairResult({ ready: true, pdfKeys });
    const alreadySentDependencies = createGenerationDependencies({
      claimNextLegalJob: vi.fn(async () => claim("notify")),
      getPairWithDocuments: vi.fn(async () => pairResult),
      readLegalDocument: vi.fn(async () => validPdf),
      beginLegalNotificationAttempt: vi.fn(async () => ({ state: "already_sent" as const })),
    }).dependencies;
    const alreadySent = await createLegalWorker(alreadySentDependencies).dispatchLegalJobs(1);
    expect(alreadySent.completed).toBe(1);
    expect(alreadySentDependencies.sendEmail).not.toHaveBeenCalled();
    expect(alreadySentDependencies.completeLegalJob).toHaveBeenCalledTimes(1);

    process.env.APP_BASE_URL = "http://brikvest.example";
    const invalidUrlDependencies = createGenerationDependencies({
      claimNextLegalJob: vi.fn(async () => claim("notify")),
      getPairWithDocuments: vi.fn(async () => pairResult),
      readLegalDocument: vi.fn(async () => validPdf),
    }).dependencies;
    const invalidUrl = await createLegalWorker(invalidUrlDependencies).dispatchLegalJobs(1);
    expect(invalidUrl.failed).toBe(1);
    expect(invalidUrlDependencies.beginLegalNotificationAttempt).not.toHaveBeenCalled();
    expect(invalidUrlDependencies.sendEmail).not.toHaveBeenCalled();
  });

  it("accepts property-owned immutable upload references and rejects cross-property pins", async () => {
    const makeDependencies = (propertyId: number) => createGenerationDependencies({
      getPinnedLegalTemplate: vi.fn(async (templateId: number) => {
        const type = templateId === 101 ? "deed_of_assignment" : "transfer_exit_rights";
        return {
          id: templateId, propertyId, documentType: type, version: 1,
          storageKey: `legal/templates/properties/${propertyId}/${type}/v1/00000000-0000-4000-8000-000000000001`,
          sha256: sha256(templateId === 101 ? deedTemplate : transferTemplate),
        };
      }),
      readLegalTemplateVersion: vi.fn(async (key: string) =>
        key.includes("deed_of_assignment") ? deedTemplate : transferTemplate),
    }).dependencies;
    const own = makeDependencies(7);
    expect((await createLegalWorker(own).dispatchLegalJobs(1)).completed).toBe(1);
    const foreign = makeDependencies(8);
    expect((await createLegalWorker(foreign).dispatchLegalJobs(1)).failed).toBe(1);
    expect(foreign.storeLegalDocument).not.toHaveBeenCalled();
  });

  it("caps dispatch at ten jobs and retries pending signing reconciliation", async () => {
    const { dependencies } = createGenerationDependencies({
      claimNextLegalJob: vi.fn(async () => claim("reconcile")),
      reconcilePairSigning: vi.fn(async (pairId: number) => ({
        pairId,
        checked: 1,
        completedDocumentIds: [],
        pending: true,
      })),
    });
    const result = await createLegalWorker(dependencies).dispatchLegalJobs(100);
    expect(result.claimed).toBe(10);
    expect(result.failed).toBe(10);
    expect(dependencies.reconcilePairSigning).toHaveBeenCalledTimes(10);
    expect(dependencies.failLegalJob).toHaveBeenCalledTimes(10);
    expect(dependencies.completeLegalJob).not.toHaveBeenCalled();
  });
});
