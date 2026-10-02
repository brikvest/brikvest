import type { LegalActionFailure } from "../../../../shared/legal-errors";
import { LEGAL_SUPPORTED_TOKENS } from "../../../../shared/legal-errors";

export type LegalActionResult = {
  property: string;
  documentType?: string;
  filename?: string;
  templateVersion?: string;
  stage: string;
  summary: string;
  issues: LegalActionFailure["issues"];
  instructions: string[];
  nextAction: string;
  supportReference?: string;
  kind: "correction" | "session" | "network" | "server" | "other";
};

const looksUnsafe = (value: string) =>
  /(?:\bselect\b.{0,30}\bfrom\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|\bsqlstate\b|cannot cast type record|invalid input syntax|query failed|\bstack\b|traceback|node_modules|\/(?:home|tmp|var|app|workspace)\/|\\(?:users|home)\\|\.tsx?:\d+:\d+)/i.test(value);

const looksLikeServerFailure = (value: string) =>
  /(?:\bsql(?:state)?\b|database|cannot cast type record|record.{0,20}cast|invalid input syntax|\bconstraint\b|\brelation\b|\bcolumn\b|query failed|\bstack\b|exception|traceback|\bpostgres\b|\bdrizzle\b|\benoent\b|permission denied|storage service|bucket)/i.test(value);

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim() || looksUnsafe(value)) return fallback;
  return value.trim();
}

function failureFrom(body: any): LegalActionFailure | undefined {
  const failure = body?.failure;
  if (!failure || typeof failure !== "object" || typeof failure.summary !== "string" || typeof failure.stage !== "string") return;
  const stages: LegalActionFailure["stage"][] = ["upload", "validation", "save", "inspection", "storage", "render", "conversion", "placement", "preview", "activation", "deletion"];
  const reportedIssues = Array.isArray(failure.correctionIssues) ? failure.correctionIssues
    : Array.isArray(body?.correctionIssues) ? body.correctionIssues
      : Array.isArray(failure.issues) ? failure.issues : [];
  return {
    code: safeText(failure.code, "LEGAL_ACTION_FAILED"),
    stage: stages.includes(failure.stage) ? failure.stage : "inspection",
    summary: safeText(failure.summary, "The legal document action could not be completed."),
    issues: reportedIssues.map((issue: any) => ({
      code: safeText(typeof issue === "string" ? "document_issue" : issue?.code, "document_issue"),
      message: safeText(typeof issue === "string" ? issue : issue?.message, "A document correction is required."),
      instruction: safeText(typeof issue === "string" ? undefined : issue?.instruction, "Review this issue in the Word document and upload a corrected version."),
      ...(typeof issue?.token === "string" ? { token: safeText(issue.token, "") } : {}),
      ...(typeof issue?.location === "string" ? { location: safeText(issue.location, "") } : {}),
      ...(typeof issue?.excerpt === "string" ? { excerpt: safeText(issue.excerpt, "") } : {}),
    })),
    nextAction: safeText(failure.nextAction, "Review the document and try again."),
    ...(typeof failure.supportReference === "string" ? { supportReference: safeText(failure.supportReference, "") } : {}),
  };
}

function legacyValidationIssues(message: string): LegalActionFailure["issues"] {
  const tokens = message.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) || [];
  const unique = Array.from(new Set(tokens));
  const supported = new Set<string>(LEGAL_SUPPORTED_TOKENS);
  const missingContext = /\bmissing\b|\brequired\b/i.test(message);
  const unsupportedContext = /\bunsupported\b|\bunknown\b|\bunrecognized\b/i.test(message);
  const issues: LegalActionFailure["issues"] = [];
  for (const token of unique) {
    if (supported.has(token) && missingContext) {
      issues.push({
        code: "missing_required_token",
        message: `Required placeholder {{${token}}} is missing.`,
        token,
        instruction: `Add {{${token}}} to the Word document.`,
      });
    } else if (!supported.has(token) && unsupportedContext) {
      issues.push({
        code: "unsupported_token",
        message: `Placeholder {{${token}}} is not supported.`,
        token,
        instruction: `Replace {{${token}}} with a supported placeholder: ${LEGAL_SUPPORTED_TOKENS.map((supportedToken) => `{{${supportedToken}}}`).join(", ")}.`,
      });
    }
  }
  return issues;
}

export class LegalActionError extends Error {
  result: LegalActionResult;
  constructor(result: LegalActionResult) {
    super(result.summary);
    this.name = "LegalActionError";
    this.result = result;
  }
}

