import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import type { File } from "@google-cloud/storage";
import { objectStorageClient } from "../objectStorage";
import {
  assertLegalTemplateIsRendered,
  inspectLegalDocxArchive,
  validateLegalTemplate,
  type LegalDocumentType,
} from "./templates";

export type LegalDocumentFileKind =
  | "source_docx"
  | "unsigned_pdf"
  | "signed_pdf"
  | "audit_certificate_pdf";

declare const legalStorageReferenceBrand: unique symbol;
export type LegalStorageReference = string & {
  readonly [legalStorageReferenceBrand]: true;
};

const DOCUMENT_FILE_TYPES: Record<LegalDocumentFileKind, {
  extension: string;
  contentType: string;
}> = {
  source_docx: {
    extension: "docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  unsigned_pdf: { extension: "pdf", contentType: "application/pdf" },
  signed_pdf: { extension: "pdf", contentType: "application/pdf" },
  audit_certificate_pdf: { extension: "pdf", contentType: "application/pdf" },
};

export interface StoreLegalDocumentOptions {
  recordKey: string;
  kind: LegalDocumentFileKind;
  contents: Buffer;
}

export interface AuthorizedLegalDownloadOptions {
  requesterUserId: number;
  requesterIsAdmin?: boolean;
  documentOwnerUserId: number;
  storageReference: string;
  disposition?: "inline" | "attachment";
}

export class LegalFileNotFoundError extends Error {
  constructor() {
    super("Legal document not found");
    this.name = "LegalFileNotFoundError";
  }
}

export class LegalFileAlreadyExistsError extends Error {
  constructor() {
    super("Legal document object already exists and cannot be replaced");
    this.name = "LegalFileAlreadyExistsError";
  }
}

function assertRecordKey(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Legal document record key must be a UUID");
  }
}

function getPrivateBucketName(): string {
  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  const parts = privateDir.split("/").filter(Boolean);
  if (!privateDir || !parts[0]) {
    throw new Error("PRIVATE_OBJECT_DIR not set; legal documents cannot be stored");
  }
  return parts[0];
}

function documentStorageReference(recordKey: string, kind: LegalDocumentFileKind): LegalStorageReference {
  assertRecordKey(recordKey);
  if (!(kind in DOCUMENT_FILE_TYPES)) throw new Error("Unsupported legal document file kind");
  return `legal/documents/${recordKey}/${kind}` as LegalStorageReference;
}

function parseDocumentStorageReference(reference: string): {
  recordKey: string;
  kind: LegalDocumentFileKind;
} {
  const match = reference.match(/^legal\/documents\/([^/]+)\/(source_docx|unsigned_pdf|signed_pdf|audit_certificate_pdf)$/);
  if (!match) throw new LegalFileNotFoundError();
  assertRecordKey(match[1]);
  return { recordKey: match[1], kind: match[2] as LegalDocumentFileKind };
}

function getDocumentFile(reference: string): File {
  const { recordKey, kind } = parseDocumentStorageReference(reference);
  const { extension } = DOCUMENT_FILE_TYPES[kind];
  const objectPath = `.private/legal/documents/${recordKey}/${kind}.${extension}`;
  return objectStorageClient.bucket(getPrivateBucketName()).file(objectPath);
}

function getDocumentDownloadFilename(kind: LegalDocumentFileKind): string {
  switch (kind) {
    case "source_docx":
      return "brikvest-legal-document.docx";
    case "unsigned_pdf":
      return "brikvest-legal-document-review.pdf";
    case "signed_pdf":
      return "brikvest-legal-document-signed.pdf";
    case "audit_certificate_pdf":
      return "brikvest-signing-audit-certificate.pdf";
  }
}

/**
 * Opaque per-document key generation. Store it with the application document
 * record; routes must authorize the associated record before streaming a file.
 */
export function createLegalDocumentRecordKey(): string {
  return randomUUID();
}

/**
 * Store legal files under the private .private/legal/ namespace. The GCS
 * generation precondition makes every file write-once, including retry paths.
 */
export async function storeLegalDocument(
  options: StoreLegalDocumentOptions,
): Promise<LegalStorageReference> {
  const storageReference = documentStorageReference(options.recordKey, options.kind);
  if (!Buffer.isBuffer(options.contents) || options.contents.length === 0) {
    throw new Error("Legal document content is empty");
  }
  const maxBytes = options.kind === "source_docx" ? 20 * 1024 * 1024 : 25 * 1024 * 1024;
  if (options.contents.length > maxBytes) {
    throw new Error("Legal document exceeds the allowed storage size");
  }
  if (options.kind === "source_docx") {
    inspectLegalDocxArchive(options.contents);
  } else if (
    options.contents.length < 100 ||
    options.contents.subarray(0, 5).toString() !== "%PDF-"
  ) {
    throw new Error("Legal PDF content is invalid");
  }

  const file = getDocumentFile(storageReference);
  try {
    await file.save(options.contents, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: DOCUMENT_FILE_TYPES[options.kind].contentType,
        cacheControl: "private, no-store",
        metadata: {
          recordKey: options.recordKey,
          documentKind: options.kind,
        },
      },
    });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === 409 || code === 412 || code === "409" || code === "412") {
      throw new LegalFileAlreadyExistsError();
    }
    throw new Error("Unable to store legal document in private object storage", {
      cause: error,
    });
  }
  return storageReference;
}

