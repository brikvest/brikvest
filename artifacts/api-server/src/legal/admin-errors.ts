import { randomUUID } from "node:crypto";
import type { LegalActionFailure, LegalFailureStage } from "../../shared/legal-errors";
import { LegalTemplateValidationError } from "./templates";

export class AdminLegalInputError extends Error {
  constructor(public code: string, message: string, public nextAction: string, public status = 400) {
    super(message);
  }
}

export function adminLegalFailure(error: unknown, stage: LegalFailureStage): { status: number; failure: LegalActionFailure } {
  if (error instanceof AdminLegalInputError) return {
    status: error.status,
    failure: { code: error.code, stage, summary: error.message, issues: [], nextAction: error.nextAction },
  };
  if (error instanceof LegalTemplateValidationError) return {
    status: 422,
    failure: {
      code: "DOCUMENT_VALIDATION_REJECTED", stage: "validation",
      summary: "The Word template did not pass validation.",
      issues: error.correctionIssues,
      nextAction: stage === "validation"
        ? "Correct each listed issue in Word, save as .docx, then upload the corrected file. No new template was saved or activated."
        : "The saved version failed document validation. Correct each listed issue in Word and upload a new draft; existing records remain unchanged and this operation did not activate a template.",
    },
  };
  const candidate = error as { name?: string; code?: string; message?: string; kind?: string };
  if (candidate?.name === "LegalPdfConversionError" && candidate.kind === "font-metadata") return {
    status: 422,
    failure: {
      code: "FONT_METADATA_REJECTED", stage: "conversion",
      summary: "The Word file's font metadata is corrupt or cannot be safely interpreted.",
      issues: [{ code: "FONT_METADATA", message: "Font declarations are absent, invalid or exceed the safe verification limit.", instruction: "Ask the document author to repair and verify explicit font formatting and embedded font data in Word, then save a new .docx. The authorized Liberation Serif fallback cannot be applied safely until font metadata is valid. Preserve legal wording." }],
      nextAction: "Have the document author work with the technical administrator to correct the font metadata, then upload a corrected draft. The saved draft remains and no live template was changed.",
    },
  };
  if (candidate?.name === "LegalPdfConversionError" && candidate.kind === "recovery-fonts") {
    const reference = `LEGAL-${randomUUID()}`;
    const failure: LegalActionFailure = {
      code: "RECOVERY_FONT_UNAVAILABLE",
      stage: "conversion",
      summary: "The immutable Word document's exact original fonts are unavailable for unchanged recovery conversion.",
      issues: [],
      nextAction: "Ask the technical administrator to restore the exact original font files or valid embedded fonts, then retry recovery. Do not reformat the immutable Word document or apply the new-document fallback; its saved bytes remain unchanged.",
      supportReference: reference,
    };
    console.error("[LEGAL TEMPLATE FAILURE]", {
      reference,
      stage: "conversion",
      code: failure.code,
      errorType: "LegalPdfConversionError",
      category: candidate.kind,
      causes: safeCauseDiagnostics(error),
    });
    return { status: 503, failure };
  }
  // Class names avoid importing converter/files here (and their service dependencies).
  const placement = candidate?.name === "SignaturePositionValidationError" && candidate?.kind === "layout";
  if (placement) return {
    status: 422,
    failure: {
      code: "SIGNATURE_LAYOUT_REJECTED", stage: "placement",
      summary: "The investor’s signature area could not be identified safely.",
      issues: [{
        code: "ASSIGNEE_PLACEMENT",
        message: "The assignee section is missing, ambiguous or separated from the investor name.",
        location: "Assignee signature section",
        instruction: "Review the PDF and Word layout: keep one “SIGNED SEALED AND DELIVERED” assignee block with “By the within-named ASSIGNEE” followed immediately by the complete {{USER_FULL_NAME}}. Witness and assignor sections may remain before or after this block; do not place their labels between its heading and complete name or alongside it at the same height. Avoid duplicate assignee blocks and unsafe page breaks. Existing other-party signature images and required legal wording must remain.",
      }],
      nextAction: "Review the assignee section, upload a corrected draft if needed, then preview and activate separately. The saved draft remains; no live template was changed.",
    },
  };
  const reference = `LEGAL-${randomUUID()}`;
  let code = "LEGAL_SERVER_FAILURE";
  let summary = "The server could not complete this template operation.";
  let nextAction = "Ask the technical administrator to investigate, then retry. Editing the Word document will not fix this server problem.";
  if (/^[0-9A-Z]{5}$/.test(candidate?.code || "") || stage === "save") {
    code = "TEMPLATE_DATABASE_FAILURE";
    summary = stage === "save" ? "Validation passed, but the upload could not be saved in the database." : "The template database operation failed.";
  } else if (stage === "storage") {
    code = "TEMPLATE_STORAGE_FAILURE"; summary = "The private template storage service could not save or retrieve the file.";
  } else if (candidate?.name === "LegalPdfConversionError" || stage === "conversion") {
    code = "PDF_CONVERSION_UNAVAILABLE"; summary = "The PDF conversion service could not complete the preview.";
    nextAction = "Ask the technical administrator to check the converter and required fonts. Do not change legal wording to resolve a service failure. Retry the saved draft after service recovery.";
    if (candidate?.kind === "fonts") {
      code = "FONT_FALLBACK_UNAVAILABLE"; summary = "The authorized Liberation Serif 12 pt fallback could not be applied to the whole document.";
      nextAction = "Ask the technical administrator to make the authorized Liberation Serif 12 pt fallback available and retry. This fallback preserves legal wording but may change pagination; review the final PDF and confirm the investor signature placement before activation. Do not edit legal wording to work around font availability.";
    } else if (candidate?.kind === "font-service") {
      code = "FONT_SERVICE_UNAVAILABLE"; summary = "Font verification infrastructure is unavailable.";
      nextAction = "Ask the technical administrator to restore font verification infrastructure, then retry the saved draft. The authorized whole-document Liberation Serif 12 pt fallback is used only after verification succeeds; do not edit legal wording to work around a service failure.";
    }
  } else if (candidate?.name === "SignaturePositionValidationError") {
    code = "PLACEMENT_CHECK_UNAVAILABLE"; summary = "The signature-position checking service could not complete its check.";
    nextAction = "Ask the technical administrator to check the PDF text extractor, then retry the saved draft. Editing the document will not fix unavailable checking services.";
  }
  // Never log message/stack/cause: they may contain SQL parameters, clauses,
  // storage paths, credentials or process output. Retain bounded diagnostic metadata.
  console.error("[LEGAL TEMPLATE FAILURE]", {
    reference, stage, code,
    errorType: ["Error", "LegalPdfConversionError", "SignaturePositionValidationError", "LegalTemplateRenderError"].includes(candidate?.name || "") ? candidate.name : "InternalError",
    databaseCode: /^[0-9A-Z]{5}$/.test(candidate?.code || "") ? candidate.code : undefined,
    category: ["service", "fonts", "recovery-fonts", "font-metadata", "font-service", "layout"].includes(candidate?.kind || "") ? candidate.kind : undefined,
    causes: safeCauseDiagnostics(error),
  });
  if (stage === "save" || stage === "storage") nextAction += " Refresh the template list before retrying; do not assume the upload was saved.";
  else nextAction += " The saved draft remains available; this failed operation did not activate it or replace a live template.";
  return { status: 503, failure: { code, stage, summary, issues: [], nextAction, supportReference: reference } };
}

function safeCauseDiagnostics(error: unknown) {
  const details: Array<{ type: string; code?: string }> = [];
  let cause = (error as { cause?: unknown })?.cause;
  for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
    const entry = cause as { name?: string; code?: string; cause?: unknown };
    details.push({
      type: ["Error", "TypeError", "LegalFontValidationError"].includes(entry.name || "") ? entry.name! : "InternalError",
      code: /^(?:[0-9A-Z]{5}|ENOENT|EACCES|ETIMEDOUT|ECONNREFUSED|ECONNRESET)$/.test(entry.code || "") ? entry.code : undefined,
    });
    cause = entry.cause;
  }
  return details;
}