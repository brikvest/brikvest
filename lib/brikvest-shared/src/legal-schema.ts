import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Durable records for the investor legal-document workflow.
 *
 * Foreign keys, immutability constraints, and state checks are installed by
 * scripts/ensure-legal-documents.sql. These declarations intentionally avoid
 * importing the legacy schema tables so schema.ts can re-export them without a
 * circular module dependency.
 */
export const legalPropertyBindings = pgTable("legal_property_bindings", {
  propertyId: integer("property_id").primaryKey(),
  documentScope: text("document_scope").notNull().default("SD118"),
  enabled: boolean("enabled").notNull().default(true),
  squareMetersPerUnit: numeric("square_meters_per_unit", { precision: 12, scale: 2 }).notNull(),
  note: text("note").notNull(),
  boundByAdminId: integer("bound_by_admin_id").notNull(),
  boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("legal_property_bindings_one_active_scope_uq")
    .on(table.documentScope)
    .where(sql`${table.enabled} = true`),
]);

export const legalTemplates = pgTable("legal_templates", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id"),
  documentType: text("document_type").notNull(),
  version: integer("version").notNull(),
  originalFilename: text("original_filename").notNull(),
  storageKey: text("storage_key").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  requiredPlaceholders: text("required_placeholders").array().notNull().default(sql`'{}'::text[]`),
  validationStatus: text("validation_status").notNull().default("pending"),
  isActive: boolean("is_active").notNull().default(false),
  createdByAdminId: integer("created_by_admin_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("legal_templates_type_version_uq").on(table.documentType, table.version),
  uniqueIndex("legal_templates_one_active_per_property_type_uq").on(table.propertyId, table.documentType).where(sql`${table.isActive} = true`),
]);

export const legalDocumentPairs = pgTable("legal_document_pairs", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").notNull().unique(),
  userId: integer("user_id").notNull(),
  propertyId: integer("property_id").notNull(),
  paymentSubmissionId: integer("payment_submission_id"),
  approvalSource: text("approval_source").notNull(),
  approvalSourceId: integer("approval_source_id").notNull(),
  approvedByAdminId: integer("approved_by_admin_id").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  approvalNote: text("approval_note").notNull(),
  fullNameSnapshot: text("full_name_snapshot").notNull(),
  homeAddressSnapshot: text("home_address_snapshot").notNull(),
  propertyAreaSqm: numeric("property_area_sqm", { precision: 14, scale: 2 }).notNull(),
  unitsSnapshot: numeric("units_snapshot", { precision: 15, scale: 2 }).notNull(),
  squareMetersPerUnit: numeric("square_meters_per_unit", { precision: 12, scale: 2 }).notNull(),
  paymentAmountNaira: numeric("payment_amount_naira", { precision: 20, scale: 2 }).notNull(),
  paymentCurrency: text("payment_currency").notNull(),
  deedTemplateId: integer("deed_template_id"),
  transferTemplateId: integer("transfer_template_id"),
  dataSnapshot: jsonb("data_snapshot").notNull(),
  status: text("status").notNull().default("queued"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  documentsReadyAt: timestamp("documents_ready_at", { withTimezone: true }),
  investorSignedAt: timestamp("investor_signed_at", { withTimezone: true }),
}, (table) => [
  index("legal_document_pairs_user_idx").on(table.userId, table.createdAt),
  index("legal_document_pairs_property_idx").on(table.propertyId, table.createdAt),
]);

export const legalDocuments = pgTable("legal_documents", {
  id: serial("id").primaryKey(),
  pairId: integer("pair_id").notNull(),
  documentType: text("document_type").notNull(),
  templateId: integer("template_id").notNull(),
  status: text("status").notNull().default("generated"),
  sourceDocxKey: text("source_docx_key"),
  unsignedPdfKey: text("unsigned_pdf_key"),
  unsignedPdfSha256: text("unsigned_pdf_sha256"),
  considerationAmountNaira: numeric("consideration_amount_naira", { precision: 20, scale: 2 }),
  supersedesDocumentId: integer("supersedes_document_id"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  signaturePlacement: jsonb("signature_placement"),
  signingProvider: text("signing_provider"),
  signingEnvelopeId: text("signing_envelope_id"),
  signedPdfKey: text("signed_pdf_key"),
  signedPdfSha256: text("signed_pdf_sha256"),
  signingCertificateKey: text("signing_certificate_key"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  sentForSignatureAt: timestamp("sent_for_signature_at", { withTimezone: true }),
  investorSignedAt: timestamp("investor_signed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("legal_documents_current_pair_type_uq").on(table.pairId, table.documentType).where(sql`${table.supersededAt} IS NULL`),
  index("legal_documents_envelope_idx").on(table.signingProvider, table.signingEnvelopeId),
]);

export const legalJobs = pgTable("legal_jobs", {
  id: serial("id").primaryKey(),
  pairId: integer("pair_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: text("lease_token"),
  leasedUntil: timestamp("leased_until", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("legal_jobs_pair_kind_uq").on(table.pairId, table.kind),
  index("legal_jobs_claim_idx").on(table.status, table.availableAt),
]);

export const legalAuditEvents = pgTable("legal_audit_events", {
  id: serial("id").primaryKey(),
  pairId: integer("pair_id"),
  reservationId: integer("reservation_id"),
  actorType: text("actor_type").notNull(),
  actorId: integer("actor_id"),
  eventType: text("event_type").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("legal_audit_events_pair_idx").on(table.pairId, table.createdAt),
  index("legal_audit_events_reservation_idx").on(table.reservationId, table.createdAt),
]);