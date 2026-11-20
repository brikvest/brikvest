import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, Download, Eye, FileCheck2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, getApiErrorMessage } from "@/lib/queryClient";
import { HISTORICAL_SEARCH_LIMIT, historicalLoadFailure } from "@shared/historical-holdings-errors";

type Request = (url: string, options?: any) => Promise<any>;
type LegalDocument = { id: number; type: string; status: string; hasUnsignedPdf: boolean; hasSignedPdf: boolean; hasCertificate: boolean; sha256?: string; templateId?: number; templateVersion?: number };
type HistoricalHolding = {
  reservationId: number; userName: string; userEmail: string; units: string; amount: string; currency: string;
  landConsiderationNaira?: string | null; needsConsiderationCorrection?: boolean;
  pairId: number | null; preparationState: string; signingState: string; notificationState: string;
  canPrepare: boolean; requiresAttestation: boolean; canNotify: boolean; reviewToken: string;
  canReview?: boolean; reviewApproved?: boolean; documents?: LegalDocument[];
  auditHistory?: { id: number; eventType: string; actorId?: number; createdAt: string; details: unknown }[];
  blockers: string[]; lastError?: string;
  notificationHistory: { id: number; cycleNumber: number; status: string; lastError?: string; createdAt: string; sentAt?: string }[];
  jobs: { id?: number; cycleId?: number; kind: string; status: string; lastError?: string; availableAt?: string; retryEligible?: boolean }[];
};
type Template = { id: number; documentType: string; version: number };
type HoldingResponse = { items: HistoricalHolding[]; total: number; page: number; pageSize: number; templates: Template[]; propertyName: string };
type AttestationDraft = { confirmed: boolean; amountNaira: string; auditNote: string };
type Review = { pairId: number; propertyId: number; reservationId: number; investorName: string; propertyName: string; documents: { id: number; type: string; sha256: string; templateId?: number; templateVersion?: number }[]; approved: boolean };
type PreparationConfirmation = { deed: Template; transfer: Template; holdings: HistoricalHolding[] };

