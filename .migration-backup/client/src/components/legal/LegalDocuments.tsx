import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Clock, Download, Eye, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { NativeSigningDialog } from "@/components/legal/NativeSigningDialog";

export { AdminLegalWorkspace as AdminLegalManagement } from "./AdminLegalWorkspace";

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
  const isFocused = focus || (!!holding && Number(holding.reservationId) === requestedHoldingId);

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