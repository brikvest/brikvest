import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { readLegalDocument } from "./files";

type Executor = { execute(query: any): Promise<any> };
const rows = (result: any): any[] => result.rows || [];
export class PdfReviewError extends Error {
  statusCode = 409;
}

export async function reviewSchemaInstalled(executor: Executor): Promise<boolean> {
  return rows(await executor.execute(sql`SELECT to_regclass('public.legal_pdf_review_approvals') IS NOT NULL AS installed`))[0]?.installed === true;
}

export async function reviewedDocuments(executor: Executor, pairId: number) {
  const documents = rows(await executor.execute(sql`
    SELECT d.*,t.version AS template_version FROM legal_documents d
    JOIN legal_templates t ON t.id=d.template_id JOIN legal_document_pairs p ON p.id=d.pair_id
    WHERE d.pair_id=${pairId} AND d.superseded_at IS NULL AND p.documents_ready_at IS NOT NULL
      AND d.template_id=CASE WHEN d.document_type='deed_of_assignment' THEN p.deed_template_id ELSE p.transfer_template_id END
    ORDER BY d.id FOR UPDATE OF d`));
  if (documents.length !== 2 || new Set(documents.map(d => d.document_type)).size !== 2 ||
      !documents.every(d => ["deed_of_assignment", "transfer_exit_rights"].includes(d.document_type) &&
        d.unsigned_pdf_key && /^[a-f0-9]{64}$/.test(d.unsigned_pdf_sha256 || "") && d.signature_placement &&
        ["awaiting_signature", "signing_in_progress", "investor_signed"].includes(d.status))) {
    throw new PdfReviewError("Both validated investor PDFs must be ready before administrator review.");
  }
  return documents;
}

export async function hasExactPdfApproval(executor: Executor, pairId: number): Promise<boolean> {
  if (!await reviewSchemaInstalled(executor)) return false;
  return rows(await executor.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM legal_pdf_review_approvals a
      JOIN legal_documents d ON d.id=a.deed_document_id AND d.pair_id=a.pair_id
      JOIN legal_documents t ON t.id=a.transfer_document_id AND t.pair_id=a.pair_id
      JOIN legal_document_pairs p ON p.id=a.pair_id
      WHERE a.pair_id=${pairId}
        AND d.superseded_at IS NULL AND t.superseded_at IS NULL
        AND p.documents_ready_at IS NOT NULL
        AND d.template_id=p.deed_template_id AND t.template_id=p.transfer_template_id
        AND d.document_type='deed_of_assignment' AND t.document_type='transfer_exit_rights'
        AND d.unsigned_pdf_sha256=a.deed_sha256 AND t.unsigned_pdf_sha256=a.transfer_sha256
        AND d.unsigned_pdf_key IS NOT NULL AND t.unsigned_pdf_key IS NOT NULL
        AND d.signature_placement IS NOT NULL AND t.signature_placement IS NOT NULL
    ) AS approved`))[0]?.approved === true;
}

export async function requireExactPdfApproval(executor: Executor, pairId: number) {
  if (!await hasExactPdfApproval(executor, pairId)) {
    throw new PdfReviewError("Administrator review of both exact investor PDFs is required before sending a signing notification.");
  }
}

/** Caller locks holding then pair. File reads verify immutable stored bytes,
 * not template validation or payment approval. Approval never changes evidence. */
export async function recordPdfApproval(executor: Executor, pairId: number, adminId: number, input: any) {
  if (!await reviewSchemaInstalled(executor)) {
    const error = new PdfReviewError("PDF review database setup is required. Apply the documented additive migration.");
    error.statusCode = 503;
    throw error;
  }
  const documents = await reviewedDocuments(executor, pairId);
  if (input?.confirmed !== true || !Array.isArray(input.documents) || input.documents.length !== 2 ||
      new Set(input.documents.map((d: any) => d?.id)).size !== 2 ||
      !documents.every(d => input.documents.some((r: any) => r.id === d.id && r.sha256 === d.unsigned_pdf_sha256))) {
    throw new PdfReviewError("Review both current PDFs again. The reviewed document identities or hashes are incomplete or stale.");
  }
  for (const document of documents) {
    const bytes = await readLegalDocument(document.unsigned_pdf_key, "unsigned_pdf");
    if (createHash("sha256").update(bytes).digest("hex") !== document.unsigned_pdf_sha256) {
      throw new PdfReviewError("Stored PDF integrity check failed. No notification was authorized.");
    }
  }
  if (await hasExactPdfApproval(executor, pairId)) return false;
  const deed = documents.find(d => d.document_type === "deed_of_assignment")!;
  const transfer = documents.find(d => d.document_type === "transfer_exit_rights")!;
  await executor.execute(sql`INSERT INTO legal_pdf_review_approvals
    (pair_id,approved_by_admin_id,deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
    VALUES (${pairId},${adminId},${deed.id},${deed.unsigned_pdf_sha256},${transfer.id},${transfer.unsigned_pdf_sha256})`);
  await executor.execute(sql`INSERT INTO legal_audit_events(pair_id,actor_type,actor_id,event_type,details)
    VALUES (${pairId},'admin',${adminId},'investor_pdfs_review_approved',
      ${JSON.stringify({ documents: documents.map(d => ({ id: d.id, sha256: d.unsigned_pdf_sha256, templateId: d.template_id })) })}::jsonb)`);
  return true;
}