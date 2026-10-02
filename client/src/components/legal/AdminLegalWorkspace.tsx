import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Building2, CheckCircle, Download, Eye, FileText, RefreshCw, Send, ShieldCheck, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { LEGAL_REQUIRED_TOKENS, LEGAL_SUPPORTED_TOKENS, type LegalCorrectionIssue } from "../../../../shared/legal-errors";
import { LegalActionError, LegalActionNotice, legalNetworkError, readLegalResponse, type LegalActionResult } from "./legalActionErrors";
import { HistoricalLegalHoldings } from "./HistoricalLegalHoldings";

type Request = (url: string, options?: any) => Promise<any>;
type Property = { id: number; name: string; location?: string };
type Template = { id: number; propertyId?: number | null; documentType: string; version: number; active: boolean; validationStatus: string; createdAt: string; deletionBlockedReason?: "active" | "referenced" | null };
type LegalDocument = { id: number; type: string; status: string; hasUnsignedPdf: boolean; hasSignedPdf: boolean; hasCertificate: boolean };
type Pair = {
  id: number; propertyId?: number; reservationId?: number; userName?: string; userEmail?: string;
  status?: string; approvalSource?: string; approvalSourceId?: string | number; approvedAt?: string;
  deedTemplateId?: number; transferTemplateId?: number; deedTemplateVersion?: number; transferTemplateVersion?: number;
  reconciliationStatus?: string; reconciliationState?: string; signingStatus?: string; documents?: LegalDocument[]; error?: string | null;
};
type Fields = {
  fields: { token: string; label: string; meaning: string; source: string; format: string; count: number }[];
  issues?: unknown[];
  correctionIssues?: LegalCorrectionIssue[];
  metadata?: { correctionIssues?: LegalCorrectionIssue[] };
};
const types = ["deed_of_assignment", "transfer_exit_rights"] as const;
const name = (type: string) => type === "deed_of_assignment" ? "Deed of Assignment" : type === "transfer_exit_rights" ? "Transfer and Exit Rights Agreement" : type.replace(/_/g, " ");
const human = (status?: string) => (status || "Not generated").replace(/_/g, " ");
const statusStyle = (status?: string) => ["failed", "blocked"].includes(status || "") ? "bg-red-100 text-red-800" : status === "investor_signed" ? "bg-blue-100 text-blue-800" : ["queued", "generating", "awaiting_templates", "awaiting_signature", "signing_in_progress"].includes(status || "") ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700";
const issueText = (issue: unknown): string => typeof issue === "string" ? issue : typeof issue === "object" && issue !== null && "message" in issue ? String(issue.message) : JSON.stringify(issue);

function LoadingRows() {
  return <div role="status" aria-label="Loading legal records" className="space-y-3"><div className="h-16 rounded-md bg-slate-100 animate-pulse" /><div className="h-16 rounded-md bg-slate-100 animate-pulse" /><span className="sr-only">Loading…</span></div>;
}
function QueryError({ retry, children }: { retry: () => void; children: ReactNode }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{children}</span><Button size="sm" variant="outline" onClick={retry}>Try again</Button></div>;
}

// Keyed property children isolate every form, query, dialog and action result.
// The mount guard also suppresses stale toasts, downloads and object URLs.
function useMountedGuard() {
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}

async function blobRequest(url: string, signal: AbortSignal, context: { property: string; documentType?: string; filename?: string; templateVersion?: string; action: string }): Promise<string> {
  const session = localStorage.getItem("admin_session_id");
  if (!session) throw new LegalActionError({ ...context, stage: "session", summary: "Your administrator session has expired. Sign in again, then return to this property.", issues: [], instructions: [], nextAction: "Sign in again and retry the action.", kind: "session" });
  try {
    const response = await fetch(url, { credentials: "include", headers: { Authorization: `Bearer ${session}` }, signal });
    if (!response.ok) await readLegalResponse(response, context);
    return URL.createObjectURL(await response.blob());
  } catch (error) {
    throw legalNetworkError(error, context);
  }
}

