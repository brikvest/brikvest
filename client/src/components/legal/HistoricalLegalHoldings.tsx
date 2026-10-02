import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, FileCheck2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage } from "@/lib/queryClient";

type Request = (url: string, options?: any) => Promise<any>;
type HistoricalHolding = {
  reservationId: number;
  userName: string;
  userEmail: string;
  units: string;
  amount: string;
  currency: string;
  pairId: number | null;
  preparationState: string;
  signingState: string;
  notificationState: string;
  canPrepare: boolean;
  requiresAttestation: boolean;
  canNotify: boolean;
  reviewToken: string;
  auditHistory?: { id: number; eventType: string; actorId?: number; createdAt: string; details: unknown }[];
  blockers: string[];
  lastError?: string;
  notificationHistory: { id: number; cycleNumber: number; status: string; lastError?: string; createdAt: string; sentAt?: string }[];
  jobs: { kind: string; status: string; lastError?: string }[];
};
type Template = { id: number; documentType: string; version: number };
type HoldingResponse = { items: HistoricalHolding[]; total: number; page: number; pageSize: number; templates: Template[]; propertyName: string };
type PrepareResult = { reservationId: number; state: "queued" | "notification_queued" | "not_queued" | "existing" | "blocked" | "failed"; pairId?: number; reason?: string };
type AttestationDraft = { confirmed: boolean; amountNaira: string; auditNote: string };

const pageSize = 20;
const activeJob = (status: string) => ["queued", "leased", "retry"].includes(status.toLowerCase());
const jobState = (status: string) => ({ leased: "processing", retry: "failed — retry queued", dead: "failed — recovery required", complete: "complete" }[status] || status.replace(/_/g, " "));
const fullySigned = (state: string) => state.toLowerCase() === "investor_signed";
const money = (amount: string, currency: string) => `${currency} ${amount}`;
const templateName = (type: string) => type === "deed_of_assignment" ? "Deed of Assignment" : type === "transfer_exit_rights" ? "Transfer and Exit Rights Agreement" : type;
const decimalText = (value: string) => {
  const [whole, fraction = ""] = value.trim().split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return whole.replace(/^0+(?=\d)/, "") + (normalizedFraction ? `.${normalizedFraction}` : "");
};

