import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Clock, Download, Eye, FileText, Loader2, RefreshCw, Send, ShieldCheck, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { useSearch } from "wouter";
import { NativeSigningDialog } from "@/components/legal/NativeSigningDialog";

type LegalDocument = {
  id: number;
  type: string;
  status: string;
  hasUnsignedPdf: boolean;
  hasSignedPdf: boolean;
  hasCertificate: boolean;
};

type InvestorHolding = {
  id: number;
  reservationId: number;
  propertyId: number;
  propertyName: string;
  area: number | string | null;
  status: string;
  documents: LegalDocument[];
};

const documentName = (type: string) =>
  type === "deed_of_assignment" ? "Deed of Assignment" :
    type === "transfer_exit_rights" ? "Transfer and Exit Rights Agreement" :
      type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const statusClass = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "failed" || normalized === "blocked") return "bg-red-100 text-red-800";
  if (normalized === "investor_signed") return "bg-blue-100 text-blue-800";
  if (["awaiting_signature", "signing_in_progress", "awaiting_templates", "queued", "generating"].includes(normalized)) return "bg-amber-100 text-amber-800";
  if (normalized === "documents_ready") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-700";
};

async function responseError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    return data.error || data.message || fallback;
  } catch {
    return fallback;
  }
}

function InvestorDocumentActions({ document }: { document: LegalDocument }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [signDialogOpen, setSignDialogOpen] = useState(false);

  useEffect(() => () => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const preview = async (signed: boolean) => {
    try {
      const response = await fetch(`/api/legal/documents/${document.id}/preview?version=${signed ? "signed" : "unsigned"}`, { credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Could not open this document."));
      const url = URL.createObjectURL(await response.blob());
      setPreviewUrl(url);
      setPreviewTitle(`${documentName(document.type)}${signed ? " — Signed copy" : " — Review copy"}`);
    } catch (error: any) {
      toast({ title: "Document unavailable", description: error.message, variant: "destructive" });
    }
  };

  const download = async (version: "unsigned" | "signed" | "docx" | "certificate", extension: "pdf" | "docx") => {
    try {
      const response = await fetch(`/api/legal/documents/${document.id}/download?version=${version}`, { credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Could not download this document."));
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${documentName(document.type)}${version === "unsigned" ? " - review" : version === "signed" ? " - signed" : version === "certificate" ? " - signing audit record" : ""}.${extension}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      toast({ title: "Download failed", description: error.message, variant: "destructive" });
    }
  };

  const signed = document.status.toLowerCase() === "investor_signed";
  const canSign = document.hasUnsignedPdf && !signed && ["awaiting_signature", "signing_in_progress"].includes(document.status.toLowerCase());

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {document.hasUnsignedPdf && (
          <Button size="sm" variant="outline" onClick={() => preview(false)}>
            <Eye className="h-4 w-4 mr-1.5" /> Review PDF
          </Button>
        )}
        {document.hasSignedPdf && (
          <Button size="sm" variant="outline" onClick={() => preview(true)}>
            <Eye className="h-4 w-4 mr-1.5" /> Review signed PDF
          </Button>
        )}
        {document.hasUnsignedPdf && (
          <Button size="sm" variant="ghost" onClick={() => download("unsigned", "pdf")}>
            <Download className="h-4 w-4 mr-1.5" /> Download review PDF
          </Button>
        )}
        {document.hasSignedPdf && (
          <Button size="sm" variant="ghost" onClick={() => download("signed", "pdf")}>
            <Download className="h-4 w-4 mr-1.5" /> Download signed PDF
          </Button>
        )}
        {(document.hasUnsignedPdf || document.hasSignedPdf) && (
          <Button size="sm" variant="ghost" onClick={() => download("docx", "docx")}>
            <Download className="h-4 w-4 mr-1.5" /> Download DOCX
          </Button>
        )}
        {document.hasCertificate && (
          <Button size="sm" variant="ghost" onClick={() => download("certificate", "pdf")}>
            <Download className="h-4 w-4 mr-1.5" /> Download signing audit record
          </Button>
        )}
        {canSign && (
          <Button size="sm" onClick={() => setSignDialogOpen(true)}>
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            Review &amp; sign
          </Button>
        )}
        {signed && <span className="text-xs text-blue-700 self-center">Investor signed — external execution handled separately.</span>}
      </div>
      <NativeSigningDialog
        open={signDialogOpen}
        onOpenChange={setSignDialogOpen}
        documentId={document.id}
        documentName={documentName(document.type)}
        onCompleted={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/legal/holdings"] });
        }}
      />
      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
            <DialogHeader><DialogTitle>{previewTitle}</DialogTitle><DialogDescription>Review the legal document before signing.</DialogDescription></DialogHeader>
          {previewUrl && <iframe title={previewTitle} src={previewUrl} className="w-full flex-1 rounded border bg-slate-100" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InvestorLegalDocuments({ reservationId, focus = false }: { reservationId: number; focus?: boolean }) {
  const search = useSearch();
  const { data: holdings = [], isLoading, error } = useQuery<InvestorHolding[]>({
    queryKey: ["/api/legal/holdings"],
    queryFn: async () => {
      const response = await fetch("/api/legal/holdings", { credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Could not load legal documents."));
      return response.json();
    },
    refetchInterval: (query) =>
      query.state.data?.some((holding) => holding.documents.some((document) => document.status.toLowerCase() === "signing_in_progress"))
        ? 5000
        : false,
  });
  const holding = holdings.find((item) => Number(item.reservationId) === Number(reservationId));
  const requestedHoldingId = Number(new URLSearchParams(search).get("holding"));
  const isFocused = focus || (!!holding && Number(holding.id) === requestedHoldingId);

  useEffect(() => {
    if (!holding || !isFocused) return;
    const timer = window.setTimeout(() => {
      window.document.getElementById(`legal-documents-${holding.reservationId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [holding, isFocused]);

  if (isLoading) return <div className="mt-4 text-sm text-slate-500">Loading legal documents…</div>;
  if (error) return <div className="mt-4 text-sm text-red-700" role="alert">Legal documents are unavailable right now. Please refresh to try again.</div>;
  if (!holding) return <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No legal document pair is available for this holding yet.</div>;

  return (
    <div id={`legal-documents-${holding.reservationId}`} className={`mt-4 rounded-lg border p-4 ${isFocused ? "border-blue-300 bg-blue-50/40 ring-2 ring-blue-100" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h5 className="font-semibold text-slate-900 flex items-center gap-2"><FileText className="h-4 w-4 text-blue-700" /> Legal documents</h5>
          <p className="text-xs text-slate-600 mt-1">{holding.propertyName} · {holding.area ? `${holding.area} m²` : "Area not yet recorded"}</p>
        </div>
        {holding.documents.length === 0 && <Badge variant="outline">Not generated</Badge>}
      </div>
      {holding.documents.length === 0 ? (
        <p className="text-sm text-slate-600">Documents will appear here after your payment and holding are confirmed.</p>
      ) : (
        <div className="space-y-3">
          {holding.documents.map((document) => {
            const signed = document.status.toLowerCase() === "investor_signed";
            return (
              <div key={document.id} className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{documentName(document.type)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge className={statusClass(document.status)}>{document.status.replace(/_/g, " ")}</Badge>
                    {signed && <span className="text-xs text-blue-700 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Investor signed — external execution handled separately.</span>}
                    {!signed && document.status.toLowerCase() === "awaiting_signature" && <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Awaiting your signature</span>}
                    {document.hasCertificate && <span className="text-xs text-slate-500">Signing audit record available</span>}
                  </div>
                </div>
                <InvestorDocumentActions document={document} />
              </div>
            );
          })}
        </div>
      )}
      {holding.status && holding.documents.length === 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><AlertCircle className="h-3.5 w-3.5" />Documents are created after an authorized confirmation.</p>
      )}
    </div>
  );
}

type AdminTemplate = {
  id: number;
  documentType: string;
  version: number;
  active: boolean;
  validationStatus: string;
  createdAt: string;
};

type AdminPair = {
  id: number;
  reservationId?: number;
  propertyId?: number;
  propertyName?: string;
  userName?: string;
  userEmail?: string;
  status?: string;
  approvalSource?: string;
  approvalSourceId?: string | number;
  approvedAt?: string;
  deedTemplateId?: number;
  transferTemplateId?: number;
  deedTemplateVersion?: number;
  transferTemplateVersion?: number;
  signingStatus?: string;
  reconciliationStatus?: string;
  reconciliationState?: string;
  documents?: LegalDocument[];
  error?: string | null;
};

type AdminProperty = { id: number; name: string; location?: string };

async function adminBlob(url: string): Promise<string> {
  const sessionId = localStorage.getItem("admin_session_id");
  if (!sessionId) throw new Error("Your administrator session has expired. Please sign in again.");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${sessionId}` } });
  if (!response.ok) throw new Error(await responseError(response, "Could not open this file."));
  return URL.createObjectURL(await response.blob());
}

export function AdminLegalManagement({ authenticatedRequest, properties }: {
  authenticatedRequest: (url: string, options?: any) => Promise<any>;
  properties: AdminProperty[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = useState("deed_of_assignment");
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [bindingConfirmed, setBindingConfirmed] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [audit, setAudit] = useState<{ title: string; events: any } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const { data: templates = [], isLoading: templatesLoading, error: templatesError } = useQuery<AdminTemplate[]>({
    queryKey: ["/api/admin/legal/templates"],
    queryFn: () => authenticatedRequest("/api/admin/legal/templates"),
  });
  const { data: pairs = [], isLoading: pairsLoading, error: pairsError } = useQuery<AdminPair[]>({
    queryKey: ["/api/admin/legal/documents"],
    queryFn: () => authenticatedRequest("/api/admin/legal/documents"),
  });
  const { data: failures = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/legal/failures"],
    queryFn: () => authenticatedRequest("/api/admin/legal/failures"),
    refetchInterval: 30000,
  });
  const { data: readiness } = useQuery<any>({
    queryKey: ["/api/admin/legal/readiness"],
    queryFn: () => authenticatedRequest("/api/admin/legal/readiness"),
  });
  const { data: bindingDetail, isLoading: bindingLoading, error: bindingError } = useQuery<any>({
    queryKey: ["/api/admin/legal/properties", selectedPropertyId],
    queryFn: () => authenticatedRequest(`/api/admin/legal/properties/${selectedPropertyId}`),
    enabled: !!selectedPropertyId,
    retry: false,
  });

  useEffect(() => () => {
    if (preview?.url.startsWith("blob:")) URL.revokeObjectURL(preview.url);
  }, [preview?.url]);

  const invalidateLegal = () => {
    [
      "/api/admin/legal/templates",
      "/api/admin/legal/documents",
      "/api/admin/legal/failures",
      "/api/admin/legal/readiness",
      "/api/admin/legal/properties",
    ].forEach((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] }));
    queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
  };

  const uploadTemplate = async () => {
    if (!templateFile) {
      toast({ title: "Choose a template", description: "Select a .docx Word document before uploading.", variant: "destructive" });
      return;
    }
    if (!templateFile.name.toLowerCase().endsWith(".docx")) {
      toast({ title: "Unsupported file", description: "Templates must be Microsoft Word .docx files.", variant: "destructive" });
      return;
    }
    setBusyId(-1);
    try {
      const formData = new FormData();
      formData.append("documentType", documentType);
      formData.append("file", templateFile);
      const sessionId = localStorage.getItem("admin_session_id");
      const response = await fetch("/api/admin/legal/templates", {
        method: "POST",
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        body: formData,
      });
      if (!response.ok) throw new Error(await responseError(response, "Template validation failed."));
      const result = await response.json();
      toast({
        title: result.validationStatus === "valid" ? "Template uploaded and validated" : "Template validation failed",
        description: result.message || (result.validationStatus === "valid" ? "The new version is saved. Activate it when ready." : "The document is saved but cannot be activated until corrected."),
        variant: result.validationStatus === "valid" ? undefined : "destructive",
      });
      setTemplateFile(null);
      const input = window.document.getElementById("legal-template-file") as HTMLInputElement | null;
      if (input) input.value = "";
      invalidateLegal();
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const bindProperty = useMutation({
    mutationFn: () => authenticatedRequest("/api/admin/legal/binding", {
      method: "POST",
      body: JSON.stringify({ propertyId: Number(selectedPropertyId), sqmPerUnit: 5, confirmed: true }),
    }),
    onSuccess: () => {
      toast({ title: "Property binding confirmed", description: "Each unit on this property maps to exactly 5 m² for legal document generation." });
      invalidateLegal();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/legal/properties", selectedPropertyId] });
    },
    onError: (error: any) => toast({ title: "Could not bind property", description: error.message, variant: "destructive" }),
  });

  const activateTemplate = async (template: AdminTemplate) => {
    setBusyId(template.id);
    try {
      await authenticatedRequest(`/api/admin/legal/templates/${template.id}/activate`, { method: "POST", body: JSON.stringify({}) });
      toast({ title: "Template activated", description: `Version ${template.version} is now active for ${documentName(template.documentType)}.` });
      invalidateLegal();
    } catch (error: any) {
      toast({ title: "Activation blocked", description: error.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const openTemplate = async (template: AdminTemplate, action: "preview" | "download") => {
    try {
      const url = await adminBlob(`/api/admin/legal/templates/${template.id}/${action}`);
      if (action === "download") {
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = `${template.documentType}-v${template.version}.docx`;
        anchor.click();
        URL.revokeObjectURL(url);
      } else {
        setPreview({ url, title: `${documentName(template.documentType)} · Version ${template.version}` });
      }
    } catch (error: any) {
      toast({ title: "Template unavailable", description: error.message, variant: "destructive" });
    }
  };

  const openDocumentArtifact = async (document: LegalDocument, version: "unsigned" | "signed" | "docx" | "certificate", action: "preview" | "download") => {
    try {
      const url = await adminBlob(`/api/admin/legal/documents/${document.id}/${action}?version=${version}`);
      const extension = version === "docx" ? "docx" : "pdf";
      if (action === "download") {
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = `${documentName(document.type)}${version === "signed" ? " - signed" : version === "certificate" ? " - signing audit record" : version === "unsigned" ? " - review" : ""}.${extension}`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        setPreview({ url, title: `${documentName(document.type)} · ${version === "unsigned" ? "Review PDF" : "Signed PDF"}` });
      }
    } catch (error: any) {
      toast({ title: "Legal document unavailable", description: error.message, variant: "destructive" });
    }
  };

  const runPairAction = async (pair: AdminPair, action: "retry" | "resend" | "audit") => {
    setBusyId(pair.id);
    try {
      const result = await authenticatedRequest(`/api/admin/legal/pairs/${pair.id}/${action}`, {
        method: action === "audit" ? "GET" : "POST",
        ...(action === "audit" ? {} : { body: JSON.stringify({}) }),
      });
      if (action === "audit") setAudit({ title: `Audit trail · Pair ${pair.id}`, events: result });
      else {
        toast({ title: action === "retry" ? "Retry queued" : "Email resent", description: result?.message || undefined });
        invalidateLegal();
      }
    } catch (error: any) {
      toast({ title: `Could not ${action} documents`, description: error.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const filteredPairs = useMemo(() => pairs.filter((pair) => {
    const status = String(pair.status || "").toLowerCase();
    if (statusFilter !== "all" && status !== statusFilter) return false;
    const needle = search.trim().toLowerCase();
    return !needle || [pair.userName, pair.userEmail, pair.propertyName, pair.reservationId, pair.id, pair.approvalSource, pair.approvalSourceId, pair.deedTemplateId, pair.transferTemplateId]
      .some((value) => String(value ?? "").toLowerCase().includes(needle));
  }), [pairs, search, statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Legal documents</h1>
        <p className="mt-1 text-sm text-slate-600">Manage versioned Word templates, property area mappings, and generated signing pairs.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Workflow readiness</CardTitle><CardDescription>Fix readiness blockers before the next confirmed holding needs legal documents.</CardDescription></CardHeader>
        <CardContent>
          {readiness ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{readiness.ready === true ? "Ready to generate documents" : "Review the following readiness checks"}</p>
              {Array.isArray(readiness.blockers) && readiness.blockers.length > 0 ? readiness.blockers.map((blocker: any, index: number) => (
                <p key={index} className="flex items-start gap-2 text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{typeof blocker === "string" ? blocker : blocker.message || JSON.stringify(blocker)}</p>
              )) : <p className="flex items-center gap-2 text-emerald-700"><CheckCircle className="h-4 w-4" />No reported blockers.</p>}
            </div>
          ) : <p className="text-sm text-slate-500">Readiness information is not available yet.</p>}
        </CardContent>
      </Card>

      {failures.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Actionable workflow failures</CardTitle><CardDescription>Approval and worker failures are retained in the append-only audit history, including purchases that could not produce a document pair.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {failures.map((failure) => (
              <div key={failure.id} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium">{failure.eventType?.replace(/_/g, " ")}{failure.reservationId ? ` · Holding #${failure.reservationId}` : ""}</p>
                <pre className="mt-1 whitespace-pre-wrap break-words text-xs">{JSON.stringify(failure.details, null, 2)}</pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Confirm property area mapping</CardTitle><CardDescription>For land holdings, confirm the legal area calculation of 5 m² per unit. The binding is property-specific.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Select value={selectedPropertyId} onValueChange={(value) => {
              setSelectedPropertyId(value);
              setBindingConfirmed(false);
            }}>
              <SelectTrigger aria-label="Choose property"><SelectValue placeholder="Select a property" /></SelectTrigger>
              <SelectContent>{properties.map((property) => <SelectItem key={property.id} value={String(property.id)}>{property.name}{property.location ? ` · ${property.location}` : ""}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={() => bindProperty.mutate()} disabled={!selectedPropertyId || !bindingConfirmed || bindProperty.isPending}>
              {bindProperty.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Confirm 5 m² / unit
            </Button>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <Checkbox checked={bindingConfirmed} onCheckedChange={(checked) => setBindingConfirmed(checked === true)} />
            <span>I confirm this property uses the fixed legal-area rule of <strong>5 m² per unit</strong>; I have checked the property before recording this mapping.</span>
          </label>
          {selectedPropertyId && (
            <div className="rounded-md border bg-slate-50 p-3 text-sm">
              {bindingLoading ? <span>Checking this property’s mapping and eligibility…</span> :
                bindingError ? <span className="text-amber-800">No legal property-binding details are available yet. You can still record the explicit 5 m²-per-unit binding.</span> :
                  <pre className="whitespace-pre-wrap break-words text-xs text-slate-700">{JSON.stringify(bindingDetail, null, 2)}</pre>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Document templates</CardTitle><CardDescription>Each upload creates a version. Validate required fields before activating. Previously generated documents remain pinned to their original version.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-end">
            <div className="space-y-2"><Label htmlFor="legal-template-type">Document type</Label><Select value={documentType} onValueChange={setDocumentType}><SelectTrigger id="legal-template-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deed_of_assignment">Deed of Assignment</SelectItem><SelectItem value="transfer_exit_rights">Transfer and Exit Rights Agreement</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="legal-template-file">New .docx version</Label><Input id="legal-template-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setTemplateFile(event.target.files?.[0] || null)} /></div>
            <Button onClick={uploadTemplate} disabled={busyId === -1 || !templateFile}>{busyId === -1 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload &amp; validate</Button>
          </div>
          {!templatesLoading && !templatesError && templates.length === 0 && (
            <Button variant="outline" onClick={async () => {
              setBusyId(-2);
              try {
                const result = await authenticatedRequest("/api/admin/legal/templates/import-initial", { method: "POST" });
                toast({ title: "Initial templates imported", description: result?.message || "The supplied initial template versions are available for review and activation." });
                invalidateLegal();
              } catch (error: any) {
                toast({ title: "Initial template import failed", description: error.message, variant: "destructive" });
              } finally {
                setBusyId(null);
              }
            }} disabled={busyId === -2}>
              {busyId === -2 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import supplied initial versions
            </Button>
          )}
          {templatesLoading ? <p className="text-sm text-slate-500">Loading template versions…</p> : templatesError ? (
            <p className="text-sm text-red-700" role="alert">Template versions are unavailable. Please refresh to try again.</p>
          ) : (
            <div className="space-y-3">
              {templates.length === 0 ? <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">No legal templates have been uploaded yet.</p> : templates.map((template) => (
                <div key={template.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{documentName(template.documentType)} <span className="text-slate-500">· v{template.version}</span></p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge variant={template.active ? "default" : "outline"}>{template.active ? "Active" : "Previous version"}</Badge>
                      <Badge className={template.validationStatus.toLowerCase() === "valid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{template.validationStatus.replace(/_/g, " ")}</Badge>
                      <span className="self-center text-xs text-slate-500">{new Date(template.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openTemplate(template, "preview")}><Eye className="mr-1.5 h-4 w-4" />Preview PDF</Button>
                    <Button size="sm" variant="ghost" onClick={() => openTemplate(template, "download")}><Download className="mr-1.5 h-4 w-4" />Download</Button>
                    {!template.active && <Button size="sm" onClick={() => activateTemplate(template)} disabled={busyId === template.id || template.validationStatus.toLowerCase() !== "valid"}>{busyId === template.id && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Activate version</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Generated document pairs</CardTitle><CardDescription>Review approval source, pinned template versions, errors, and lifecycle actions for each holding.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <Input aria-label="Search by investor or property" placeholder="Search investor, email, property, or pair ID" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="Filter by pair status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All pair statuses</SelectItem>{["awaiting_templates", "queued", "generating", "blocked", "failed", "documents_ready", "investor_signed"].map((status) => <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
          </div>
          {pairsLoading ? <p className="text-sm text-slate-500">Loading document pairs…</p> : pairsError ? <p className="text-sm text-red-700" role="alert">Document pairs are unavailable. Please refresh to try again.</p> : filteredPairs.length === 0 ? <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">No document pairs match this filter.</p> : (
            <div className="space-y-3">
              {filteredPairs.map((pair) => (
                <div key={pair.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-900">{pair.propertyName || `Property #${pair.propertyId ?? "—"}`} <span className="font-normal text-slate-500">· Pair #{pair.id}</span></p>
                      <p className="text-sm text-slate-700">{pair.userName || "Investor"}{pair.userEmail ? ` · ${pair.userEmail}` : ""}</p>
                      <p className="text-xs text-slate-500">Holding #{pair.reservationId ?? "—"} · Approval: {pair.approvalSource || "—"} {pair.approvalSourceId ? `#${pair.approvalSourceId}` : ""}{pair.approvedAt ? ` · ${new Date(pair.approvedAt).toLocaleString()}` : ""}</p>
                      <p className="text-xs text-slate-500">Pinned template IDs: Deed #{pair.deedTemplateId ?? "—"}{pair.deedTemplateVersion ? ` (v${pair.deedTemplateVersion})` : ""} · Transfer #{pair.transferTemplateId ?? "—"}{pair.transferTemplateVersion ? ` (v${pair.transferTemplateVersion})` : ""}</p>
                      {(pair.reconciliationStatus || pair.reconciliationState || pair.signingStatus) && <p className="text-xs text-amber-700">Signing reconciliation: {(pair.reconciliationStatus || pair.reconciliationState || pair.signingStatus)?.replace(/_/g, " ")}</p>}
                      {pair.error && <p className="mt-2 text-sm text-red-700" role="alert">Generation error: {pair.error}</p>}
                       {pair.status?.toLowerCase() === "awaiting_templates" && <p className="mt-2 text-sm text-amber-800">Activate valid deed and transfer templates first, then retry document generation for this pair.</p>}
                      {!!pair.documents?.length && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documents</p>
                          {pair.documents.map((document) => (
                            <div key={document.id} className="flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex items-center gap-2 text-sm">
                                <span>{documentName(document.type)}</span>
                                <Badge className={statusClass(document.status)}>{document.status.replace(/_/g, " ")}</Badge>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {document.hasUnsignedPdf && <><Button size="sm" variant="outline" onClick={() => openDocumentArtifact(document, "unsigned", "preview")}><Eye className="mr-1 h-3.5 w-3.5" />Review PDF</Button><Button size="sm" variant="ghost" onClick={() => openDocumentArtifact(document, "unsigned", "download")}><Download className="mr-1 h-3.5 w-3.5" />Review</Button></>}
                                {document.hasSignedPdf && <><Button size="sm" variant="outline" onClick={() => openDocumentArtifact(document, "signed", "preview")}><Eye className="mr-1 h-3.5 w-3.5" />Signed PDF</Button><Button size="sm" variant="ghost" onClick={() => openDocumentArtifact(document, "signed", "download")}><Download className="mr-1 h-3.5 w-3.5" />Signed</Button></>}
                                {(document.hasUnsignedPdf || document.hasSignedPdf) && <Button size="sm" variant="ghost" onClick={() => openDocumentArtifact(document, "docx", "download")}><Download className="mr-1 h-3.5 w-3.5" />DOCX</Button>}
                                {document.hasCertificate && <Button size="sm" variant="ghost" onClick={() => openDocumentArtifact(document, "certificate", "download")}><Download className="mr-1 h-3.5 w-3.5" />Signing audit record</Button>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {pair.status && <Badge className={statusClass(pair.status)}>{pair.status.replace(/_/g, " ")}</Badge>}
                      <Button size="sm" variant="outline" onClick={() => runPairAction(pair, "audit")} disabled={busyId === pair.id}><Eye className="mr-1.5 h-4 w-4" />Audit</Button>
                      {(["awaiting_templates", "blocked", "queued", "failed"].includes(pair.status?.toLowerCase() || "") ||
                        ["ambiguous", "creating", "reconciling", "sent", "pending"].includes(String(pair.reconciliationStatus || pair.reconciliationState || pair.signingStatus || "").toLowerCase()) ||
                        pair.documents?.some((document) => document.status.toLowerCase() === "signing_in_progress")) &&
                        <Button size="sm" variant="outline" onClick={() => runPairAction(pair, "retry")} disabled={busyId === pair.id}><RefreshCw className="mr-1.5 h-4 w-4" />{pair.status?.toLowerCase() === "awaiting_templates" ? "Retry after activation" : "Retry / reconcile"}</Button>}
                      {["documents_ready", "investor_signed"].includes(pair.status?.toLowerCase() || "") && <Button size="sm" onClick={() => runPairAction(pair, "resend")} disabled={busyId === pair.id}><Send className="mr-1.5 h-4 w-4" />Resend email</Button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={async () => {
          setBusyId(-3);
          try {
            const result = await authenticatedRequest("/api/admin/legal/dispatch", { method: "POST" });
            toast({ title: "Legal dispatcher run", description: result?.message || "Queued legal generation, notification, and reconciliation work was dispatched." });
            invalidateLegal();
          } catch (error: any) {
            toast({ title: "Could not dispatch legal work", description: error.message, variant: "destructive" });
          } finally {
            setBusyId(null);
          }
        }} disabled={busyId === -3}>
          {busyId === -3 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Dispatch legal jobs
        </Button>
      </div>
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col"><DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>Read-only template preview.</DialogDescription></DialogHeader>{preview && <iframe title={preview.title} src={preview.url} className="w-full flex-1 rounded border bg-slate-100" />}</DialogContent>
      </Dialog>
      <Dialog open={!!audit} onOpenChange={(open) => !open && setAudit(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{audit?.title}</DialogTitle><DialogDescription>Append-only legal document audit history.</DialogDescription></DialogHeader><pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-4 text-xs text-slate-800">{JSON.stringify(audit?.events, null, 2)}</pre></DialogContent>
      </Dialog>
    </div>
  );
}