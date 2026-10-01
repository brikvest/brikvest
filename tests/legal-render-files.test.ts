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
  readLegalTemplateVersion,
  streamAuthorizedLegalDocument,
} from "../server/legal/files";

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

  it("accepts complete legacy split dates without changing clause bytes", async () => {
    await expect(
      storeLegalTemplateVersion({
        documentType: "deed_of_assignment",
        version: 2,
        docxBuffer: deedTemplate,
      }),
    ).resolves.toBe("legal/templates/deed_of_assignment/v2");
    expect(mocks.file).toHaveBeenCalledWith(
      ".private/legal/templates/deed_of_assignment/v2.docx",
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toEqual(deedTemplate);
    await expect(readLegalTemplateVersion("legal/templates/deed_of_assignment/v2")).resolves.toEqual(deedTemplate);
  });

  it("stores collision-safe scoped uploads immutably and reads scoped and legacy keys", async () => {
    const uploadId = "a2b2a2b2-a2b2-42b2-82b2-a2b2a2b2a2b2";
    const reference = `legal/templates/properties/19/deed_of_assignment/v2/${uploadId}`;
    await expect(storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 19, uploadId, docxBuffer: deedTemplate,
    })).resolves.toBe(reference);
    expect(mocks.file).toHaveBeenCalledWith(`.private/${reference}.docx`);
    expect(mocks.save.mock.calls[0][1].preconditionOpts).toEqual({ ifGenerationMatch: 0 });
    await expect(readLegalTemplateVersion(reference)).resolves.toEqual(deedTemplate);
    mocks.save.mockRejectedValueOnce(Object.assign(new Error("collision"), { code: 412 }));
    await expect(storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 19, uploadId, docxBuffer: deedTemplate,
    })).rejects.toBeInstanceOf(LegalFileAlreadyExistsError);
    const first = await storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 19, docxBuffer: deedTemplate,
    });
    const second = await storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 19, docxBuffer: deedTemplate,
    });
    expect(first).not.toBe(second);
    expect(first).toMatch(/^legal\/templates\/properties\/19\/deed_of_assignment\/v2\/[a-f0-9-]{36}$/);
  });

  it("rejects unsafe scoped template IDs before accessing storage", async () => {
    await expect(storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 0, docxBuffer: deedTemplate,
    })).rejects.toThrow("property ID");
    await expect(storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 19, uploadId: "../escape", docxBuffer: deedTemplate,
    })).rejects.toThrow("UUID");
    await expect(readLegalTemplateVersion("legal/templates/properties/19/deed_of_assignment/v2/../../escape"))
      .rejects.toThrow("not found");
    expect(mocks.file).not.toHaveBeenCalled();
  });

  it("round-trips exact scoped paths for two properties without falling back to a legacy object", async () => {
    // Unlike the broad response mocks above, this adapter binds every operation
    // to its actual object key. A reader that drops property/upload IDs fails.
    const objects = new Map<string, Buffer>();
    const reads: string[] = [];
    mocks.file.mockImplementation((objectPath: string) => ({
      save: async (contents: Buffer, options: { preconditionOpts: { ifGenerationMatch: number } }) => {
        expect(options.preconditionOpts).toEqual({ ifGenerationMatch: 0 });
        if (objects.has(objectPath)) throw Object.assign(new Error("immutable object exists"), { code: 412 });
        objects.set(objectPath, Buffer.from(contents));
      },
      exists: async () => {
        reads.push(objectPath);
        return [objects.has(objectPath)];
      },
      download: async () => {
        const contents = objects.get(objectPath);
        if (!contents) throw new Error(`Missing fixture object: ${objectPath}`);
        return [Buffer.from(contents)];
      },
    }));
    const zip = new PizZip(deedTemplate);
    zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace(
      "</w:body>", "<w:p><w:r><w:t>Distinct property-specific clause fixture</w:t></w:r></w:p></w:body>",
    ));
    const otherPropertyTemplate = zip.generate({ type: "nodebuffer" });
    const uploadId = "a2b2a2b2-a2b2-42b2-82b2-a2b2a2b2a2b2";
    const first = await storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 19, uploadId, docxBuffer: deedTemplate,
    });
    const second = await storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 20, uploadId, docxBuffer: otherPropertyTemplate,
    });
    // Deliberately create a legacy file for the same type/version. It must never
    // be returned for a scoped reference, even when the scoped file is absent.
    const legacy = await storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, docxBuffer: deedTemplate,
    });
    await expect(readLegalTemplateVersion(first)).resolves.toEqual(deedTemplate);
    await expect(readLegalTemplateVersion(second)).resolves.toEqual(otherPropertyTemplate);
    await expect(readLegalTemplateVersion(legacy)).resolves.toEqual(deedTemplate);
    expect(reads).toEqual([`.private/${first}.docx`, `.private/${second}.docx`, `.private/${legacy}.docx`]);

    await expect(readLegalTemplateVersion(first.replace("/properties/19/", "/properties/21/")))
      .rejects.toThrow("Legal document not found");
    await expect(readLegalTemplateVersion(first.replace(uploadId, "b2b2a2b2-a2b2-42b2-82b2-a2b2a2b2a2b2")))
      .rejects.toThrow("Legal document not found");
    objects.delete(`.private/${second}.docx`);
    await expect(readLegalTemplateVersion(second)).rejects.toThrow("Legal document not found");
    await expect(readLegalTemplateVersion(legacy)).resolves.toEqual(deedTemplate);
    await expect(storeLegalTemplateVersion({
      documentType: "deed_of_assignment", version: 2, propertyId: 19, uploadId, docxBuffer: otherPropertyTemplate,
    })).rejects.toBeInstanceOf(LegalFileAlreadyExistsError);
    await expect(readLegalTemplateVersion(first)).resolves.toEqual(deedTemplate);
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