function TemplateFields({ template, propertyId, propertyName, unassigned = false }: { template: Template; propertyId: number; propertyName: string; unassigned?: boolean }) {
  const [fieldError, setFieldError] = useState<LegalActionResult | null>(null);
  const query = useQuery<Fields>({
    queryKey: ["/api/admin/legal/templates", template.id, "fields", unassigned ? "unassigned" : propertyId],
    queryFn: async () => {
      const path = `/api/admin/legal/templates/${template.id}/fields?${unassigned ? "unassigned=true" : `propertyId=${propertyId}`}`;
      const session = localStorage.getItem("admin_session_id");
      if (!session) {
        const error = new LegalActionError({ property: propertyName, documentType: template.documentType, templateVersion: `v${template.version}`, stage: "session", summary: "Your administrator session has expired. Sign in again, then return to this property.", issues: [], instructions: [], nextAction: "Sign in again and retry the action.", kind: "session" });
        setFieldError(error.result);
        throw error;
      }
      try {
        const response = await fetch(path, { credentials: "include", headers: { Authorization: `Bearer ${session}` } });
        const data = await readLegalResponse(response, { property: propertyName, documentType: template.documentType, templateVersion: `v${template.version}`, action: "inspection" });
        setFieldError(null);
        return data;
      } catch (error) {
        if (error instanceof LegalActionError) { setFieldError(error.result); throw error; }
        const wrapped = legalNetworkError(error, { property: propertyName, documentType: template.documentType, templateVersion: `v${template.version}`, action: "inspection" });
        setFieldError(wrapped.result);
        throw wrapped;
      }
    },
  });
  const fieldIssues = query.data?.metadata?.correctionIssues?.length ? query.data.metadata.correctionIssues
    : query.data?.correctionIssues?.length ? query.data.correctionIssues : query.data?.issues || [];
  return <div className="rounded-lg border border-slate-200 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3">
      <h3 className="text-sm font-semibold text-slate-900">{name(template.documentType)} · v{template.version}</h3>
      <Badge variant="outline" className={template.active && !unassigned ? "border-blue-200 text-blue-800 bg-blue-50" : "text-slate-600"}>{unassigned ? "Unassigned · read only" : template.active ? "Live template" : "Draft · not live"}</Badge>
    </div>
    <div className="p-4">
      {query.isLoading ? <LoadingRows /> : query.isError ? <>{fieldError ? <LegalActionNotice result={fieldError} /> : <QueryError retry={() => void query.refetch()}>Could not extract fields for this version.</QueryError>}<Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>Retry field inspection</Button></> : query.data ? <>
        {!!fieldIssues.length && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Template issues</p><ul className="mt-1 list-disc pl-5">{fieldIssues.map((issue: any, index) => <li key={index}>{issueText(issue)}{typeof issue === "object" && issue !== null && "instruction" in issue && <p className="text-amber-800">{String(issue.instruction)}</p>}</li>)}</ul></div>}
        {query.data.fields.length === 0 ? <p className="text-sm text-slate-600">No placeholders were found in this Word version.</p> : <div className="divide-y divide-slate-200">
          {query.data.fields.map((field) => <div key={field.token} className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <div><code className="break-all text-xs text-blue-800">{field.token.startsWith("{{") ? field.token : `{{${field.token}}}`}</code><p className="mt-1 text-sm font-medium text-slate-900">{field.label}</p><span className="text-xs text-slate-500">{field.count} {field.count === 1 ? "occurrence" : "occurrences"}</span></div>
            <div className="space-y-1 text-sm text-slate-600"><p>{field.meaning}</p><p><span className="font-medium text-slate-700">Source:</span> {field.source}</p><p><span className="font-medium text-slate-700">Format:</span> {field.format}</p></div>
          </div>)}
        </div>}
      </> : null}
    </div>
  </div>;
}

