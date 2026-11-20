import { sql } from "drizzle-orm";

type Executor = { execute(query: any): Promise<any> };
/** Caller holds the active holding and pair locks. Do not invite an owner to
 * re-sign retained evidence; a partial pair still has an outstanding document. */
export async function hasOutstandingLegalSignature(executor: Executor, pairId: number): Promise<boolean> {
  const result = await executor.execute(sql`SELECT document_type,status,unsigned_pdf_key,unsigned_pdf_sha256,signature_placement
    FROM legal_documents WHERE pair_id=${pairId} AND superseded_at IS NULL ORDER BY id FOR UPDATE`);
  const documents = result.rows || [];
  if (documents.length !== 2 || new Set(documents.map((d: any) => d.document_type)).size !== 2 ||
      !documents.every((d: any) => ["deed_of_assignment", "transfer_exit_rights"].includes(d.document_type) &&
        d.unsigned_pdf_key && /^[a-f0-9]{64}$/i.test(d.unsigned_pdf_sha256 || "") && d.signature_placement)) {
    throw new Error("Both integrity-checked private PDFs must be ready. Use document preparation or recovery, not an email-only shortcut.");
  }
  if (documents.every((d: any) => d.status === "investor_signed")) return false;
  if (!documents.every((d: any) => ["awaiting_signature", "signing_in_progress", "investor_signed"].includes(d.status))) {
    throw new Error("This document pair is not ready for signing invitations.");
  }
  return true;
}