/**
 * Read a previously stored private legal PDF by its opaque application
 * reference. The caller must load and authorize the owning document record;
 * this helper deliberately does not return a public URL.
 */
export async function readLegalDocument(
  storageReference: string,
  expectedKind: LegalDocumentFileKind,
): Promise<Buffer> {
  const parsed = parseDocumentStorageReference(storageReference);
  if (parsed.kind !== expectedKind) throw new LegalFileNotFoundError();
  const file = getDocumentFile(storageReference);
  const [exists] = await file.exists();
  if (!exists) throw new LegalFileNotFoundError();
  const [contents] = await file.download();
  const maxBytes = expectedKind === "source_docx" ? 20 * 1024 * 1024 : 25 * 1024 * 1024;
  if (contents.length === 0 || contents.length > maxBytes) {
    throw new Error("Stored legal document has an invalid size");
  }
  if (expectedKind === "source_docx") {
    assertLegalTemplateIsRendered(contents);
  } else if (contents.length < 100 || contents.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("Stored legal PDF is invalid");
  }
  return contents;
}

export async function readLegalPdf(
  storageReference: string,
  expectedKind: "unsigned_pdf" | "signed_pdf" | "audit_certificate_pdf",
): Promise<Buffer> {
  return readLegalDocument(storageReference, expectedKind);
}

/**
 * Upload an immutable version of a validated admin template. Version rows and
 * active-version changes are managed by the database/routes owned by the
 * integrating application layer.
 */
export async function storeLegalTemplateVersion(options: {
  documentType: LegalDocumentType;
  version: number;
  docxBuffer: Buffer;
}): Promise<LegalStorageReference> {
  if (!Number.isSafeInteger(options.version) || options.version < 1) {
    throw new Error("Legal template version must be a positive integer");
  }
  validateLegalTemplate(options.docxBuffer, options.documentType, {
    requireCanonicalDate: true,
  });

  const storageReference =
    `legal/templates/${options.documentType}/v${options.version}` as LegalStorageReference;
  const objectPath = `.private/${storageReference}.docx`;
  const file = objectStorageClient.bucket(getPrivateBucketName()).file(objectPath);
  try {
    await file.save(options.docxBuffer, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        cacheControl: "private, no-store",
        metadata: {
          documentType: options.documentType,
          templateVersion: String(options.version),
        },
      },
    });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === 409 || code === 412 || code === "409" || code === "412") {
      throw new LegalFileAlreadyExistsError();
    }
    throw new Error("Unable to store legal template in private object storage", {
      cause: error,
    });
  }
  return storageReference;
}

function parseTemplateStorageReference(reference: string): {
  documentType: LegalDocumentType;
  version: number;
} {
  const match = reference.match(
    /^legal\/templates\/(deed_of_assignment|transfer_exit_rights)\/v([1-9]\d*)$/,
  );
  if (!match) throw new LegalFileNotFoundError();
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version)) throw new LegalFileNotFoundError();
  return { documentType: match[1] as LegalDocumentType, version };
}

export async function readLegalTemplateVersion(
  storageReference: string,
): Promise<Buffer> {
  const { documentType, version } = parseTemplateStorageReference(storageReference);
  const file = objectStorageClient
    .bucket(getPrivateBucketName())
    .file(`.private/legal/templates/${documentType}/v${version}.docx`);
  const [exists] = await file.exists();
  if (!exists) throw new LegalFileNotFoundError();
  const [contents] = await file.download();
  validateLegalTemplate(contents, documentType);
  return contents;
}

/**
 * Authenticated download helper. Call only with a document record loaded by a
 * trusted backend route; this function repeats the owner/admin authorization
 * check and never exposes storage object paths or permanent public URLs.
 */
export async function streamAuthorizedLegalDocument(
  response: Response,
  options: AuthorizedLegalDownloadOptions,
): Promise<void> {
  if (
    !options.requesterIsAdmin &&
    (!Number.isSafeInteger(options.requesterUserId) ||
      options.requesterUserId !== options.documentOwnerUserId)
  ) {
    response.status(404).json({ error: "Legal document not found" });
    return;
  }

  let file: File;
  let kind: LegalDocumentFileKind;
  try {
    const parsed = parseDocumentStorageReference(options.storageReference);
    kind = parsed.kind;
    file = getDocumentFile(options.storageReference);
  } catch {
    response.status(404).json({ error: "Legal document not found" });
    return;
  }

  try {
    const [exists] = await file.exists();
    if (!exists) {
      response.status(404).json({ error: "Legal document not found" });
      return;
    }
    response.set({
      "Content-Type": DOCUMENT_FILE_TYPES[kind].contentType,
      "Content-Disposition": `${options.disposition === "attachment" ? "attachment" : "inline"}; filename="${getDocumentDownloadFilename(kind)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    await pipeline(file.createReadStream(), response);
  } catch (error) {
    if (!response.headersSent) {
      response.status(500).json({ error: "Unable to stream legal document" });
    }
    if (response.headersSent) {
      console.error("Error streaming private legal document:", error);
    }
  }
}
