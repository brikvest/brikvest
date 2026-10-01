import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";

const mocks = vi.hoisted(() => ({
  bucket: vi.fn(),
  file: vi.fn(),
  save: vi.fn(),
  exists: vi.fn(),
  download: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("../server/objectStorage", () => ({
  objectStorageClient: {
    bucket: mocks.bucket,
  },
}));

import {
  LegalFileAlreadyExistsError,
  storeLegalDocument,
  storeLegalTemplateVersion,
  streamAuthorizedLegalDocument,
} from "../server/legal/files";
import { normalizeSuppliedLegalTemplate } from "../server/legal/templates";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deedTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/deed_of_assignment_v1.docx"),
);
const validPdf = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.alloc(128, 65),
]);

function createResponse() {
  const response = new PassThrough() as PassThrough & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    headersSent: boolean;
  };
  response.status = vi.fn(() => response);
  response.json = vi.fn(() => response);
  response.set = vi.fn(() => response);
  response.headersSent = false;
  return response;
}

describe("private legal document storage", () => {
  beforeEach(() => {
    process.env.PRIVATE_OBJECT_DIR = "/legal-private-bucket/.private";
    mocks.bucket.mockReset();
    mocks.file.mockReset();
    mocks.save.mockReset();
    mocks.exists.mockReset();
    mocks.download.mockReset();
    mocks.createReadStream.mockReset();

    const bucketObject = { file: mocks.file };
    mocks.bucket.mockReturnValue(bucketObject);
    mocks.file.mockReturnValue({
      save: mocks.save,
      exists: mocks.exists,
      download: mocks.download,
      createReadStream: mocks.createReadStream,
    });
    mocks.save.mockResolvedValue(undefined);
    mocks.exists.mockResolvedValue([true]);
    mocks.download.mockResolvedValue([deedTemplate]);
  });

  it("writes legal PDFs only to a private versioned object key, without overwrite", async () => {
    const recordKey = "a2b2a2b2-a2b2-42b2-82b2-a2b2a2b2a2b2";
    const reference = await storeLegalDocument({
      recordKey,
      kind: "unsigned_pdf",
      contents: validPdf,
    });

    expect(reference).toBe(`legal/documents/${recordKey}/unsigned_pdf`);
    expect(mocks.bucket).toHaveBeenCalledWith("legal-private-bucket");
    expect(mocks.file).toHaveBeenCalledWith(
      `.private/legal/documents/${recordKey}/unsigned_pdf.pdf`,
    );
    expect(mocks.save).toHaveBeenCalledWith(
      validPdf,
      expect.objectContaining({
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: expect.objectContaining({
          contentType: "application/pdf",
          cacheControl: "private, no-store",
        }),
      }),
    );

    mocks.save.mockRejectedValueOnce(Object.assign(new Error("already exists"), { code: 412 }));
    await expect(
      storeLegalDocument({
        recordKey,
        kind: "unsigned_pdf",
        contents: validPdf,
      }),
    ).rejects.toBeInstanceOf(LegalFileAlreadyExistsError);
  });

  it("rejects unsafe record keys and non-PDF bytes before storage", async () => {
    await expect(
      storeLegalDocument({
        recordKey: "../other-user",
        kind: "signed_pdf",
        contents: validPdf,
      }),
    ).rejects.toThrow("UUID");
    await expect(
      storeLegalDocument({
        recordKey: "a2b2a2b2-a2b2-42b2-82b2-a2b2a2b2a2b2",
        kind: "signed_pdf",
        contents: Buffer.from("not a PDF"),
      }),
    ).rejects.toThrow("PDF content is invalid");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("requires the canonical document date field on newly uploaded templates", async () => {
    await expect(
      storeLegalTemplateVersion({
        documentType: "deed_of_assignment",
        version: 2,
        docxBuffer: deedTemplate,
      }),
    ).rejects.toThrow("DOCUMENT_DATE");
    expect(mocks.save).not.toHaveBeenCalled();

    const zip = new PizZip(normalizeSuppliedLegalTemplate(deedTemplate));
    for (const [name, file] of Object.entries(zip.files)) {
      if (!name.startsWith("word/") || name.endsWith("/")) continue;
      let xml = file.asText();
      for (const legacyField of [
        "{{DOCUMENT_DATE_DAY}}",
        "{{DOCUMENT_DATE_MONTH}}",
        "{{DOCUMENT_DATE_YEAR}}",
      ]) {
        xml = xml.replaceAll(legacyField, "{{DOCUMENT_DATE}}");
      }
      zip.file(name, xml);
    }
    const canonicalDateTemplate = zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    await expect(
      storeLegalTemplateVersion({
        documentType: "deed_of_assignment",
        version: 2,
        docxBuffer: canonicalDateTemplate,
      }),
    ).resolves.toBe("legal/templates/deed_of_assignment/v2");
    expect(mocks.file).toHaveBeenCalledWith(
      ".private/legal/templates/deed_of_assignment/v2.docx",
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("does not resolve a storage object for another user's record", async () => {
    const response = createResponse();
    await streamAuthorizedLegalDocument(response as any, {
      requesterUserId: 8,
      documentOwnerUserId: 9,
      storageReference:
        "legal/documents/a2b2a2b2-a2b2-42b2-82b2-a2b2a2b2a2b2/unsigned_pdf",
    });

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ error: "Legal document not found" });
    expect(mocks.file).not.toHaveBeenCalled();
  });

  it("streams only an owner-authorized document from its stored record key", async () => {
    const payload = Buffer.from("private legal PDF");
    mocks.createReadStream.mockImplementation(() => {
      const stream = new PassThrough();
      queueMicrotask(() => {
        stream.end(payload);
      });
      return stream;
    });
    const response = createResponse();
    const chunks: Buffer[] = [];
    response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    const completed = new Promise<void>((resolve) => response.on("end", () => resolve()));

    await streamAuthorizedLegalDocument(response as any, {
      requesterUserId: 8,
      documentOwnerUserId: 8,
      storageReference:
        "legal/documents/a2b2a2b2-a2b2-42b2-82b2-a2b2a2b2a2b2/signed_pdf",
      disposition: "attachment",
    });
    await completed;

    expect(mocks.file).toHaveBeenCalledWith(
      ".private/legal/documents/a2b2a2b2-a2b2-42b2-82b2-a2b2a2b2a2b2/signed_pdf.pdf",
    );
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="brikvest-legal-document-signed.pdf"',
        "Cache-Control": "private, no-store",
      }),
    );
    expect(Buffer.concat(chunks)).toEqual(payload);
  });
});
