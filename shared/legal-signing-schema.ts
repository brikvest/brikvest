import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, index, uuid } from "drizzle-orm/pg-core";

/**
 * DocuSign signing persistence is split from the legal-document schema so its
 * migration can be deployed independently and append-only signing records
 * cannot be conflated with generated-document metadata.
 */
export const legalSigningOperations = pgTable("legal_signing_operations", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  pairId: integer("pair_id").notNull(),
  templateId: integer("template_id").notNull(),
  provider: text("provider").notNull().default("docusign"),
  transactionId: text("transaction_id").notNull(),
  envelopeId: text("envelope_id"),
  signerEmail: text("signer_email").notNull(),
  signerName: text("signer_name").notNull(),
  recipientId: text("recipient_id").notNull(),
  clientUserId: text("client_user_id").notNull(),
  signaturePlacement: jsonb("signature_placement").notNull(),
  unsignedPdfSha256: text("unsigned_pdf_sha256").notNull(),
  signedPdfRecordKey: uuid("signed_pdf_record_key").notNull(),
  certificateRecordKey: uuid("certificate_record_key").notNull(),
  certificateSha256: text("certificate_sha256"),
  status: text("status").notNull().default("prepared"),
  leaseKind: text("lease_kind"),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("legal_signing_operations_document_uq").on(table.documentId),
  uniqueIndex("legal_signing_operations_transaction_uq").on(table.transactionId),
  uniqueIndex("legal_signing_operations_envelope_uq").on(table.envelopeId),
  index("legal_signing_operations_pair_status_idx").on(table.pairId, table.status, table.leaseUntil),
]);

export const legalSigningWebhookEvents = pgTable("legal_signing_webhook_events", {
  eventHash: text("event_hash").primaryKey(),
  envelopeId: text("envelope_id").notNull(),
  eventType: text("event_type").notNull(),
  operationId: integer("operation_id"),
  pairId: integer("pair_id"),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid("lease_token"),
  leasedUntil: timestamp("leased_until", { withTimezone: true }),
  lastError: text("last_error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("legal_signing_webhook_pending_idx").on(table.status, table.availableAt, table.receivedAt),
  index("legal_signing_webhook_envelope_idx").on(table.envelopeId),
]);