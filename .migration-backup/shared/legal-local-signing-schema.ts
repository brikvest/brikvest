import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Durable, first-party investor signing operations. This is deliberately
 * separate from historical third-party signing records.
 */
export const localLegalSigningOperations = pgTable("local_legal_signing_operations", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  pairId: integer("pair_id").notNull(),
  userId: integer("user_id").notNull(),
  templateId: integer("template_id").notNull(),
  signerName: text("signer_name").notNull(),
  signerEmail: text("signer_email").notNull(),
  unsignedPdfSha256: text("unsigned_pdf_sha256").notNull(),
  signaturePlacement: jsonb("signature_placement").notNull(),
  signedPdfRecordKey: uuid("signed_pdf_record_key").notNull(),
  certificateRecordKey: uuid("certificate_record_key").notNull(),
  status: text("status").notNull().default("draft"),
  challengeHash: text("challenge_hash"),
  challengeExpiresAt: timestamp("challenge_expires_at", { withTimezone: true }),
  failedAuthAttempts: integer("failed_auth_attempts").notNull().default(0),
  authLockedUntil: timestamp("auth_locked_until", { withTimezone: true }),
  consentVersion: text("consent_version"),
  consentText: text("consent_text"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  reauthenticatedAt: timestamp("reauthenticated_at", { withTimezone: true }),
  evidenceSnapshot: jsonb("evidence_snapshot"),
  evidenceSha256: text("evidence_sha256"),
  signaturePngBase64: text("signature_png_base64"),
  signatureSha256: text("signature_sha256"),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  signedPdfSha256: text("signed_pdf_sha256"),
  certificateSha256: text("certificate_sha256"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("local_legal_signing_operations_document_uq").on(table.documentId),
  uniqueIndex("local_legal_signing_operations_signed_key_uq").on(table.signedPdfRecordKey),
  uniqueIndex("local_legal_signing_operations_certificate_key_uq").on(table.certificateRecordKey),
]);