export async function readLegalResponse(response: Response, context: {
  property: string;
  documentType?: string;
  filename?: string;
  templateVersion?: string;
  action: string;
  confirm?: "template" | "message";
}): Promise<any> {
  const text = await response.text().catch(() => "");
  let body: any = {};
  let validJson = false;
  try { body = text ? JSON.parse(text) : {}; validJson = !!text; } catch { /* Non-JSON errors are deliberately not displayed. */ }
  if (response.ok) {
    const uploaded = body?.template || body;
    const confirmed = context.confirm === "template" ? (validJson && !!uploaded && (typeof uploaded.id === "number" || (typeof uploaded.id === "string" && !!uploaded.id.trim())))
      : context.confirm === "message" ? (validJson && typeof body?.message === "string" && !!body.message.trim()) : true;
    if (!confirmed) {
      throw new LegalActionError({
        property: context.property, documentType: context.documentType, filename: context.filename,
        templateVersion: context.templateVersion, stage: context.action,
        summary: "The service returned without confirming whether this action completed.",
        issues: [], instructions: [], nextAction: "Refresh this property’s drafts and current template status before retrying, to avoid duplicating an action.",
        kind: "network",
      });
    }
    return body;
  }
  const failure = failureFrom(body);
  const legacyMessage = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : "";
  const legacyIssues = legacyValidationIssues(legacyMessage);
  const serverProblem = response.status >= 500 || looksLikeServerFailure(legacyMessage);
  const kind: LegalActionResult["kind"] = response.status === 401 || response.status === 403
    ? "session" : serverProblem ? "server" : failure?.issues.length || legacyIssues.length ? "correction" : "other";
  const generic = kind === "session" ? "Your administrator session has expired. Sign in again, then return to this property."
    : kind === "server" ? "The service could not complete this action. This is a server problem, not a document correction."
      : legacyIssues.length ? "Template placeholders need correction." : "The legal document action could not be completed.";
  const issues = failure?.issues.length ? failure.issues : legacyIssues;
  throw new LegalActionError({
    property: context.property, documentType: context.documentType, filename: context.filename,
    templateVersion: context.templateVersion, stage: failure?.stage || (legacyIssues.length ? "validation" : context.action),
    summary: failure?.summary || generic, issues,
    instructions: issues.map((issue) => issue.instruction),
    nextAction: failure?.nextAction || (kind === "server" ? "Wait and retry; editing the document will not fix this service problem."
      : kind === "session" ? "Sign in again and retry the action."
        : legacyIssues.length ? `Use supported placeholders: ${LEGAL_SUPPORTED_TOKENS.map((token) => `{{${token}}}`).join(", ")}.` : "Check the selected document and retry."),
    supportReference: failure?.supportReference, kind,
  });
}

export function legalNetworkError(error: unknown, context: {
  property: string; documentType?: string; filename?: string; templateVersion?: string; action: string;
}): LegalActionError {
  if (error instanceof LegalActionError) return error;
  const aborted = error instanceof Error && error.name === "AbortError";
  return new LegalActionError({
    ...context, stage: context.action, summary: aborted
      ? "The request was interrupted before a result was received."
      : "The connection was interrupted; the server may have completed this action.",
    issues: [], instructions: [], nextAction: "Refresh this property’s drafts and current template status before retrying, to avoid duplicating an action.",
    kind: "network",
  });
}

export function LegalActionNotice({ result }: { result: LegalActionResult }) {
  return <section role="alert" aria-live="assertive" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
    <h4 className="font-semibold">Action needs attention · {result.property}{result.documentType ? ` · ${result.documentType.replace(/_/g, " ")}` : ""}{result.filename ? ` · ${result.filename}` : result.templateVersion ? ` · ${result.templateVersion}` : ""}</h4>
    <p className="mt-1"><span className="font-medium">Stage:</span> {result.stage} — {result.summary}</p>
    {result.issues.length > 0 && <><p className="mt-2 font-medium">All reported issues</p><ul className="mt-1 list-disc space-y-1 pl-5">{result.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}{issue.token ? ` (${issue.token})` : ""}{issue.location ? ` · ${issue.location}` : ""}{issue.excerpt ? ` · “${issue.excerpt}”` : ""}<p className="text-red-800">{issue.instruction}</p></li>)}</ul></>}
    {result.instructions.filter((instruction) => !result.issues.some((issue) => issue.instruction === instruction)).map((instruction, index) => <p key={index} className="mt-1">{instruction}</p>)}
    <p className="mt-2"><span className="font-medium">Next:</span> {result.nextAction}</p>
    {result.supportReference && <p className="mt-1"><span className="font-medium">Support reference:</span> {result.supportReference}</p>}
  </section>;
}