export function AdminLegalWorkspace({ authenticatedRequest, properties }: { authenticatedRequest: Request; properties: Property[] }) {
  const [selectedId, setSelectedId] = useState("");
  const property = properties.find((item) => String(item.id) === selectedId);
  const readiness = useQuery<any>({
    queryKey: ["/api/admin/legal/readiness"],
    queryFn: () => authenticatedRequest("/api/admin/legal/readiness"),
  });
  // Infrastructure only: missing property templates belong in the Templates section.
  const blockers: unknown[] = Array.isArray(readiness.data?.checks)
    ? readiness.data.checks.filter((check: { id: string; ready: boolean }) => !check.ready && !["property-binding", "property-area-mapping", "active-templates"].includes(check.id)).map((check: { detail: string }) => check.detail)
    : (Array.isArray(readiness.data?.blockers) ? readiness.data.blockers : []);
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-bold text-slate-900">Legal documents</h1><p className="mt-1 text-sm text-slate-600">Manage each property’s templates and investor signing records without changing retained evidence.</p></header>
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center">
        <div className="flex gap-3"><Building2 className="mt-0.5 h-5 w-5 text-blue-700" /><div><Label htmlFor="legal-property">Property workspace</Label><p className="mt-1 text-xs text-slate-500">Uploads, live templates and holdings stay with this property.</p></div></div>
        <Select value={selectedId} onValueChange={setSelectedId}><SelectTrigger id="legal-property" aria-label="Choose property"><SelectValue placeholder="Select a property" /></SelectTrigger><SelectContent>{properties.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}{item.location ? ` · ${item.location}` : ""}</SelectItem>)}</SelectContent></Select>
      </div>
    </div>
    <details className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-slate-700">Infrastructure readiness <span className="ml-2 font-normal text-xs text-slate-500">{readiness.isLoading ? "Checking services…" : readiness.isError ? "Check unavailable" : blockers.length ? "Service attention required" : "Service details"}</span></summary>
      <div className="mt-3 space-y-2 text-slate-600">{readiness.isError ? <QueryError retry={() => void readiness.refetch()}>Could not check infrastructure.</QueryError> : readiness.isLoading ? <LoadingRows /> : <><p>Global document processing, storage and email infrastructure. Property template availability is shown below.</p>{blockers.length ? blockers.map((blocker, index) => <p key={index} className="flex items-start gap-2 text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{issueText(blocker)}</p>) : <p className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-emerald-700" />No infrastructure blockers reported.</p>}</>}</div>
    </details>
    {property ? <PropertyWorkspace key={property.id} property={property} authenticatedRequest={authenticatedRequest} /> : <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center"><FileText className="mx-auto mb-3 h-8 w-8 text-blue-700" /><h2 className="font-semibold text-slate-900">{properties.length ? "Choose a property to begin" : "No properties available"}</h2><p className="mt-2 text-sm text-slate-600">{properties.length ? "Its Templates, Template fields and Investor documents will appear here." : "Create a property before setting up its legal templates."}</p></div>}
  </div>;
}

function PropertyWorkspace({ property, authenticatedRequest }: { property: Property; authenticatedRequest: Request }) {
  const propertyId = property.id;
  const { toast } = useToast();
  const client = useQueryClient();
  const mounted = useMountedGuard();
  const [busy, setBusy] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState<string>(types[0]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<LegalActionResult | null>(null);
  const [templateResults, setTemplateResults] = useState<Record<string, LegalActionResult>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const [draftId, setDraftId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [audit, setAudit] = useState<{ title: string; events: unknown } | null>(null);
  const [activation, setActivation] = useState<Template | null>(null);
  const [assignment, setAssignment] = useState<Template | null>(null);
  const [deletion, setDeletion] = useState<Template | null>(null);
  const [dispatchConfirm, setDispatchConfirm] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyFieldsId, setLegacyFieldsId] = useState<string>("");
  const controllers = useRef(new Set<AbortController>());
  const urls = useRef(new Set<string>());
  const scoped = (path: string) => `${path}${path.includes("?") ? "&" : "?"}propertyId=${propertyId}`;
  const templatesQuery = useQuery<Template[]>({ queryKey: ["/api/admin/legal/templates", propertyId], queryFn: () => authenticatedRequest(scoped("/api/admin/legal/templates")) });
  const pairsQuery = useQuery<Pair[]>({ queryKey: ["/api/admin/legal/documents", propertyId], queryFn: () => authenticatedRequest(scoped("/api/admin/legal/documents")), refetchInterval: (query) => query.state.data?.some((pair) => ["queued", "generating"].includes(pair.status || "") || pair.documents?.some((doc) => doc.status === "signing_in_progress")) ? 5000 : false });
  const failuresQuery = useQuery<any[]>({ queryKey: ["/api/admin/legal/failures", propertyId], queryFn: () => authenticatedRequest(scoped("/api/admin/legal/failures")), refetchInterval: 30000 });
  const legacyQuery = useQuery<Template[]>({ queryKey: ["/api/admin/legal/templates", "unassigned"], queryFn: () => authenticatedRequest("/api/admin/legal/templates?unassigned=true"), enabled: showLegacy });
  const templates = (templatesQuery.data || []).filter((template) => template.propertyId === undefined || Number(template.propertyId) === propertyId);
  const pairs = (pairsQuery.data || []).filter((pair) => pair.propertyId == null || Number(pair.propertyId) === propertyId);
  const draft = templates.find((template) => String(template.id) === draftId && !template.active);
  const legacyFields = legacyQuery.data?.find((template) => String(template.id) === legacyFieldsId);
  const activeTemplates = templates.filter((template) => template.active);
  const filteredPairs = useMemo(() => pairs.filter((pair) => (status === "all" || pair.status === status) && (!search.trim() || [pair.userName, pair.userEmail, pair.reservationId, pair.id].some((value) => String(value ?? "").toLowerCase().includes(search.trim().toLowerCase())))), [pairs, search, status]);
  const pairStatuses = Array.from(new Set(["awaiting_templates", "queued", "generating", "blocked", "failed", "documents_ready", "awaiting_signature", "investor_signed", ...pairs.map((pair) => pair.status).filter((value): value is string => !!value)]));

  useEffect(() => {
    const requests = controllers.current;
    const objectUrls = urls.current;
    return () => { requests.forEach((controller) => controller.abort()); objectUrls.forEach((url) => URL.revokeObjectURL(url)); objectUrls.clear(); };
  }, []);
  useEffect(() => () => { if (preview) { URL.revokeObjectURL(preview.url); urls.current.delete(preview.url); } }, [preview]);

  const refresh = () => {
    if (!mounted.current) return;
    ["/api/admin/legal/templates", "/api/admin/legal/documents", "/api/admin/legal/failures"].forEach((key) => void client.invalidateQueries({ queryKey: [key, propertyId] }));
    void client.invalidateQueries({ queryKey: ["/api/admin/legal/readiness"] });
  };
  const action = async (key: string, work: () => Promise<void>, onError?: (error: unknown) => void) => {
    if (busy) return;
    setBusy(key);
    try { await work(); } catch (error: any) {
      if (mounted.current && error.name !== "AbortError") {
        onError?.(error);
        if (!onError || !(error instanceof LegalActionError)) toast({ title: "Legal action unavailable", description: `${property.name}: ${error instanceof LegalActionError ? error.result.summary : "The action could not be completed."}`, variant: "destructive" });
      }
    } finally { if (mounted.current) setBusy(null); }
  };
  const openFile = async (path: string, title: string, filename?: string, unassigned = false, template?: Template) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const url = await blobRequest(unassigned ? `${path}${path.includes("?") ? "&" : "?"}unassigned=true` : scoped(path), controller.signal, { property: property.name, documentType: template?.documentType, filename, templateVersion: template ? `v${template.version}` : undefined, action: filename ? "download" : "preview" });
      if (!mounted.current) { URL.revokeObjectURL(url); return; }
      if (template) {
        const operation = filename ? "download" : "preview";
        setTemplateResults((previous) => { const next = { ...previous }; delete next[`${template.id}:${operation}`]; return next; });
      }
      urls.current.add(url);
      if (filename) {
        const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
        window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000);
      } else setPreview({ url, title: `${property.name} · ${title}` });
    } finally { controllers.current.delete(controller); }
  };
  const upload = () => action("upload", async () => {
    if (!file || !file.name.toLowerCase().endsWith(".docx")) {
      setUploadResult({ property: property.name, documentType, filename: file?.name, stage: "upload", summary: "Choose a Microsoft Word .docx template.", issues: [], instructions: [], nextAction: "Select a .docx Word document and retry.", kind: "correction" });
      return;
    }
    const form = new FormData(); form.append("propertyId", String(propertyId)); form.append("documentType", documentType); form.append("file", file);
    // The host JSON helper cannot send multipart bodies. Preserve its administrator
    // authentication here and never set a multipart Content-Type manually.
    const session = localStorage.getItem("admin_session_id");
    if (!session) throw new LegalActionError({ property: property.name, documentType, filename: file.name, stage: "session", summary: "Your administrator session has expired. Sign in again, then return to this property.", issues: [], instructions: [], nextAction: "Sign in again and retry the upload.", kind: "session" });
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      let result: any;
      try {
        const response = await fetch("/api/admin/legal/templates", { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${session}` }, body: form, signal: controller.signal });
        result = await readLegalResponse(response, { property: property.name, documentType, filename: file.name, action: "upload", confirm: "template" });
      } catch (error) {
        throw legalNetworkError(error, { property: property.name, documentType, filename: file.name, action: "upload" });
      }
      if (!mounted.current) return;
      setUploadResult(null);
      setFile(null); if (fileInput.current) fileInput.current.value = "";
      const uploaded = result.template || result;
      if (uploaded.id) setDraftId(String(uploaded.id));
      toast({ title: uploaded.validationStatus === "valid" ? "Template uploaded · not active" : "Template saved for review", description: `${property.name}: ${result.message || "Inspect the fields and preview before activation."}` });
      refresh();
    } finally { controllers.current.delete(controller); }
  }, (error) => setUploadResult(error instanceof LegalActionError ? error.result : legalNetworkError(error, { property: property.name, documentType, filename: file?.name, action: "upload" }).result));
  const pairAction = (pair: Pair, kind: "audit" | "retry" | "resend") => action(`pair-${pair.id}-${kind}`, async () => {
    const result = await authenticatedRequest(scoped(`/api/admin/legal/pairs/${pair.id}/${kind}`), { method: kind === "audit" ? "GET" : "POST", ...(kind === "audit" ? {} : { body: JSON.stringify({ propertyId }) }) });
    if (!mounted.current) return;
    if (kind === "audit") setAudit({ title: `${pair.userName || "Investor"} · Audit trail`, events: result });
    else { toast({ title: kind === "retry" ? "Retry queued" : "Email queued", description: `${property.name} · ${pair.userName || pair.userEmail || `Holding #${pair.reservationId}`}: ${result?.message || (kind === "retry" ? "Processing will continue in the background." : "The worker will send the document notification; delivery is not yet confirmed.")}` }); refresh(); }
  });
  const deleteTemplate = (template: Template) => action(`delete-${template.id}`, async () => {
    const context = { property: property.name, documentType: template.documentType, templateVersion: `v${template.version}`, action: "deletion", confirm: "message" as const };
    const session = localStorage.getItem("admin_session_id");
    if (!session) throw new LegalActionError({ ...context, stage: "session", summary: "Your administrator session has expired.", issues: [], instructions: [], nextAction: "Sign in again and retry deletion.", kind: "session" });
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const response = await fetch(scoped(`/api/admin/legal/templates/${template.id}`), { method: "DELETE", credentials: "include", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ propertyId, confirmed: true }), signal: controller.signal });
      await readLegalResponse(response, context);
      if (!mounted.current) return;
      await client.cancelQueries({ queryKey: ["/api/admin/legal/templates", propertyId], exact: true });
      client.setQueryData<Template[]>(["/api/admin/legal/templates", propertyId], (previous) => previous?.filter((item) => item.id !== template.id));
      client.removeQueries({ queryKey: ["/api/admin/legal/templates", template.id] });
      if (draftId === String(template.id)) setDraftId("");
      setPreview(null);
      setActivation((previous) => previous?.id === template.id ? null : previous);
      setTemplateResults((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(`${template.id}:`))));
      setDeletion(null);
      toast({ title: "Template removed", description: `${property.name} · ${name(template.documentType)} · v${template.version}. Source files and audit history are retained.` });
      refresh();
    } finally { controllers.current.delete(controller); }
  }, (error) => {
    setTemplateResults((previous) => ({ ...previous, [`${template.id}:deletion`]: error instanceof LegalActionError ? error.result : legalNetworkError(error, { property: property.name, documentType: template.documentType, templateVersion: `v${template.version}`, action: "deletion" }).result }));
    refresh();
  });
  const templateControls = (template: Template, unassigned = false) => <div className="flex flex-wrap gap-2">
     <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void action(`preview-${template.id}`, () => openFile(`/api/admin/legal/templates/${template.id}/preview`, `${name(template.documentType)} · v${template.version}`, undefined, unassigned, template), (error) => setTemplateResults((previous) => ({ ...previous, [`${template.id}:preview`]: error instanceof LegalActionError ? error.result : legalNetworkError(error, { property: property.name, documentType: template.documentType, templateVersion: `v${template.version}`, action: "preview" }).result })))}><Eye className="mr-1.5 h-4 w-4" />Preview PDF</Button>
     <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void action(`download-${template.id}`, () => openFile(`/api/admin/legal/templates/${template.id}/download`, name(template.documentType), `${template.documentType}-v${template.version}.docx`, unassigned, template), (error) => setTemplateResults((previous) => ({ ...previous, [`${template.id}:download`]: error instanceof LegalActionError ? error.result : legalNetworkError(error, { property: property.name, documentType: template.documentType, templateVersion: `v${template.version}`, action: "download" }).result })))}><Download className="mr-1.5 h-4 w-4" />Word file</Button>
    <Button size="sm" variant="ghost" onClick={() => {
      if (unassigned) setLegacyFieldsId(String(template.id));
      else {
        if (!template.active) setDraftId(String(template.id));
        window.document.getElementById("legal-template-fields")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }}>Inspect fields</Button>
    {unassigned ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setAssignment(template)}>Assign to {property.name}</Button> : !template.active && <Button size="sm" disabled={!!busy || template.validationStatus !== "valid"} onClick={() => setActivation(template)}>Activate v{template.version}</Button>}
     {!unassigned && <><Button size="sm" variant="outline" disabled={!!busy || template.active || !!template.deletionBlockedReason} aria-describedby={template.active || template.deletionBlockedReason ? `delete-restriction-${template.id}` : undefined} onClick={() => { setTemplateResults((previous) => { const next = { ...previous }; delete next[`${template.id}:deletion`]; return next; }); setDeletion(template); }}>Delete</Button>{(template.active || template.deletionBlockedReason) && <p id={`delete-restriction-${template.id}`} className="w-full text-xs text-slate-600">{template.active || template.deletionBlockedReason === "active" ? "Live versions cannot be deleted. Activate another version first; referenced versions remain protected." : "This version is pinned to an investor document or document pair, including historical records, and cannot be deleted."}</p>}</>}
     {(["preview", "download", "activation"] as const).map((operation) => templateResults[`${template.id}:${operation}`] && <div key={operation} className="w-full basis-full"><LegalActionNotice result={templateResults[`${template.id}:${operation}`]} /></div>)}
     {!deletion && templateResults[`${template.id}:deletion`] && <div className="w-full basis-full"><LegalActionNotice result={templateResults[`${template.id}:deletion`]} /></div>}
   </div>;

  return <div className="space-y-6">
    <Dialog open={!!deletion} onOpenChange={(open) => { if (!open && !busy) setDeletion(null); }}><DialogContent><DialogHeader><DialogTitle>Delete template version?</DialogTitle><DialogDescription>{deletion ? `${property.name} · ${name(deletion.documentType)} · Version ${deletion.version}` : ""}</DialogDescription></DialogHeader><p className="text-sm text-slate-600">This removes the version from this workspace and prevents future use. It does not erase its private source file, provenance or administrator-attributed audit record. Version numbers will not be reused. Live and referenced versions cannot be deleted; existing investor documents are unchanged.</p>{deletion && templateResults[`${deletion.id}:deletion`] && <LegalActionNotice result={templateResults[`${deletion.id}:deletion`]} />}<div className="flex justify-end gap-2"><Button variant="outline" disabled={!!busy} onClick={() => setDeletion(null)}>Cancel</Button><Button variant="destructive" disabled={!!busy} onClick={() => deletion && void deleteTemplate(deletion)}>{busy?.startsWith("delete-") ? "Deleting…" : "Delete version"}</Button></div></DialogContent></Dialog>
    <Card>
      <CardHeader><CardTitle className="text-lg">Templates</CardTitle><CardDescription>Two property-specific Word documents. Upload a version, review it, then activate it for future document generation. Existing investor documents retain their original versions.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {templatesQuery.isLoading ? <LoadingRows /> : templatesQuery.isError ? <QueryError retry={() => void templatesQuery.refetch()}>Could not load templates for {property.name}.</QueryError> : <div className="space-y-3">{types.map((type) => {
          const versions = templates.filter((template) => template.documentType === type).sort((a, b) => b.version - a.version);
          const live = versions.find((template) => template.active);
          const latestDraft = versions.find((template) => !template.active && (!live || template.version > live.version));
          const featured = [live, latestDraft].filter((template): template is Template => !!template);
          const history = versions.filter((template) => !featured.some((item) => item.id === template.id));
          return <div key={type} className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-slate-900">{name(type)}</h3><Badge variant="outline" className={live ? "border-blue-200 bg-blue-50 text-blue-800" : "text-amber-800 border-amber-200 bg-amber-50"}>{live ? "Active" : versions.length ? "Uploaded · not active" : "Missing"}</Badge></div>
            {!versions.length && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600"><p>Upload the {name(type)} prepared specifically for {property.name}.</p><Button size="sm" variant="outline" disabled={!!busy} onClick={() => { if (documentType !== type) setUploadResult(null); setDocumentType(type); fileInput.current?.focus(); }}>Choose upload type</Button></div>}
            {!live && !!versions.length && <p className="mt-2 text-sm text-amber-800">No live version. Review and activate a valid upload to use this document.</p>}
            {featured.map((template) => <div key={template.id} className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-medium text-slate-800">{template.active ? "Live" : "Uploaded · not active"} · Version {template.version}</p><p className="mt-1 text-xs text-slate-500">{human(template.validationStatus)} · {new Date(template.createdAt).toLocaleDateString()}</p>{template.validationStatus !== "valid" && <p className="mt-1 text-xs text-amber-800">Inspect fields for validation issues before uploading a correction.</p>}</div>{templateControls(template)}</div>)}
            {!!history.length && <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-sm text-slate-600">Older versions ({history.length})</summary><div className="mt-3 space-y-3">{history.map((template) => <div key={template.id} className="flex flex-col gap-2 rounded-md bg-slate-50 p-3"><p className="text-sm text-slate-700">Version {template.version} · {human(template.validationStatus)} · {new Date(template.createdAt).toLocaleDateString()}</p>{templateControls(template)}</div>)}</div></details>}
          </div>;
        })}</div>}
        <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Upload to {property.name}</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] md:items-end">
            <div className="space-y-2"><Label htmlFor="legal-template-type">Document type</Label><Select value={documentType} disabled={!!busy} onValueChange={(value) => { if (value !== documentType) setUploadResult(null); setDocumentType(value); }}><SelectTrigger id="legal-template-type"><SelectValue /></SelectTrigger><SelectContent>{types.map((type) => <SelectItem key={type} value={type}>{name(type)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="legal-template-file">New Word version</Label><Input ref={fileInput} id="legal-template-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={!!busy} onChange={(event) => { setUploadResult(null); setFile(event.target.files?.[0] || null); }} /></div>
            <Button onClick={() => void upload()} disabled={!file || !!busy}><Upload className="mr-2 h-4 w-4" />{busy === "upload" ? "Uploading…" : "Upload & validate"}</Button>
          </div><p className="mt-2 text-xs text-slate-500">Uploading does not activate the template or change retained signing evidence.</p>
          <div className="mt-2 space-y-1 text-xs text-slate-600"><p><span className="font-medium">Supported placeholders:</span> {LEGAL_SUPPORTED_TOKENS.map((token) => `{{${token}}}`).join(", ")}.</p><p><span className="font-medium">Required for {name(documentType)}:</span> {LEGAL_REQUIRED_TOKENS[documentType as keyof typeof LEGAL_REQUIRED_TOKENS]?.map((token) => `{{${token}}}`).join(", ")}. A date may use <code>{"{{DOCUMENT_DATE}}"}</code> or all three parts <code>{"{{DOCUMENT_DATE_DAY}}"}</code>, <code>{"{{DOCUMENT_DATE_MONTH}}"}</code> and <code>{"{{DOCUMENT_DATE_YEAR}}"}</code>.</p></div>
          {uploadResult && <LegalActionNotice result={uploadResult} />}
          <p className="mt-2 text-xs text-slate-600">Pre-existing director, witness or other-party signature images are preserved. Review their layout in the PDF and leave a clear area for the investor’s own signature. These images do not sign for the investor, verify authenticity or prove full legal execution.</p>
        </div>
      </CardContent>
    </Card>
    <Card id="legal-template-fields" className="scroll-mt-6">
      <CardHeader><CardTitle className="text-lg">Template fields</CardTitle><CardDescription>Actual placeholders extracted from each Word version. Values are populated automatically from verified KYC, confirmed holdings, approved payment and the effective date—not manually entered here.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {templatesQuery.isLoading ? <LoadingRows /> : templatesQuery.isError ? <QueryError retry={() => void templatesQuery.refetch()}>Template fields are unavailable until templates load.</QueryError> : <>
          {activeTemplates.length ? activeTemplates.map((template) => <TemplateFields key={`${template.id}-live`} template={template} propertyId={propertyId} propertyName={property.name} />) : <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">No live templates yet. Upload a property-specific Word document above to inspect its fields before activation.</p>}
          {types.filter((type) => !activeTemplates.some((template) => template.documentType === type)).map((type) => <p key={type} className="text-xs text-slate-500">{name(type)}: no live field breakdown.</p>)}
          {templates.some((template) => !template.active) && <div className="space-y-2"><Label htmlFor="legal-draft-fields">Inspect an uploaded version · not live</Label><Select value={draftId} onValueChange={setDraftId}><SelectTrigger id="legal-draft-fields"><SelectValue placeholder="Choose a draft or older version" /></SelectTrigger><SelectContent>{templates.filter((template) => !template.active).map((template) => <SelectItem key={template.id} value={String(template.id)}>{name(template.documentType)} · v{template.version}</SelectItem>)}</SelectContent></Select></div>}
          {draft && <TemplateFields key={`${draft.id}-draft`} template={draft} propertyId={propertyId} propertyName={property.name} />}
        </>}
      </CardContent>
    </Card>
     <HistoricalLegalHoldings key={`historical-${propertyId}`} propertyId={propertyId} propertyName={property.name} authenticatedRequest={authenticatedRequest} />
     <Card>
      <CardHeader><CardTitle className="text-lg">Investor documents</CardTitle><CardDescription>Confirmed holdings for {property.name}. Original template pins, signed files and signing audit records remain unchanged. Investor signed does not mean fully legally executed.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]"><Input aria-label="Search investor documents" placeholder="Search investor, email or holding" value={search} onChange={(event) => setSearch(event.target.value)} /><Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Filter document status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{pairStatuses.map((item) => <SelectItem key={item} value={item}>{human(item)}</SelectItem>)}</SelectContent></Select></div>
        {pairsQuery.isLoading ? <LoadingRows /> : pairsQuery.isError ? <QueryError retry={() => void pairsQuery.refetch()}>Could not load this property’s investor documents.</QueryError> : filteredPairs.length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6"><h3 className="text-sm font-medium text-slate-800">{pairs.length ? "No matching holdings" : "No investor documents for this property yet"}</h3><p className="mt-1 text-sm text-slate-600">{pairs.length ? "Try another investor name or status." : "New eligible confirmed purchases will appear here. Uploading templates does not generate documents for historical purchases."}</p>{pairs.length > 0 && <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</Button>}</div> : <div className="space-y-3">{filteredPairs.map((pair) => {
          const retry = ["awaiting_templates", "blocked", "queued", "failed"].includes(pair.status || "") || ["ambiguous", "creating", "reconciling", "sent", "pending"].includes(pair.reconciliationStatus || pair.reconciliationState || pair.signingStatus || "") || pair.documents?.some((doc) => doc.status === "signing_in_progress");
          return <article key={pair.id} className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{pair.userName || pair.userEmail || "Investor"}</h3><p className="mt-1 text-xs text-slate-500">{pair.userEmail} · Holding #{pair.reservationId ?? "—"}</p></div><Badge className={statusStyle(pair.status)}>{human(pair.status)}</Badge></div>
            {pair.error && <p className="mt-3 text-sm text-red-700">{pair.error}</p>}
            {pair.status === "awaiting_templates" && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Waiting for this property’s two valid active templates. Activate the missing templates above, then retry this holding.</p>}
            {pair.status === "investor_signed" && <p className="mt-2 text-xs text-blue-700">Investor signed · external execution handled separately.</p>}
            <div className="mt-3 space-y-2">{pair.documents?.map((doc) => <div key={doc.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{name(doc.type)}</p><Badge className={statusStyle(doc.status)}>{human(doc.status)}</Badge></div>
              <div className="flex flex-wrap gap-1.5">{(["unsigned", "signed", "docx", "certificate"] as const).filter((version) => version === "unsigned" ? doc.hasUnsignedPdf : version === "signed" ? doc.hasSignedPdf : version === "certificate" ? doc.hasCertificate : doc.hasUnsignedPdf || doc.hasSignedPdf).map((version) => {
                const label = version === "unsigned" ? "Review PDF" : version === "signed" ? "Signed PDF" : version === "certificate" ? "Signing audit record" : "DOCX";
                return <div key={version} className="flex flex-wrap gap-1">{(version === "unsigned" || version === "signed") && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void action(`document-${doc.id}-${version}-preview`, () => openFile(`/api/admin/legal/documents/${doc.id}/preview?version=${version}`, `${name(doc.type)} · ${label}`))}><Eye className="mr-1 h-3.5 w-3.5" />{label}</Button>}<Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void action(`document-${doc.id}-${version}-download`, () => openFile(`/api/admin/legal/documents/${doc.id}/download?version=${version}`, label, `${name(doc.type)}-${version}.${version === "docx" ? "docx" : "pdf"}`))}><Download className="mr-1 h-3.5 w-3.5" />{version === "unsigned" ? "Review" : version === "signed" ? "Signed" : label}</Button></div>;
              })}</div>
            </div>)}</div>
            <div className="mt-3 flex flex-wrap gap-2">{retry && <Button size="sm" variant="outline" disabled={!!busy || (pair.status === "awaiting_templates" && types.some((type) => !activeTemplates.some((template) => template.documentType === type)))} onClick={() => void pairAction(pair, "retry")}><RefreshCw className="mr-1.5 h-4 w-4" />{busy === `pair-${pair.id}-retry` ? "Queueing…" : pair.status === "awaiting_templates" ? "Retry after activation" : "Retry / reconcile"}</Button>}{["documents_ready", "investor_signed"].includes(pair.status || "") && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void pairAction(pair, "resend")}><Send className="mr-1.5 h-4 w-4" />{busy === `pair-${pair.id}-resend` ? "Queueing email…" : "Resend email"}</Button>}</div>
            <details className="mt-3 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs text-slate-500">Approval, pinned versions & audit</summary><div className="mt-3 space-y-2 text-xs text-slate-600"><p>Pair #{pair.id} · Approval: {pair.approvalSource || "—"} {pair.approvalSourceId || ""}{pair.approvedAt ? ` · ${new Date(pair.approvedAt).toLocaleString()}` : ""}</p><p>Pinned Deed #{pair.deedTemplateId ?? "—"} {pair.deedTemplateVersion ? `(v${pair.deedTemplateVersion})` : ""} · Transfer #{pair.transferTemplateId ?? "—"} {pair.transferTemplateVersion ? `(v${pair.transferTemplateVersion})` : ""}</p>{(pair.reconciliationStatus || pair.reconciliationState || pair.signingStatus) && <p>Signing reconciliation: {human(pair.reconciliationStatus || pair.reconciliationState || pair.signingStatus)}</p>}<Button size="sm" variant="outline" disabled={!!busy} onClick={() => void pairAction(pair, "audit")}>View audit trail</Button></div></details>
          </article>;
        })}</div>}
        <details className="rounded-md border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">Recorded failures & history {failuresQuery.data ? `(${failuresQuery.data.length})` : ""}</summary><div className="mt-3 space-y-2"><p className="text-xs text-slate-500">Append-only records, including approvals without a document pair. A historical failure is not necessarily unresolved; check the holding’s current status.</p>{failuresQuery.isLoading ? <LoadingRows /> : failuresQuery.isError ? <QueryError retry={() => void failuresQuery.refetch()}>Could not load recorded failures.</QueryError> : !failuresQuery.data?.length ? <p className="text-sm text-slate-600">No recorded failures for this property.</p> : failuresQuery.data.map((failure, index) => <details key={failure.id ?? index} className="rounded border border-slate-200 p-3"><summary className="cursor-pointer text-sm text-slate-700">{human(failure.eventType)}{failure.reservationId ? ` · Holding #${failure.reservationId}` : ""}{failure.createdAt ? ` · ${new Date(failure.createdAt).toLocaleString()}` : ""}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600">{JSON.stringify(failure.details, null, 2)}</pre></details>)}</div></details>
      </CardContent>
    </Card>
    <details className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">Advanced operations</summary><div className="mt-4 space-y-5">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4"><h3 className="text-sm font-semibold text-slate-900">Global legal dispatcher</h3><p className="mt-1 text-sm text-slate-600">Processes all queued legal work across every property, including generation, notifications and signing reconciliation. This is not limited to {property.name} and does not backfill historical purchases.</p><Button className="mt-3" size="sm" variant="outline" disabled={!!busy} onClick={() => setDispatchConfirm(true)}><RefreshCw className="mr-1.5 h-4 w-4" />Process all queued legal work</Button></div>
      <details onToggle={(event) => setShowLegacy(event.currentTarget.open)} className="rounded-md border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-medium text-slate-700">Unassigned legacy templates · explicit destination required</summary><div className="mt-3 space-y-3"><p className="text-sm text-slate-600">Inspect retained versions before assigning their ownership to {property.name}. Assignment does not activate a template, alter existing documents or confirm an area mapping.</p>{legacyQuery.isLoading ? <LoadingRows /> : legacyQuery.isError ? <QueryError retry={() => void legacyQuery.refetch()}>Could not load legacy templates.</QueryError> : !legacyQuery.data?.length ? <p className="text-sm text-slate-500">No unassigned legacy versions.</p> : legacyQuery.data.map((template) => <div key={template.id} className="rounded-md bg-slate-50 p-3"><p className="mb-2 text-sm font-medium text-slate-700">{name(template.documentType)} · v{template.version} · read only</p>{templateControls(template, true)}</div>)}{legacyFields && <TemplateFields key={legacyFields.id} template={legacyFields} propertyId={propertyId} propertyName={property.name} unassigned />}</div></details>
    </div></details>
    <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}><DialogContent className="max-w-5xl h-[90dvh] flex flex-col"><DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>Read-only preview. Templates are review samples; signed investor evidence remains unchanged.</DialogDescription></DialogHeader>{preview && <iframe title={preview.title} src={preview.url} className="min-h-0 w-full flex-1 rounded border bg-slate-100" />}</DialogContent></Dialog>
    <Dialog open={!!audit} onOpenChange={(open) => { if (!open) setAudit(null); }}><DialogContent className="max-w-3xl max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{audit?.title}</DialogTitle><DialogDescription>Append-only approval and signing history for {property.name}.</DialogDescription></DialogHeader><pre className="whitespace-pre-wrap break-words rounded-md bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(audit?.events, null, 2)}</pre></DialogContent></Dialog>
    <Dialog open={!!activation} onOpenChange={(open) => { if (!open && !busy) setActivation(null); }}><DialogContent><DialogHeader><DialogTitle>Activate for {property.name}?</DialogTitle><DialogDescription>{activation ? `${name(activation.documentType)} · Version ${activation.version}. Future generation for this property will use this version. Existing document pairs keep their original template pins.` : ""}</DialogDescription></DialogHeader>
      {activation && templateResults[`${activation.id}:activation`] && <LegalActionNotice result={templateResults[`${activation.id}:activation`]} />}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!!busy} onClick={() => setActivation(null)}>Cancel</Button><Button disabled={!!busy} onClick={() => { if (activation) void action(`activate-${activation.id}`, async () => {
        const current = activation;
        const context = { property: property.name, documentType: current.documentType, templateVersion: `v${current.version}`, action: "activation" };
        const session = localStorage.getItem("admin_session_id");
        if (!session) throw new LegalActionError({ ...context, stage: "session", summary: "Your administrator session has expired. Sign in again, then return to this property.", issues: [], instructions: [], nextAction: "Sign in again and retry activation.", kind: "session" });
        try {
          const response = await fetch(`/api/admin/legal/templates/${current.id}/activate`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: JSON.stringify({ propertyId }) });
          await readLegalResponse(response, { ...context, confirm: "message" });
        } catch (error) { throw legalNetworkError(error, context); }
        if (!mounted.current) return;
        setTemplateResults((previous) => { const next = { ...previous }; delete next[`${current.id}:activation`]; return next; });
        toast({ title: "Template activated", description: `${property.name} · ${name(current.documentType)} v${current.version}` }); setActivation(null); setDraftId(""); refresh();
      }, (error) => setTemplateResults((previous) => ({ ...previous, [`${activation.id}:activation`]: error instanceof LegalActionError ? error.result : legalNetworkError(error, { property: property.name, documentType: activation.documentType, templateVersion: `v${activation.version}`, action: "activation" }).result }))); }}><ShieldCheck className="mr-1.5 h-4 w-4" />{busy ? "Activating…" : "Confirm activation"}</Button></div></DialogContent></Dialog>
    <Dialog open={!!assignment} onOpenChange={(open) => { if (!open && !busy) setAssignment(null); }}><DialogContent><DialogHeader><DialogTitle>Assign legacy template to {property.name}?</DialogTitle><DialogDescription>{assignment ? `${name(assignment.documentType)} · Version ${assignment.version}. Confirm this document was prepared for this exact property. This records ownership only; it does not activate the version or change pinned investor evidence.` : ""}</DialogDescription></DialogHeader><div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Destination: <strong>{property.name}</strong>{property.location ? ` · ${property.location}` : ""}. Do not assign another property’s legal clauses here.</div><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!!busy} onClick={() => setAssignment(null)}>Cancel</Button><Button disabled={!!busy} onClick={() => { if (assignment) void action(`assign-${assignment.id}`, async () => { await authenticatedRequest(`/api/admin/legal/templates/${assignment.id}/assign`, { method: "POST", body: JSON.stringify({ propertyId, confirmed: true }) }); if (!mounted.current) return; toast({ title: "Template destination confirmed", description: `${property.name}: legacy version assigned, not activated.` }); setAssignment(null); setLegacyFieldsId(""); void client.invalidateQueries({ queryKey: ["/api/admin/legal/templates", "unassigned"] }); refresh(); }); }}>{busy ? "Assigning…" : "Confirm this destination"}</Button></div></DialogContent></Dialog>
    <Dialog open={dispatchConfirm} onOpenChange={(open) => { if (!busy) setDispatchConfirm(open); }}><DialogContent><DialogHeader><DialogTitle>Process all queued legal work?</DialogTitle><DialogDescription>This global dispatcher processes queued work across all properties, not only {property.name}. It may generate documents, queue notifications and reconcile signing records.</DialogDescription></DialogHeader><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!!busy} onClick={() => setDispatchConfirm(false)}>Cancel</Button><Button disabled={!!busy} onClick={() => void action("dispatch", async () => { const result = await authenticatedRequest("/api/admin/legal/dispatch", { method: "POST" }); if (!mounted.current) return; toast({ title: "Global legal work dispatched", description: result?.message || "Queued processing across all properties has been dispatched. This does not confirm email delivery." }); setDispatchConfirm(false); ["/api/admin/legal/documents", "/api/admin/legal/failures", "/api/admin/legal/readiness"].forEach((key) => void client.invalidateQueries({ queryKey: [key] })); })}>{busy === "dispatch" ? "Dispatching…" : "Confirm global dispatch"}</Button></div></DialogContent></Dialog>
    {!!busy && <p role="status" aria-live="polite" className="text-xs text-slate-500">Processing action for {property.name}…</p>}
  </div>;
}