export function HistoricalLegalHoldings({ propertyId, propertyName, authenticatedRequest }: { propertyId: number; propertyName: string; authenticatedRequest: Request }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [attestations, setAttestations] = useState<Record<number, AttestationDraft>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{ deed: Template; transfer: Template; holdings: HistoricalHolding[] } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [results, setResults] = useState<PrepareResult[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const query = useQuery<HoldingResponse>({
    queryKey: ["/api/admin/legal/historical-holdings", propertyId, search, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ propertyId: String(propertyId), search, page: String(page), pageSize: String(pageSize) });
      return authenticatedRequest(`/api/admin/legal/historical-holdings?${params.toString()}`);
    },
    refetchInterval: (current) => current.state.data?.items.some((holding) => holding.jobs.some((job) => activeJob(job.status))) ? 5000 : false,
  });
  const items = query.data?.items || [];
  const templates = query.data?.templates || [];
  const deed = templates.find((template) => template.documentType === "deed_of_assignment");
  const transfer = templates.find((template) => template.documentType === "transfer_exit_rights");
  const chosen = useMemo(() => items.filter((item) => selected.includes(item.reservationId)), [items, selected]);
  const canSubmit = !!deed && !!transfer && selected.length > 0 && chosen.length === selected.length &&
    chosen.every((holding) => holding.canPrepare && (!holding.requiresAttestation || validAttestation(holding, attestations[holding.reservationId])));

  function validAttestation(holding: HistoricalHolding, draft?: AttestationDraft) {
    return !!draft?.confirmed && draft.amountNaira.trim() !== "" &&
      /^\d+(?:\.\d{1,2})?$/.test(draft.amountNaira.trim()) &&
      decimalText(draft.amountNaira) === decimalText(holding.amount) && holding.currency.toUpperCase() === "NGN" &&
      !!draft.auditNote.trim();
  }
  function toggleSelection(holding: HistoricalHolding, checked: boolean) {
    setSelected((current) => checked
      ? current.length >= 20 || current.includes(holding.reservationId) ? current : [...current, holding.reservationId]
      : current.filter((id) => id !== holding.reservationId));
  }
  function updateAttestation(id: number, patch: Partial<AttestationDraft>) {
    setAttestations((current) => ({ ...current, [id]: { ...(current[id] || { confirmed: false, amountNaira: "", auditNote: "" }), ...patch } }));
  }
  async function prepare() {
    if (working || !confirmation || !canSubmit) return;
    setWorking("prepare");
    setActionError("");
    try {
      const response = await authenticatedRequest("/api/admin/legal/historical-holdings/prepare", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          confirmed: true,
          templateIds: { deed: confirmation.deed.id, transfer: confirmation.transfer.id },
          holdings: confirmation.holdings.map((holding) => ({
            reservationId: holding.reservationId,
            reviewToken: holding.reviewToken,
            ...(holding.requiresAttestation ? { attestation: {
              fullPaymentConfirmed: true,
              amountNaira: attestations[holding.reservationId].amountNaira.trim(),
              currency: "NGN",
              auditNote: attestations[holding.reservationId].auditNote.trim(),
            } } : {}),
          })),
        }),
      });
      if (!mounted.current) return;
      setResults(response?.results || []);
      setSelected([]);
      setConfirmOpen(false);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/legal/documents", propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/legal/failures", propertyId] }),
      ]);
    } catch {
      if (mounted.current) setActionError("Preparation could not be confirmed. Refresh this property before retrying; an existing pair may already have been created.");
    } finally { if (mounted.current) setWorking(null); }
  }
  async function notify(holding: HistoricalHolding) {
    if (!holding.pairId || !holding.canNotify || fullySigned(holding.signingState)) return;
    setWorking(`notify-${holding.reservationId}`);
    setActionError("");
    try {
      const response = await authenticatedRequest(`/api/admin/legal/pairs/${holding.pairId}/resend`, {
        method: "POST", body: JSON.stringify({ propertyId }),
      });
      if (!mounted.current) return;
      setResults([{ reservationId: holding.reservationId, state: response?.queued ? "notification_queued" : response?.state === "blocked_uncertain" ? "blocked" : "not_queued", pairId: holding.pairId, reason: response?.message || "Check notification history; inbox delivery is not confirmed." }]);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/legal/documents", propertyId] }),
      ]);
    } catch (error) {
      if (mounted.current) setActionError(getApiErrorMessage(error, `Notification could not be confirmed for holding #${holding.reservationId}. Refresh its notification history before retrying.`));
    } finally { if (mounted.current) setWorking(null); }
  }

  const totalPages = Math.max(1, Math.ceil((query.data?.total || 0) / pageSize));
  const needsPolling = items.some((holding) => holding.jobs.some((job) => activeJob(job.status)));
  const resultLabels: Record<PrepareResult["state"], string> = { queued: "Preparation queued", notification_queued: "Notification queued", not_queued: "No notification queued", existing: "Existing pair retained", blocked: "Blocked", failed: "Failed" };

  return <Card>
    <CardHeader>
      <CardTitle className="text-lg">Historical legal holdings</CardTitle>
      <CardDescription>Prepare documents for confirmed purchases, including holdings without a document pair. Preparation creates new records; it never edits or replaces retained evidence.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="rounded-md border border-blue-100 bg-blue-50/70 p-3 text-sm text-blue-950">
        <p className="font-medium">Property-isolated preparation</p>
        <p className="mt-1 text-blue-900">Search and opening this workspace are read-only. Select up to 20 eligible holdings, then confirm this property and the exact template versions before creating document pairs.</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input aria-label="Search historical holdings" placeholder="Search investor name or email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); setSelected([]); setResults([]); }} />
        <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
      {actionError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mr-2 inline h-4 w-4" />{actionError}</div>}
      {results.length > 0 && <div aria-live="polite" className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-800">Action results</p>
        {results.map((result) => <p key={`${result.reservationId}-${result.state}`} className="text-sm text-slate-700"><Badge variant="outline" className="mr-2">{resultLabels[result.state]}</Badge>Holding #{result.reservationId}{result.pairId ? ` · Pair #${result.pairId}` : ""}{result.reason ? ` · ${result.reason}` : ""}</p>)}
      </div>}
      {query.isLoading ? <div role="status" aria-label="Loading historical holdings" className="space-y-3"><div className="h-24 animate-pulse rounded-md bg-slate-100" /><div className="h-24 animate-pulse rounded-md bg-slate-100" /></div>
        : query.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>Could not load historical holdings for {propertyName}.</span><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>
          : !items.length ? <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><FileCheck2 className="mx-auto mb-2 h-6 w-6 text-blue-700" /><h3 className="text-sm font-medium text-slate-800">{query.data?.total ? "No matching holdings" : "No confirmed historical holdings"}</h3><p className="mt-1 text-sm text-slate-600">{query.data?.total ? "Try another investor name or holding ID." : "Confirmed purchases for this property will appear here, including those without a document pair."}</p></div>
            : <div className="space-y-3">{items.map((holding) => {
              const isSelected = selected.includes(holding.reservationId);
              const stateAllowsNotify = holding.canNotify && !!holding.pairId && !fullySigned(holding.signingState);
              const attestation = attestations[holding.reservationId] || { confirmed: false, amountNaira: "", auditNote: "" };
              return <article key={holding.reservationId} data-holding-id={holding.reservationId} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Checkbox aria-label={`Select holding ${holding.reservationId} for preparation`} checked={isSelected} disabled={!holding.canPrepare || (!isSelected && selected.length >= 20)} onCheckedChange={(value) => toggleSelection(holding, value === true)} />
                    <div><h3 className="font-semibold text-slate-900">{holding.userName || "Investor"}</h3><p className="mt-1 break-all text-xs text-slate-500">{holding.userEmail} · Holding #{holding.reservationId}</p><p className="mt-1 text-sm text-slate-700">{holding.units} {Number(holding.units) === 1 ? "unit" : "units"} · {money(holding.amount, holding.currency)}</p></div>
                  </div>
                  <div className="flex flex-wrap gap-1.5"><Badge variant="outline">{holding.pairId ? `Pair #${holding.pairId}` : "No pair yet"}</Badge><Badge className={holding.canPrepare ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700"}>{holding.preparationState.replace(/_/g, " ")}</Badge></div>
                </div>
                {holding.blockers.length > 0 && <ul className="mt-3 space-y-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{holding.blockers.map((blocker, index) => <li key={index} className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{blocker}</li>)}</ul>}
                {holding.lastError && <p className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-800"><strong>Last processing error:</strong> {holding.lastError}</p>}
                {isSelected && holding.requiresAttestation && <div className="mt-4 space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-sm font-semibold text-amber-950">Payment attestation required</p>
                  <p className="text-xs text-amber-900">This holding requires a recorded confirmation of full payment. Enter the persisted NGN amount exactly and leave an audit note. This attestation does not change payment records.</p>
                  <label className="flex items-start gap-2 text-sm text-slate-800"><Checkbox checked={attestation.confirmed} onCheckedChange={(value) => updateAttestation(holding.reservationId, { confirmed: value === true })} /><span>I reviewed the record and confirm full payment.</span></label>
                  <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor={`attest-amount-${holding.reservationId}`}>Confirmed amount (NGN)</Label><Input id={`attest-amount-${holding.reservationId}`} inputMode="decimal" value={attestation.amountNaira} onChange={(event) => updateAttestation(holding.reservationId, { amountNaira: event.target.value })} placeholder={`Type ${holding.currency === "NGN" ? holding.amount : "NGN amount"}`} aria-describedby={`amount-hint-${holding.reservationId}`} /><p id={`amount-hint-${holding.reservationId}`} className="text-xs text-slate-600">Persisted holding amount: {money(holding.amount, holding.currency)}. Currency must be NGN.</p></div>
                    <div className="space-y-1"><Label htmlFor={`attest-note-${holding.reservationId}`}>Audit note</Label><Textarea id={`attest-note-${holding.reservationId}`} value={attestation.auditNote} onChange={(event) => updateAttestation(holding.reservationId, { auditNote: event.target.value })} placeholder="Record what you reviewed" rows={3} /></div>
                  </div>
                  {!!attestation.amountNaira && Number(attestation.amountNaira) !== Number(holding.amount) && <p role="alert" className="text-xs font-medium text-red-700">Amount must match the persisted holding amount exactly.</p>}
                </div>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {holding.pairId && <p className="mr-auto text-xs text-slate-600">Preparation: {holding.preparationState.replace(/_/g, " ")} · Signing: {holding.signingState.replace(/_/g, " ")} · Notification: {holding.notificationState.replace(/_/g, " ")}</p>}
                  {holding.canPrepare && <span className="text-xs text-blue-800">Select to prepare with the current confirmed templates.</span>}
                  {!!holding.pairId && <Button size="sm" variant="outline" disabled={!stateAllowsNotify || !!working} onClick={() => void notify(holding)}><Send className="mr-1.5 h-4 w-4" />{working === `notify-${holding.reservationId}` ? "Queueing…" : "Send notification"}</Button>}
                </div>
                {!!holding.pairId && fullySigned(holding.signingState) && <p className="mt-2 text-xs text-slate-600">Both documents are investor-signed. No request to sign again is available; external execution remains separate.</p>}
                {holding.notificationState === "uncertain" && <p className="mt-2 text-xs text-amber-900">Mail acceptance is uncertain. No new invitation can be queued until the prior attempt is reconciled through the existing audited recovery process.</p>}
                {!!holding.auditHistory?.length && <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Holding audit history</summary>{holding.auditHistory.map((event) => <div key={event.id} className="mt-2 rounded bg-slate-50 p-2"><p>{event.eventType.replace(/_/g, " ")} · {new Date(event.createdAt).toLocaleString()} · Admin/system actor {event.actorId ?? "system"}</p><pre className="mt-1 whitespace-pre-wrap break-words">{JSON.stringify(event.details, null, 2)}</pre></div>)}</details>}
                {holding.notificationHistory.length > 0 && <details className="mt-3 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-medium text-slate-600">Notification history ({holding.notificationHistory.length})</summary><div className="mt-2 space-y-2">{holding.notificationHistory.map((entry) => <div key={entry.id} className="rounded bg-slate-50 p-2 text-xs text-slate-700"><p><strong>Cycle {entry.cycleNumber} · {entry.status.replace(/_/g, " ")}</strong> · {new Date(entry.createdAt).toLocaleString()}</p>{entry.status.toLowerCase() === "sent" && <p className="mt-1 font-medium text-blue-800">Sent to mail service — inbox delivery not confirmed.</p>}{entry.sentAt && <p>Accepted at {new Date(entry.sentAt).toLocaleString()}</p>}{entry.lastError && <p className="mt-1 text-red-700">Error: {entry.lastError}</p>}</div>)}</div></details>}
                {holding.jobs.length > 0 && <div className="mt-3 space-y-2 rounded-md border border-slate-100 bg-slate-50 p-3"><p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Clock3 className="h-3.5 w-3.5" />Background jobs {needsPolling && <span className="font-normal text-slate-500">· refreshing every 5 seconds while active</span>}</p>{holding.jobs.map((job, index) => <div key={`${job.kind}-${index}`} className="text-xs text-slate-600"><p>{job.kind.replace(/_/g, " ")} · {jobState(job.status)}</p>{job.lastError && <p className="mt-1 text-red-700">{job.lastError}</p>}{["failed", "blocked", "dead"].includes(job.status.toLowerCase()) && <p className="mt-1 text-slate-500">Review the error and recorded failure guidance above. Correct the source issue and use the existing pair recovery controls below; preparation cannot replace a retained pair. Avoid retries while work is queued.</p>}</div>)}</div>}
              </article>;
            })}</div>}
      {!query.isLoading && !query.isError && (query.data?.total || 0) > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><p className="text-xs text-slate-500">Page {page} of {totalPages} · {query.data?.total} confirmed holdings</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => { setPage((current) => current - 1); setSelected([]); }}>Previous</Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => { setPage((current) => current + 1); setSelected([]); }}>Next</Button></div></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="text-xs text-slate-600"><p className="font-medium text-slate-800">{selected.length} of 20 selected</p><p className="mt-1">Deed: {deed ? `v${deed.version}` : "not available"} · Transfer: {transfer ? `v${transfer.version}` : "not available"}</p></div>
        <Button disabled={!canSubmit || !!working} onClick={() => { setActionError(""); setConfirmation({ deed: deed!, transfer: transfer!, holdings: chosen.map((h) => ({ ...h })) }); setConfirmOpen(true); }}><ShieldCheck className="mr-2 h-4 w-4" />Review preparation</Button>
      </div>
      {(!deed || !transfer) && <p className="text-xs text-amber-800">Both current property templates are required before preparing holdings.</p>}
      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!working) setConfirmOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm historical preparation</DialogTitle><DialogDescription>This action creates documents for the selected holdings only. Existing pairs, pinned template versions, signed files and audit evidence remain unchanged.</DialogDescription></DialogHeader>
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p><strong>Destination property:</strong> {propertyName} · #{propertyId}</p>
            <p><strong>Deed template:</strong> {confirmation?.deed.id ?? "Unavailable"} · version {confirmation?.deed.version ?? "—"}</p>
            <p><strong>Transfer template:</strong> {confirmation?.transfer.id ?? "Unavailable"} · version {confirmation?.transfer.version ?? "—"}</p>
            <div><strong>Confirmed holdings:</strong><ul className="mt-1 list-inside list-disc">{confirmation?.holdings.map((holding) => <li key={holding.reservationId}>#{holding.reservationId} · {holding.userName} · {holding.userEmail} · {holding.requiresAttestation ? "Explicit audited full-payment attestation" : "Approved full-payment evidence"}</li>)}</ul></div>
            <p className="flex items-start gap-2 text-xs"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />This confirmation is property-scoped and does not change retained evidence.</p>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={!!working} onClick={() => setConfirmOpen(false)}>Cancel</Button><Button disabled={!canSubmit || !!working} onClick={() => void prepare()}>{working === "prepare" ? "Preparing…" : "Confirm and prepare"}</Button></div>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