const pageSize = 20;
const activeJob = (status: string) => ["queued", "leased", "retry", "processing", "sending"].includes(status.toLowerCase());
const fullySigned = (state: string) => state.toLowerCase() === "investor_signed";
const title = (type: string) => type === "deed_of_assignment" ? "Deed of Assignment" : type === "transfer_exit_rights" ? "Transfer and Exit Rights Agreement" : type.replace(/_/g, " ");
const decimalText = (value: string) => { const [whole, fraction = ""] = value.trim().split("."); return whole.replace(/^0+(?=\d)/, "") + (fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""); };
const stage = (holding: HistoricalHolding) => {
  if (fullySigned(holding.signingState)) return "Investor signed";
  const jobs = holding.jobs || [];
  const notificationJobs = jobs.filter((job) => /notification|email/i.test(job.kind) || /^notify$/i.test(job.kind));
  const preparationJobs = jobs.filter((job) => !/notification|email|signing|signature/i.test(job.kind) && !/^notify$/i.test(job.kind) && /generation|pdf|prepare|document/i.test(job.kind));
  const notificationState = (holding.notificationState || "").toLowerCase();
  const notificationStateValue = notificationState.startsWith("not_") ? "" : notificationState.replace(/^notification_/, "");
  const history = [...(holding.notificationHistory || [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latestNotification = history[history.length - 1];
  if (["uncertain", "outcome_uncertain", "delivery_uncertain"].includes(notificationStateValue) || notificationJobs.some((job) => ["uncertain", "ambiguous"].includes(job.status.toLowerCase()))) return "Notification outcome uncertain";
  const docs = holding.documents || [];
  const bothPdfsReady = ["deed_of_assignment", "transfer_exit_rights"].every((type) => docs.some((doc) => doc.type === type && doc.hasUnsignedPdf));
  if (["processing", "sending", "leased"].includes(notificationStateValue) || notificationJobs.some((job) => ["leased", "processing", "sending"].includes(job.status.toLowerCase()))) return "Notification processing";
  const notifyGateBlocked = notificationJobs.some((job) => job.status.toLowerCase() === "blocked" && holding.canReview && !holding.reviewApproved);
  if (!notifyGateBlocked && (["failed", "dead", "blocked"].includes(notificationStateValue) || notificationJobs.some((job) => ["failed", "dead", "blocked"].includes(job.status.toLowerCase())))) return "Notification failed";
  if (["sent", "accepted", "delivered", "complete", "mail_accepted", "sent_to_mail_service"].includes(notificationStateValue) || notificationJobs.some((job) => ["accepted", "sent", "complete"].includes(job.status.toLowerCase())) || ["sent", "accepted", "complete", "sent_to_mail_service"].includes((latestNotification?.status || "").toLowerCase())) return "Notification accepted";
  if (holding.canReview && bothPdfsReady && !holding.reviewApproved) return "PDFs ready for review · notification held";
  if (notificationStateValue === "queued" || notificationJobs.some((job) => ["queued", "retry"].includes(job.status.toLowerCase()))) return "Notification queued";
  if (holding.signingState.toLowerCase() === "partially_signed") return "Partially signed";
  if (preparationJobs.some((job) => ["failed", "dead", "blocked"].includes(job.status.toLowerCase()))) return "Preparation needs attention";
  if (preparationJobs.some((job) => job.status.toLowerCase() === "retry" && !!job.lastError)) return "Preparation retry queued";
  if (preparationJobs.some((job) => ["leased", "processing"].includes(job.status.toLowerCase()))) return "Documents processing";
  if (preparationJobs.some((job) => job.status.toLowerCase() === "queued") || holding.preparationState.toLowerCase() === "queued") return "Preparation queued";
  if (preparationJobs.some((job) => job.status.toLowerCase() === "retry")) return "Preparation retry queued";
  if (holding.preparationState.toLowerCase() === "processing") return "Documents processing";
  if (holding.preparationState.toLowerCase() === "failed" || holding.preparationState.toLowerCase() === "blocked") return "Preparation needs attention";
  if (holding.pairId && bothPdfsReady && holding.canReview && !holding.reviewApproved) return "PDFs ready for review · notification held";
  if (holding.pairId && docs.length > 0 && !bothPdfsReady) return "PDFs still processing";
  if (holding.pairId && docs.length) return holding.reviewApproved ? "Ready to send invitation" : "PDFs awaiting review";
  if (holding.pairId) return "Documents processing";
  if (holding.canPrepare) return "Ready to prepare";
  return "Preparation blocked";
};
const statusTone = (text: string) => text.includes("attention") || text.includes("failed") || text.includes("blocked") || text.includes("uncertain") ? "border-rose-200 bg-rose-50 text-rose-800" : text.includes("review") || text.includes("processing") || text.includes("queued") ? "border-amber-200 bg-amber-50 text-amber-900" : text.includes("accepted") || text.includes("signed") ? "border-teal-200 bg-teal-50 text-teal-900" : "border-slate-200 bg-[#f2f4ef] text-slate-700";

export function HistoricalLegalHoldings({ propertyId, propertyName, authenticatedRequest, active = true }: { propertyId: number; propertyName: string; authenticatedRequest: Request; active?: boolean }) {
  // Remount all action state and invalidate in-flight detail sessions on scope changes.
  return <HistoricalLegalHoldingsScope key={propertyId} {...{ propertyId, propertyName, authenticatedRequest, active }} />;
}

function HistoricalLegalHoldingsScope({ propertyId, propertyName, authenticatedRequest, active }: { propertyId: number; propertyName: string; authenticatedRequest: Request; active: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [attestations, setAttestations] = useState<Record<number, AttestationDraft>>({});
  const [preparing, setPreparing] = useState(false);
  const [confirmation, setConfirmation] = useState<PreparationConfirmation | null>(null);
  const [detail, setDetail] = useState<HistoricalHolding | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [checked, setChecked] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const mounted = useRef(true);
  const activePair = useRef<number | null>(null);
  const detailSession = useRef(0);
  const reviewRequestSignature = useRef("");
  const objectUrls = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; objectUrls.current.forEach((url) => URL.revokeObjectURL(url)); objectUrls.current.clear(); }; }, []);
  useEffect(() => () => { if (preview) { URL.revokeObjectURL(preview.url); objectUrls.current.delete(preview.url); } }, [preview]);

  const query = useQuery<HoldingResponse>({
    queryKey: ["/api/admin/legal/historical-holdings", propertyId, search, page, pageSize],
    queryFn: () => { const params = new URLSearchParams({ propertyId: String(propertyId), search, page: String(page), pageSize: String(pageSize) }); return authenticatedRequest(`/api/admin/legal/historical-holdings?${params}`); },
    enabled: active,
    retry: false,
    placeholderData: undefined,
    refetchInterval: (current) => active && current.state.data?.items.some((holding) => holding.jobs?.some((job) => activeJob(job.status))) ? 5000 : false,
  });
  const failures = useQuery<any[]>({
    queryKey: ["/api/admin/legal/failures", propertyId],
    queryFn: () => authenticatedRequest(`/api/admin/legal/failures?propertyId=${propertyId}`),
    enabled: active,
  });
  const items = useMemo(() => query.isError ? [] : query.data?.items || [], [query.data?.items, query.isError]);
  const templates = query.data?.templates || [];
  const deed = templates.find((template) => template.documentType === "deed_of_assignment");
  const transfer = templates.find((template) => template.documentType === "transfer_exit_rights");
  const selectedRows = useMemo(() => items.filter((item) => selected.includes(item.reservationId)), [items, selected]);
  const detailRefresh = useMemo(() => {
    if (!detail) return null;
    const holding = items.find((item) => item.reservationId === detail.reservationId);
    if (!holding) return null;
    const signature = `${holding.pairId ?? "none"}|${(holding.documents || []).map((doc) => `${doc.id}:${doc.sha256 || ""}`).sort().join("|")}`;
    return { holding, signature };
  }, [items, detail?.reservationId]);
  const validAttestation = (holding: HistoricalHolding) => {
    const draft = attestations[holding.reservationId];
    return !!draft?.confirmed && /^\d+(?:\.\d{1,2})?$/.test(draft.amountNaira.trim()) &&
      decimalText(draft.amountNaira) === decimalText(holding.amount) && holding.currency.toUpperCase() === "NGN" && !!draft.auditNote.trim();
  };
  const canOpenPreparation = !query.isFetching && !query.isError && !!deed && !!transfer && selectedRows.length > 0 && selectedRows.length === selected.length && selectedRows.every((h) => h.canPrepare);
  const updatedConfirmationHoldings = confirmation?.holdings.map((holding) =>
    items.find((item) => item.reservationId === holding.reservationId));
  const confirmationIsCurrent = !!confirmation && !!deed && !!transfer &&
    deed.id === confirmation.deed.id && deed.version === confirmation.deed.version &&
    transfer.id === confirmation.transfer.id && transfer.version === confirmation.transfer.version &&
    confirmation.holdings.every((holding, index) => {
      const current = updatedConfirmationHoldings?.[index];
      return !!current?.canPrepare && current.reviewToken === holding.reviewToken &&
        current.amount === holding.amount && current.currency === holding.currency &&
        current.requiresAttestation === holding.requiresAttestation;
    });
  const canReviewUpdatedRecords = !!deed && !!transfer && !!updatedConfirmationHoldings?.length &&
    updatedConfirmationHoldings.every((holding) => !!holding?.canPrepare);
  const canConfirmPreparation = !query.isFetching && !query.isError && confirmationIsCurrent &&
    !!confirmation && confirmation.holdings.length > 0 &&
    confirmation.holdings.every((h) => h.canPrepare && (!h.requiresAttestation || validAttestation(h)));
  const totalPages = Math.max(1, Math.ceil((query.data?.total || 0) / pageSize));
  const loadFailure = historicalLoadFailure(query.error instanceof ApiError ? query.error.status : 500, query.error instanceof ApiError ? query.error.code : undefined);
  function clearQueryActions() {
    setSelected([]); setAttestations({}); setConfirmation(null); setPreparing(false);
    detailSession.current += 1; activePair.current = null; reviewRequestSignature.current = "";
    setDetail(null); setReview(null); setChecked({}); setPreview(null); setError(""); setResult("");
  }
  useEffect(() => { clearQueryActions(); }, [search, page]);
  useEffect(() => { if (!active) clearQueryActions(); }, [active]);
  // Background polling must not dismiss a form or discard an administrator's
  // entries. Frozen identities are compared above and rechecked by the server.
  function retryLoad() {
    clearQueryActions();
    void query.refetch();
  }

  function toggle(holding: HistoricalHolding, value: boolean) {
    setSelected((current) => value ? current.length >= 20 || current.includes(holding.reservationId) ? current : [...current, holding.reservationId] : current.filter((id) => id !== holding.reservationId));
  }
  function attestation(id: number, patch: Partial<AttestationDraft>) {
    setAttestations((current) => ({ ...current, [id]: { ...(current[id] || { confirmed: false, amountNaira: "", auditNote: "" }), ...patch } }));
  }
  function beginPreparation(holdings: HistoricalHolding[]) {
    if (!deed || !transfer || !holdings.length) return;
    setSelected(holdings.map((holding) => holding.reservationId));
    setConfirmation({ deed: { ...deed }, transfer: { ...transfer }, holdings: holdings.map((holding) => ({ ...holding, reviewToken: holding.reviewToken })) });
    setPreparing(true);
  }
  async function refresh() {
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/legal/failures", propertyId] }),
    ]);
  }
  async function prepare() {
    if (!canConfirmPreparation || working || !confirmation) return;
    setWorking("prepare"); setError(""); setResult("");
    try {
      const response = await authenticatedRequest("/api/admin/legal/historical-holdings/prepare", { method: "POST", body: JSON.stringify({
        propertyId, confirmed: true, templateIds: { deed: confirmation.deed.id, transfer: confirmation.transfer.id },
        holdings: confirmation.holdings.map((holding) => ({ reservationId: holding.reservationId, reviewToken: holding.reviewToken,
          ...(holding.requiresAttestation ? { attestation: { fullPaymentConfirmed: true, amountNaira: attestations[holding.reservationId].amountNaira.trim(), currency: "NGN", auditNote: attestations[holding.reservationId].auditNote.trim() } } : {}) })),
      }) });
      if (!mounted.current) return;
      const results = response?.results || [];
      setResult(results.map((item: any) => `Holding #${item.reservationId}: ${item.state.replace(/_/g, " ")}${item.reason ? ` — ${item.reason}` : ""}`).join(" · ") || "Preparation request accepted.");
      setSelected([]); setConfirmation(null); setPreparing(false); await refresh();
    } catch (cause) { if (mounted.current) setError(getApiErrorMessage(cause, "Preparation could not be confirmed. Refresh this property before retrying.")); }
    finally { if (mounted.current) setWorking(null); }
  }
  async function requestReview(holding: HistoricalHolding) {
    if (!holding.pairId || (!holding.canReview && !holding.reviewApproved) || activePair.current !== holding.pairId) return;
    const session = detailSession.current;
    const signature = `${holding.pairId}|${(holding.documents || []).map((doc) => `${doc.id}:${doc.sha256 || ""}`).sort().join("|")}`;
    if (reviewRequestSignature.current === signature) return;
    if (reviewRequestSignature.current && reviewRequestSignature.current !== signature) setChecked({});
    reviewRequestSignature.current = signature;
    try {
      const info = await authenticatedRequest(`/api/admin/legal/pairs/${holding.pairId}/review?propertyId=${propertyId}`);
      if (!mounted.current || activePair.current !== holding.pairId || detailSession.current !== session || reviewRequestSignature.current !== signature) return;
      const receivedIdentity = info.documents.map((doc: Review["documents"][number]) => `${doc.id}:${doc.sha256}`).sort().join("|");
      const previousIdentity = (review?.documents || []).map((doc) => `${doc.id}:${doc.sha256}`).sort().join("|");
      if (receivedIdentity !== previousIdentity) setChecked({});
      setReview(info);
    } catch (cause) {
      if (mounted.current && activePair.current === holding.pairId && detailSession.current === session && reviewRequestSignature.current === signature) setError(getApiErrorMessage(cause, "Review details could not be loaded. Retry by closing and reopening this holding."));
    }
  }
  useEffect(() => {
    const holding = detailRefresh?.holding;
    if (!holding || activePair.current !== holding.pairId) return;
    setDetail(holding);
    if (holding.canReview || holding.reviewApproved) void requestReview(holding);
    else if (!holding.pairId) { setReview(null); setChecked({}); }
  }, [detailRefresh]);
  function openDetail(holding: HistoricalHolding) {
    detailSession.current += 1;
    activePair.current = holding.pairId;
    reviewRequestSignature.current = "";
    setDetail(holding); setError(""); setResult(""); setReview(null); setChecked({});
  }
  async function fileAction(doc: LegalDocument, mode: "preview" | "download", version: "unsigned" | "signed" | "certificate" = "unsigned") {
    const holdingId = detail?.reservationId;
    const pairId = detail?.pairId ?? null;
    const session = detailSession.current;
    const key = `${doc.id}-${mode}`; setWorking(key); setError("");
    try {
      const response = await fetch(`/api/admin/legal/documents/${doc.id}/${mode}?version=${version}&propertyId=${propertyId}`, { credentials: "include", headers: { Authorization: `Bearer ${localStorage.getItem("admin_session_id") || ""}` } });
      if (!response.ok) throw new Error(`PDF ${mode} failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob()); objectUrls.current.add(url);
      if (!mounted.current || activePair.current !== pairId || detailSession.current !== session) { URL.revokeObjectURL(url); objectUrls.current.delete(url); return; }
      if (mode === "preview") setPreview({ url, title: `${title(doc.type)} · ${version === "signed" ? "signed PDF" : "investor PDF"} · Holding #${holdingId}` });
      else { const a = document.createElement("a"); a.href = url; a.download = `${doc.type}-holding-${holdingId}-${version}.${version === "certificate" ? "pdf" : "pdf"}`; a.click(); window.setTimeout(() => { URL.revokeObjectURL(url); objectUrls.current.delete(url); }, 1000); }
    } catch (cause) { if (mounted.current && activePair.current === pairId && detailSession.current === session) setError(getApiErrorMessage(cause, "The investor PDF is unavailable. Retry before approving review.")); }
    finally { if (mounted.current) setWorking(null); }
  }
  async function approveAndSend() {
    if (!detail?.pairId || !review || working) return;
    const pairId = detail.pairId;
    const session = detailSession.current;
    const docs = ["deed_of_assignment", "transfer_exit_rights"].map((type) => review.documents.find((doc) => doc.type === type));
    const both = docs.every((doc) => !!doc && checked[doc.id] === doc.sha256);
    if (!both) return;
    setWorking("approve"); setError(""); setResult("");
    try {
      const response = await authenticatedRequest(`/api/admin/legal/pairs/${pairId}/approve-send`, { method: "POST", body: JSON.stringify({ propertyId, confirmed: true, documents: docs.map((doc) => ({ id: doc!.id, sha256: doc!.sha256 })) }) });
      if (!mounted.current) return;
      if (activePair.current !== pairId || detailSession.current !== session) return;
      await refresh();
      if (!mounted.current || activePair.current !== pairId || detailSession.current !== session) return;
      setResult(response?.message || "Review approval recorded and notification request accepted. Email delivery is not confirmed.");
      const fresh = (queryClient.getQueryData<HoldingResponse>(["/api/admin/legal/historical-holdings", propertyId, search, page, pageSize]))?.items.find((h) => h.reservationId === detail.reservationId);
      if (fresh) setDetail(fresh);
      setReview((current) => current ? { ...current, approved: true } : current);
    } catch (cause) { if (mounted.current && activePair.current === pairId && detailSession.current === session) setError(getApiErrorMessage(cause, "Approval was not confirmed. Refresh review details before retrying.")); }
    finally { if (mounted.current) setWorking(null); }
  }
  async function pairAction(kind: "retry" | "resend" | "audit" | "correct-consideration" | "recover-notification") {
    if (!detail?.pairId || working) return;
    if (kind === "correct-consideration" && !window.confirm(
      "Create new land-only legal drafts? Original documents and full payment history will be retained. Both new PDFs must be reviewed again before email is released."
    )) return;
    const pairId = detail.pairId;
    const session = detailSession.current;
    setWorking(kind); setError(""); setResult("");
    try {
      const job = detail.jobs.find(job => job.kind === "notify");
      const response = await authenticatedRequest(`/api/admin/legal/pairs/${pairId}/${kind}?propertyId=${propertyId}`, { method: kind === "audit" ? "GET" : "POST", ...(kind === "audit" ? {} : { body: JSON.stringify({ propertyId,
        ...(kind === "correct-consideration" ? { confirmed: true } : {}),
        ...(kind === "recover-notification" ? { confirmed: true, jobId: job?.id, cycleId: job?.cycleId } : {}) }) }) });
      if (!mounted.current || activePair.current !== pairId || detailSession.current !== session) return;
      if (kind === "audit") setResult(JSON.stringify(response, null, 2));
      else {
        await refresh();
        if (mounted.current && activePair.current === pairId && detailSession.current === session) {
          setResult(response?.message || (kind === "retry" ? "Retry queued." : "Notification request queued; inbox delivery is not confirmed."));
          if (kind === "correct-consideration") {
            setReview(null); setChecked({});
            const fresh = queryClient.getQueryData<HoldingResponse>(["/api/admin/legal/historical-holdings", propertyId, search, page, pageSize])?.items.find(h => h.pairId === pairId);
            if (fresh) setDetail(fresh);
          }
        }
      }
    } catch (cause) { if (mounted.current && activePair.current === pairId && detailSession.current === session) setError(getApiErrorMessage(cause, "Action could not be confirmed. Check the recorded history before retrying.")); }
    finally { if (mounted.current) setWorking(null); }
  }
  const allDocs = review?.documents || [];
  const existingNotification = detail?.jobs.find(job => job.kind === "notify" && ["queued", "retry"].includes(job.status));
  const reviewGateHeld = !!detail && ["awaiting_review", "held_for_review"].includes(detail.notificationState.toLowerCase().replace(/^notification_/, ""));
  const reviewReady = !!detail?.canReview && !!review && ["deed_of_assignment", "transfer_exit_rights"].every((type) => {
    const doc = allDocs.find((item) => item.type === type);
    const listed = detail.documents?.find((item) => item.id === doc?.id);
    return !!doc && !!doc.sha256 && !!listed?.hasUnsignedPdf && (!listed.sha256 || listed.sha256 === doc.sha256) && checked[doc.id] === doc.sha256;
  });

  return <>
    <Card className="border-[#d9ded4] shadow-sm">
      <CardHeader className="pb-4"><div className="flex items-start justify-between gap-4"><div><CardTitle className="text-lg">Investor documents</CardTitle><CardDescription className="mt-1">One property-scoped queue for every confirmed holding, including purchases without a document pair.</CardDescription></div><span className="hidden rounded-full bg-[#e9eee5] px-3 py-1 text-xs font-medium text-[#405a45] sm:inline">{query.data?.total ?? "—"} holdings</span></div></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input aria-label="Search historical holdings" maxLength={HISTORICAL_SEARCH_LIMIT} placeholder="Search investor, email or holding" value={search} onChange={(event) => { clearQueryActions(); setSearch(event.target.value.slice(0, HISTORICAL_SEARCH_LIMIT)); setPage(1); }} />
          <Button type="button" variant="outline" disabled={query.isFetching} onClick={retryLoad}><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
        {error && <div role="alert" className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}</div>}
        {result && <div aria-live="polite" className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{result}</div>}
        {query.isLoading ? <div role="status" aria-label="Loading historical holdings" className="space-y-2"><div className="h-16 animate-pulse rounded bg-[#edf0e9]" /><div className="h-16 animate-pulse rounded bg-[#edf0e9]" /></div>
          : query.isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><div><p>Could not load holdings for {propertyName}. {loadFailure.summary}</p><p className="mt-1">{loadFailure.nextAction}</p></div><Button size="sm" variant="outline" disabled={query.isFetching} onClick={retryLoad}>Try again</Button></div>
          : !items.length ? <div className="rounded-lg border border-dashed border-[#cbd3c6] bg-[#f6f7f3] px-6 py-10 text-center"><FileCheck2 className="mx-auto mb-2 h-6 w-6 text-[#56705b]" /><h3 className="font-medium text-[#25332a]">{query.data?.total ? "No matching holdings" : "No confirmed holdings yet"}</h3><p className="mt-1 text-sm text-[#687568]">{query.data?.total ? "Try an investor name, email or holding number." : "Confirmed property purchases will appear here, even before documents are prepared."}</p></div>
          : <div className="divide-y divide-[#e5e8e1] rounded-lg border border-[#e0e4dc]">{items.map((holding) => {
            const status = stage(holding);
            const canSelect = holding.canPrepare && selected.length < 20;
            return <article key={holding.reservationId} data-holding-id={holding.reservationId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              {!holding.pairId && <Checkbox aria-label={`Select holding ${holding.reservationId} for preparation`} checked={selected.includes(holding.reservationId)} disabled={!holding.canPrepare || (!canSelect && !selected.includes(holding.reservationId))} onCheckedChange={(value) => toggle(holding, value === true)} />}
              <button type="button" onClick={() => void openDetail(holding)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#65816a] focus-visible:ring-offset-2">
                <span className="block truncate font-semibold text-[#29372e]">{holding.userName || "Investor"}</span>
                <span className="mt-0.5 block truncate text-xs text-[#6c786d]">{holding.userEmail} · Holding #{holding.reservationId}</span>
                 {holding.lastError && <span className="mt-1 block max-w-xl truncate text-xs text-rose-700" title={holding.lastError}>Latest issue: {holding.lastError}</span>}
              </button>
              <Badge variant="outline" className={`w-fit whitespace-nowrap ${statusTone(status)}`}>{status}</Badge>
               <Button size="sm" variant={status.startsWith("PDFs ready for review") ? "default" : "outline"} onClick={() => void openDetail(holding)}>{status === "Preparation retry queued" ? "Review retry" : holding.canPrepare && !holding.pairId ? "Prepare" : holding.canReview ? "Review PDFs" : "Details"}</Button>
            </article>;
          })}</div>}
        {!query.isLoading && !query.isError && !!query.data?.total && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e5e8e1] pt-3">
          <div className="text-xs text-[#687568]">Page {page} of {totalPages} · {query.data.total} holdings</div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setSelected([]); }}>Previous</Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => { setPage((p) => p + 1); setSelected([]); }}>Next</Button></div>
        </div>}
        {selected.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#cfd9cb] bg-[#f1f5ee] p-3"><div className="text-sm text-[#435548]"><strong>{selected.length} selected</strong><span className="ml-2 text-xs">{deed ? `Deed v${deed.version}` : "Deed unavailable"} · {transfer ? `Transfer v${transfer.version}` : "Transfer unavailable"}</span></div><Button disabled={!canOpenPreparation || !!working} onClick={() => { setError(""); beginPreparation(selectedRows); }}><ShieldCheck className="mr-2 h-4 w-4" />Review preparation</Button></div>}
        <details className="rounded-md border border-[#e0e4dc] p-3">
          <summary className="cursor-pointer text-sm font-medium text-[#536154]">Recorded failures and recovery history {failures.data ? `(${failures.data.length})` : ""}</summary>
          <div className="mt-3 space-y-2">{failures.isLoading ? <div role="status" className="h-12 animate-pulse rounded bg-[#edf0e9]" /> : failures.isError ? <div role="alert" className="flex items-center justify-between gap-3 text-sm text-rose-800"><span>Could not load recorded failures for this property.</span><Button size="sm" variant="outline" onClick={() => void failures.refetch()}>Try again</Button></div> : !(failures.data || []).length ? <p className="text-sm text-[#69746a]">No recorded failures.</p> : (failures.data || []).map((failure, index) => <details key={failure.id ?? index} className="rounded border border-[#e0e4dc] p-2"><summary className="cursor-pointer text-sm">{(failure.eventType || "Recorded failure").replace(/_/g, " ")}{failure.reservationId ? ` · Holding #${failure.reservationId}` : ""}{failure.createdAt ? ` · ${new Date(failure.createdAt).toLocaleString()}` : ""}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs text-[#667267]">{JSON.stringify(failure.details ?? failure, null, 2)}</pre></details>)}</div>
        </details>
      </CardContent>
    </Card>

    <Dialog open={preparing} onOpenChange={(open) => { if (!working) { setPreparing(open); if (!open) setConfirmation(null); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Prepare confirmed holdings</DialogTitle><DialogDescription>Confirm the exact property templates before generating documents. Existing pairs and evidence are never replaced.</DialogDescription></DialogHeader>
        <div className="space-y-2 rounded-md bg-[#f2f4ef] p-3 text-sm"><p><strong>Property:</strong> {propertyName} · #{propertyId}</p><p><strong>Deed:</strong> {confirmation ? `#${confirmation.deed.id} · version ${confirmation.deed.version}` : "Unavailable"}</p><p><strong>Transfer:</strong> {confirmation ? `#${confirmation.transfer.id} · version ${confirmation.transfer.version}` : "Unavailable"}</p><ul className="list-inside list-disc">{confirmation?.holdings.map((holding) => <li key={holding.reservationId}>Holding #{holding.reservationId} · {holding.userName} · {holding.userEmail}</li>)}</ul></div>
        {query.isFetching && <p role="status" className="text-sm text-slate-600">Updating holding records… Your entries will be kept.</p>}
        {query.isError && <div role="alert" className="space-y-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <p>Could not refresh these holding records. Your entries are saved in this form; retry before confirming.</p>
          <Button variant="outline" disabled={!!working} onClick={() => void query.refetch()}>Retry records</Button>
        </div>}
        {!query.isFetching && !query.isError && confirmation && !confirmationIsCurrent &&
          <div role="alert" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p>The holding records or templates changed. Review the updated records before confirming. Your entries have been kept.</p>
            <Button variant="outline" disabled={!!working || !canReviewUpdatedRecords}
              onClick={() => {
                if (canReviewUpdatedRecords) beginPreparation(updatedConfirmationHoldings!.filter((holding): holding is HistoricalHolding => !!holding));
              }}>Review updated records</Button>
            {!canReviewUpdatedRecords && <p>One or more holdings are no longer eligible for preparation. Close this form and check their latest status.</p>}
          </div>}
        {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {confirmation?.holdings.filter((h) => h.requiresAttestation).map((holding) => {
          const draft = attestations[holding.reservationId] || { confirmed: false, amountNaira: "", auditNote: "" };
          return <section key={holding.reservationId} className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3"><h3 className="font-semibold text-amber-950">Payment attestation · Holding #{holding.reservationId}</h3>
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.confirmed} onCheckedChange={(value) => attestation(holding.reservationId, { confirmed: value === true })} /><span>I reviewed the payment record and confirm full payment.</span></label>
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor={`attest-amount-${holding.reservationId}`}>Confirmed amount (NGN)</Label><Input id={`attest-amount-${holding.reservationId}`} value={draft.amountNaira} onChange={(event) => attestation(holding.reservationId, { amountNaira: event.target.value })} /><p className="text-xs text-slate-600">Persisted amount: {holding.currency} {holding.amount}</p></div><div className="space-y-1"><Label htmlFor={`attest-note-${holding.reservationId}`}>Audit note</Label><Textarea id={`attest-note-${holding.reservationId}`} value={draft.auditNote} onChange={(event) => attestation(holding.reservationId, { auditNote: event.target.value })} rows={3} /></div></div>
          </section>;
        })}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={!!working} onClick={() => { setPreparing(false); setConfirmation(null); }}>Cancel</Button><Button disabled={!canConfirmPreparation || !!working} onClick={() => void prepare()}>{working === "prepare" ? "Preparing…" : "Confirm and prepare"}</Button></div>
      </DialogContent>
    </Dialog>

    <Dialog open={!!detail} onOpenChange={(open) => { if (!open) { detailSession.current += 1; activePair.current = null; setDetail(null); setReview(null); } }}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{detail?.userName || "Investor"} · Holding #{detail?.reservationId}</DialogTitle><DialogDescription>{propertyName} · {detail?.userEmail} · {detail ? `${detail.units} units · ${detail.currency} ${detail.amount}` : ""}</DialogDescription></DialogHeader>
        {!detail?.pairId ? <div className="space-y-3"><p className="rounded-md border border-[#dce4d8] bg-[#f3f6f0] p-3 text-sm text-[#4c5d4d]">No document pair exists for this confirmed holding. Preparation uses the current live template versions.</p>{detail?.blockers?.length ? <ul className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{detail.blockers.map((item) => <li key={item}>• {item}</li>)}</ul> : null}<Button disabled={!detail?.canPrepare || !!working || !deed || !transfer} onClick={() => { if (detail) { beginPreparation([detail]); setDetail(null); activePair.current = null; detailSession.current += 1; } }}><FileCheck2 className="mr-2 h-4 w-4" />Prepare this holding</Button></div> :
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <p>Land consideration: <strong>{detail.landConsiderationNaira
                ? `${detail.currency} ${Number(detail.landConsiderationNaira).toLocaleString()}`
                : "Cost breakdown requires verification"}</strong></p>
              <p className="mt-1 text-slate-600">Total paid including fees: {detail.currency} {Number(detail.amount).toLocaleString()}</p>
              {(detail.needsConsiderationCorrection || (
                detail.landConsiderationNaira && ["queued", "failed"].includes(detail.preparationState) &&
                detail.documents.length === 2 && detail.documents.every(document => !document.hasSignedPdf)
              )) && !fullySigned(detail.signingState) && <Button
                className="mt-3" size="sm" variant="outline" disabled={!!working}
                onClick={() => void pairAction("correct-consideration")}>
                {detail.needsConsiderationCorrection ? "Correct land-only deed amounts" : "Generate corrected land-only PDFs"}
              </Button>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-md bg-[#f2f4ef] p-3"><p className="text-xs uppercase tracking-wide text-[#687568]">Preparation</p><p className="mt-1 font-medium">{detail.preparationState.replace(/_/g, " ")}</p></div><div className="rounded-md bg-[#f2f4ef] p-3"><p className="text-xs uppercase tracking-wide text-[#687568]">Signing</p><p className="mt-1 font-medium">{detail.signingState.replace(/_/g, " ")}</p></div><div className="rounded-md bg-[#f2f4ef] p-3"><p className="text-xs uppercase tracking-wide text-[#687568]">Notification</p><p className="mt-1 font-medium">{detail.notificationState.replace(/_/g, " ")}</p></div><div className="rounded-md bg-[#f2f4ef] p-3"><p className="text-xs uppercase tracking-wide text-[#687568]">Review approval</p><p className="mt-1 font-medium">{review?.approved || detail.reviewApproved ? "Approved for these document hashes" : "Not approved"}</p></div></div>
            <Button size="sm" variant="outline" disabled={query.isFetching || !!working} onClick={() => void refresh()}><RefreshCw className={`mr-1.5 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />Refresh holding</Button>
            {detail.blockers?.length > 0 && <ul className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{detail.blockers.map((item) => <li key={item} className="flex gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{item}</li>)}</ul>}
            {detail.lastError && <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><strong>Last failure:</strong> {detail.lastError}</p>}
            <section className="space-y-2"><h3 className="font-semibold text-[#29372e]">Investor-specific PDFs</h3>
              {!review && !detail.documents?.length ? <p className="rounded-md bg-[#f5f6f2] p-3 text-sm text-[#69746a]">PDFs are not available yet. Processing will update this holding when artifacts are ready.</p> : (detail.documents || []).map((doc) => {
                const exact = review?.documents.find((item) => item.id === doc.id);
                const unsignedReady = doc.hasUnsignedPdf;
                const reviewable = unsignedReady && !!exact?.sha256 && detail.canReview && !review?.approved;
                return <div key={doc.id} className="rounded-lg border border-[#dfe4db] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-medium">{title(doc.type)}</h4><p className="mt-1 text-xs text-[#6b776b]">Document #{doc.id} · {exact?.templateId ? `Template #${exact.templateId} · v${exact.templateVersion}` : doc.templateId ? `Template #${doc.templateId} · v${doc.templateVersion}` : "Pinned template version unavailable"} · {unsignedReady ? "Investor PDF generated" : "Investor PDF not ready"}</p></div><Badge variant="outline" className={reviewable ? "border-teal-200 bg-teal-50 text-teal-900" : unsignedReady ? "border-slate-200 bg-[#f2f4ef] text-slate-700" : "border-amber-200 bg-amber-50 text-amber-900"}>{reviewable ? "Ready for review" : unsignedReady ? "PDF available" : "Processing"}</Badge></div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {unsignedReady && <><Button size="sm" variant="outline" disabled={!!working} onClick={() => void fileAction(doc, "preview", "unsigned")}><Eye className="mr-1.5 h-4 w-4" />Preview PDF</Button><Button size="sm" variant="ghost" disabled={!!working} onClick={() => void fileAction(doc, "download", "unsigned")}><Download className="mr-1.5 h-4 w-4" />Download PDF</Button></>}
                    {doc.hasSignedPdf && <><Button size="sm" variant="outline" disabled={!!working} onClick={() => void fileAction(doc, "preview", "signed")}><Eye className="mr-1.5 h-4 w-4" />View signed PDF</Button><Button size="sm" variant="ghost" disabled={!!working} onClick={() => void fileAction(doc, "download", "signed")}><Download className="mr-1.5 h-4 w-4" />Download signed PDF</Button></>}
                    {doc.hasCertificate && <Button size="sm" variant="ghost" disabled={!!working} onClick={() => void fileAction(doc, "download", "certificate")}><Download className="mr-1.5 h-4 w-4" />Download signing certificate</Button>}
                    {reviewable && <label className="ml-0 flex items-center gap-2 text-sm sm:ml-auto"><Checkbox checked={checked[doc.id] === exact?.sha256} onCheckedChange={(value) => setChecked((current) => { const next = { ...current }; if (value === true && exact?.sha256) next[doc.id] = exact.sha256; else delete next[doc.id]; return next; })} /><span>I reviewed this PDF</span></label>}
                  </div>
                </div>;
              })}
            </section>
            {detail.canReview && !review?.approved && !detail.reviewApproved && <div className="rounded-lg border border-[#cfd9cb] bg-[#f2f5ef] p-4"><p className="text-sm text-[#445546]">Review both current PDFs above. Approval is recorded against these exact document IDs and content hashes.</p><Button className="mt-3" disabled={!reviewReady || !!working} onClick={() => void approveAndSend()}><ShieldCheck className="mr-2 h-4 w-4" />{working === "approve" ? "Recording approval…" : "Approve and send notification"}</Button>{!reviewReady && <p className="mt-2 text-xs text-[#687568]">Preview and confirm review of both the Deed and Transfer PDF.</p>}</div>}
            {!!detail.pairId && <div className="flex flex-wrap gap-2">
              {!reviewGateHeld && (["failed", "blocked"].includes(detail.preparationState) || detail.jobs?.some((job) => /generation|pdf|prepare|document/i.test(job.kind) && (["failed", "blocked", "dead"].includes(job.status.toLowerCase()) || (job.status.toLowerCase() === "retry" && !!job.lastError)))) && <Button size="sm" variant="outline" disabled={!!working} onClick={() => void pairAction("retry")}><RefreshCw className="mr-1.5 h-4 w-4" />Retry processing</Button>}
              {detail.reviewApproved && detail.canNotify && !fullySigned(detail.signingState) && (existingNotification
                ? <div className="space-y-2"><Button size="sm" variant="outline" disabled={!!working || !existingNotification.id || !existingNotification.cycleId || existingNotification.retryEligible === false} onClick={() => void pairAction("recover-notification")}><Send className="mr-1.5 h-4 w-4" />Recover existing notification</Button><p className="text-xs text-slate-600">Only the existing request is processed. No new cycle or other investor notification is created.{existingNotification.retryEligible === false && existingNotification.availableAt && ` Retry becomes eligible ${new Date(existingNotification.availableAt).toLocaleString()}.`}</p>{existingNotification.lastError && <p className="text-xs text-rose-700">Last failure: {existingNotification.lastError}</p>}</div>
                : <Button size="sm" variant="outline" disabled={!!working} onClick={() => void pairAction("resend")}><Send className="mr-1.5 h-4 w-4" />Resend notification</Button>)}
              {detail.notificationState === "uncertain" && <p className="w-full text-sm text-amber-900">The previous delivery outcome is uncertain. Do not send another invitation until the recorded attempt is reconciled.</p>}
            </div>}
            <details className="rounded-md border border-[#e0e4dc] p-3"><summary className="cursor-pointer text-sm font-medium">Notification history ({detail.notificationHistory?.length || 0})</summary><div className="mt-3 space-y-2">{detail.notificationHistory?.length ? detail.notificationHistory.map((entry) => <div key={entry.id} className="rounded bg-[#f4f5f1] p-2 text-xs"><strong>Cycle {entry.cycleNumber} · {entry.status.replace(/_/g, " ")}</strong> · {new Date(entry.createdAt).toLocaleString()}{entry.sentAt && <p>Accepted by mail service {new Date(entry.sentAt).toLocaleString()} · inbox delivery not confirmed</p>}{entry.lastError && <p className="text-rose-700">{entry.lastError}</p>}</div>) : <p className="text-sm text-[#69746a]">No notification attempts.</p>}</div></details>
            {detail.jobs?.length > 0 && <details className="rounded-md border border-[#e0e4dc] p-3"><summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><Clock3 className="h-4 w-4" />Processing history</summary><div className="mt-2 space-y-2">{detail.jobs.map((job, i) => <div key={`${job.kind}-${i}`} className="text-sm">{job.kind.replace(/_/g, " ")} · {job.status.replace(/_/g, " ")}{job.lastError && <p className="text-rose-700">{job.lastError}</p>}</div>)}</div></details>}
            <details className="rounded-md border border-[#e0e4dc] p-3"><summary className="cursor-pointer text-sm font-medium">Audit and signing history</summary><div className="mt-3 space-y-2">{detail.auditHistory?.map((event) => <div key={event.id} className="rounded bg-[#f4f5f1] p-2 text-xs">{event.eventType.replace(/_/g, " ")} · {new Date(event.createdAt).toLocaleString()} · Actor {event.actorId ?? "system"}</div>)}<Button size="sm" variant="outline" disabled={!!working} onClick={() => void pairAction("audit")}>Load full signing audit</Button></div></details>
            {fullySigned(detail.signingState) && <p className="flex items-start gap-2 text-sm text-teal-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Investor signed. External execution remains a separate process.</p>}
          </div>}
        {error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        {error && detail?.pairId && !review && (detail.canReview || detail.reviewApproved) && <Button variant="outline" disabled={!!working} onClick={() => { reviewRequestSignature.current = ""; setError(""); void requestReview(detail); }}>Retry review details</Button>}
        {result && <pre aria-live="polite" className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#f1f3ee] p-3 text-xs">{result}</pre>}
      </DialogContent>
    </Dialog>
    <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}><DialogContent className="flex h-[90dvh] max-w-5xl flex-col"><DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>Private investor-specific PDF · {propertyName} · Holding #{detail?.reservationId}</DialogDescription></DialogHeader>{preview && <iframe title={preview.title} src={preview.url} className="min-h-0 w-full flex-1 rounded border bg-[#f2f4ef]" />}</DialogContent></Dialog>
  </>;
}