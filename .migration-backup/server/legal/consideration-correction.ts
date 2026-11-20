import { sql } from "drizzle-orm";
import { db } from "../db";
import { calculateHoldingCosts } from "../../shared/holding-costs";
import { assertActiveConfirmedHolding } from "./holding-state";

const rows = (result: any): any[] => result.rows || [];

/** Retain all old DOCX/PDF rows and hashes; create new unsigned document IDs.
 * Never impersonates an investor, changes money paid, or releases mail. */
export async function correctUnsignedConsideration(pairId: number, propertyId: number, adminId: number) {
  return db.transaction(async tx => {
    const installed = rows(await tx.execute(sql`SELECT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname='legal_documents_revision_history' AND NOT tgisinternal
    ) AS installed`))[0]?.installed;
    if (!installed) throw new Error("Unsigned consideration revision setup is required before correcting drafts.");
    const legacyUniqueness = rows(await tx.execute(sql`SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid='legal_documents'::regclass
        AND conname='legal_documents_pair_type_uq'
    ) AS present`))[0]?.present;
    if (legacyUniqueness) throw new Error("Publish the revision-aware application and finalize draft revision uniqueness before correcting existing PDFs.");
    const reference = rows(await tx.execute(sql`SELECT reservation_id,user_id,property_id FROM legal_document_pairs
      WHERE id=${pairId} AND property_id=${propertyId}`))[0];
    if (!reference) throw new Error("Legal document pair not found");
    await assertActiveConfirmedHolding(tx, { reservationId: Number(reference.reservation_id),
      userId: Number(reference.user_id), propertyId });
    const pair = rows(await tx.execute(sql`SELECT * FROM legal_document_pairs
      WHERE id=${pairId} AND property_id=${propertyId} FOR UPDATE`))[0];
    const property = rows(await tx.execute(sql`SELECT currency,unit_land_cost AS "unitLandCost",
      unit_agent_fees AS "unitAgentFees",unit_due_diligence_cost AS "unitDueDiligenceCost",
      unit_service_charge AS "unitServiceCharge" FROM properties WHERE id=${propertyId} FOR SHARE`))[0];
    const costs = calculateHoldingCosts({ units: pair.units_snapshot, amount: pair.payment_amount_naira,
      currency: pair.payment_currency, property });
    if (!costs) throw new Error("The recorded property cost breakdown must reconcile exactly with this holding's units and full payment.");
    const documents = rows(await tx.execute(sql`SELECT * FROM legal_documents
      WHERE pair_id=${pairId} AND superseded_at IS NULL ORDER BY id FOR UPDATE`));
    if (documents.length !== 2 || new Set(documents.map(d => d.document_type)).size !== 2)
      throw new Error("Both current legal documents are required for correction.");
    const jobs = rows(await tx.execute(sql`SELECT * FROM legal_jobs WHERE pair_id=${pairId} FOR UPDATE`));
    const cycles = rows(await tx.execute(sql`SELECT status FROM legal_notification_cycles WHERE pair_id=${pairId} FOR UPDATE`));
    const operations = rows(await tx.execute(sql`SELECT id FROM local_legal_signing_operations WHERE pair_id=${pairId}`));
    if (pair.investor_signed_at || operations.length ||
        documents.some(d => d.signed_pdf_key || d.investor_signed_at || d.signing_envelope_id ||
          ["investor_signed", "signing_in_progress"].includes(d.status)) ||
        jobs.some(j => j.status === "leased") || cycles.some(c => ["sent", "sending", "uncertain"].includes(c.status)))
      throw new Error("Signing activity, accepted or uncertain mail, or an active worker prevents unsigned correction. No existing evidence was changed.");
    if (documents.every(d => String(d.consideration_amount_naira) === costs.landAmount))
      return { changed: false, considerationAmountNaira: costs.landAmount };
    await tx.execute(sql`UPDATE legal_document_pairs SET status='queued',documents_ready_at=NULL,last_error=NULL
      WHERE id=${pairId}`);
    await tx.execute(sql`UPDATE legal_documents SET superseded_at=now()
      WHERE pair_id=${pairId} AND superseded_at IS NULL`);
    for (const document of documents) {
      await tx.execute(sql`INSERT INTO legal_documents
        (pair_id,document_type,template_id,consideration_amount_naira,supersedes_document_id)
        VALUES (${pairId},${document.document_type},${document.template_id},${costs.landAmount},${document.id})`);
    }
    await tx.execute(sql`UPDATE legal_jobs SET status='blocked',last_error='Corrected PDFs require fresh administrator review',
      lease_token=NULL,leased_until=NULL,updated_at=now() WHERE pair_id=${pairId} AND kind='notify'`);
    await tx.execute(sql`INSERT INTO legal_jobs(pair_id,kind,status) VALUES (${pairId},'generation','queued')
      ON CONFLICT(pair_id,kind) DO UPDATE SET status='queued',attempts=0,available_at=now(),
        lease_token=NULL,leased_until=NULL,last_error=NULL,updated_at=now()`);
    await tx.execute(sql`INSERT INTO legal_audit_events(pair_id,reservation_id,actor_type,actor_id,event_type,details)
      VALUES (${pairId},${pair.reservation_id},'admin',${adminId},'unsigned_consideration_corrected',
        ${JSON.stringify({ previousDocumentIds: documents.map(d => d.id), costs,
          paymentHistoryUnchanged: true, freshPdfReviewRequired: true })}::jsonb)`);
    return { changed: true, considerationAmountNaira: costs.landAmount };
  });
}