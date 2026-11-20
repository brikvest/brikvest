import { sql } from "drizzle-orm";
import { db } from "../db";

export type LegalTemplateDeletionBlock = "active" | "referenced";

export class LegalTemplateDeletionError extends Error {
  constructor(public readonly reason: LegalTemplateDeletionBlock) {
    super(reason === "active"
      ? "The active template version cannot be deleted."
      : "This template version is pinned to a legal document record and cannot be deleted.");
  }
}

function rows<T>(result: unknown): T[] {
  const resultRows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(resultRows) ? resultRows : [];
}

function deletionGuardFailure(error: unknown): LegalTemplateDeletionBlock | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const entry = current as { message?: unknown; cause?: unknown };
    const message = typeof entry.message === "string" ? entry.message.toLowerCase() : "";
    if (
      message.includes("referenced legal template versions cannot be deleted") ||
      message.includes("cannot be newly pinned") ||
      message.includes("cannot be newly referenced")
    ) return "referenced";
    if (
      message.includes("deletion metadata is write-once") ||
      message.includes("cannot be activated")
    ) return "active";
    current = entry.cause;
  }
  return undefined;
}

/**
 * Logical deletion retains source bytes, content provenance and all historical
 * references. The template-type advisory lock is shared with activation, while
 * the row lock is coordinated with database pinning triggers.
 */
export async function deleteLegalTemplateVersion(input: {
  templateId: number;
  propertyId: number;
  adminId: number;
}): Promise<{ deleted: boolean }> {
  try {
    return await db.transaction(async (tx) => {
    const reference = rows<{
      propertyId: number;
      documentType: string;
    }>(await tx.execute(sql`
      SELECT property_id AS "propertyId", document_type AS "documentType"
      FROM legal_templates
      WHERE id = ${input.templateId} AND property_id = ${input.propertyId}
    `))[0];
    if (!reference) return { deleted: false };

    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${
        "legal-template:" + reference.propertyId + ":" + reference.documentType
      }))
    `);
    const template = rows<{
      id: number;
      propertyId: number;
      documentType: string;
      version: number;
      active: boolean;
      deletedAt: Date | string | null;
    }>(await tx.execute(sql`
      SELECT id, property_id AS "propertyId", document_type AS "documentType",
        version, is_active AS active, deleted_at AS "deletedAt"
      FROM legal_templates
      WHERE id = ${input.templateId} AND property_id = ${input.propertyId}
      FOR UPDATE
    `))[0];
    if (!template) return { deleted: false };
    if (template.deletedAt) return { deleted: true };
    if (template.active) throw new LegalTemplateDeletionError("active");

    const referenced = rows<{ referenced: boolean }>(await tx.execute(sql`
      SELECT (
        EXISTS (
          SELECT 1 FROM legal_document_pairs
          WHERE deed_template_id = ${input.templateId}
             OR transfer_template_id = ${input.templateId}
        )
        OR EXISTS (
          SELECT 1 FROM legal_documents WHERE template_id = ${input.templateId}
        )
      ) AS referenced
    `))[0]?.referenced;
    if (referenced) throw new LegalTemplateDeletionError("referenced");

    const deleted = rows<{ id: number }>(await tx.execute(sql`
      UPDATE legal_templates
      SET deleted_at = now(), deleted_by_admin_id = ${input.adminId}
      WHERE id = ${input.templateId} AND property_id = ${input.propertyId}
        AND deleted_at IS NULL AND NOT is_active
      RETURNING id
    `))[0];
    if (!deleted) {
      // The database trigger is authoritative for races and may report a
      // reference inserted after the application-level preflight.
      const reason = rows<{ reason: LegalTemplateDeletionBlock }>(await tx.execute(sql`
        SELECT CASE WHEN is_active THEN 'active' ELSE 'referenced' END AS reason
        FROM legal_templates
        WHERE id = ${input.templateId} AND property_id = ${input.propertyId}
      `))[0]?.reason;
      if (reason) throw new LegalTemplateDeletionError(reason);
      return { deleted: false };
    }

    await tx.execute(sql`
      INSERT INTO legal_audit_events (actor_type, actor_id, event_type, details)
      VALUES ('admin', ${input.adminId}, 'template_version_logically_deleted',
        ${JSON.stringify({
          templateId: template.id,
          propertyId: template.propertyId,
          documentType: template.documentType,
          version: template.version,
          retained: true,
        })}::jsonb)
    `);
    return { deleted: true };
    });
  } catch (error) {
    const blocked = deletionGuardFailure(error);
    if (blocked) throw new LegalTemplateDeletionError(blocked);
    throw error;
  }
}