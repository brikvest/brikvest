import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export type FlutterwaveState =
  | "initiated" | "verification_pending" | "failed" | "cancelled"
  | "awaiting_admin" | "reconciliation" | "approved" | "rejected";

export type FlutterwaveAttempt = {
  id: number;
  reservationId: number;
  txRef: string;
  state: FlutterwaveState;
  expectedAmount: string;
  expectedCurrency: string;
  verifiedAmount?: string | null;
  verifiedCurrency?: string | null;
  verifiedAt?: string | null;
  reason?: string | null;
  checkoutUrl?: string;
  checkoutExpiresAt?: string;
  transactionId?: string;
};

export type FlutterwaveReservationData = {
  available: boolean;
  reason: string;
  amount: string;
  currency: string;
  attempts: FlutterwaveAttempt[];
};
export function primaryGatewayAttempt(attempts: FlutterwaveAttempt[] = []) {
  return attempts.find(a => a.verifiedAt && ["awaiting_admin","reconciliation","rejected","approved"].includes(a.state))
    || attempts.find(a => ["awaiting_admin","reconciliation","rejected","approved"].includes(a.state))
    || attempts.find(a => ["initiated","verification_pending"].includes(a.state))
    || attempts[0];
}
export function gatewayBlocksPayment(attempts: FlutterwaveAttempt[] = []) {
  return attempts.some(a => !!a.verifiedAt || ["initiated","verification_pending","awaiting_admin","reconciliation","rejected","approved"].includes(a.state)
    || (!!a.checkoutExpiresAt && Date.parse(a.checkoutExpiresAt)>Date.now()));
}

export const flutterwaveReservationKey = (id: number) =>
  ["/api/payments/flutterwave/reservations", id] as const;
export const flutterwaveAdminKey = ["/api/admin/payments/flutterwave"] as const;

export async function getFlutterwaveReservation(id: number): Promise<FlutterwaveReservationData> {
  const response = await fetch(`/api/payments/flutterwave/reservations/${id}`, { credentials: "include" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load Flutterwave payment status.");
  return data;
}

export function useFlutterwaveReservation(id: number | undefined, enabled = true) {
  return useQuery<FlutterwaveReservationData>({
    queryKey: flutterwaveReservationKey(id || 0),
    queryFn: () => getFlutterwaveReservation(id!),
    enabled: enabled && !!id,
    retry: false,
  });
}

const labels: Record<FlutterwaveState, string> = {
  initiated: "Payment started",
  verification_pending: "Verification pending",
  failed: "Payment failed",
  cancelled: "Payment cancelled",
  awaiting_admin: "Awaiting admin approval",
  reconciliation: "Payment under reconciliation",
  approved: "Payment approved",
  rejected: "Payment rejected",
};

export function FlutterwaveReservationPanel({ reservationId }: { reservationId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useFlutterwaveReservation(reservationId);
  const [checkoutError, setCheckoutError] = useState("");
  const recheck = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/payments/flutterwave/attempts/${id}/recheck`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Verification could not be completed. Do not pay again.");
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes("/api/payments/flutterwave") });
      await queryClient.invalidateQueries({ queryKey: ["/api/user/reservations"] });
    },
    onError: (e: Error) => setCheckoutError(e.message),
  });
  const checkout = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/payments/flutterwave/reservations/${reservationId}/checkout`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start Flutterwave checkout.");
      return result as { checkoutUrl: string };
    },
    onSuccess: async ({ checkoutUrl }) => {
      await queryClient.invalidateQueries({ queryKey: flutterwaveReservationKey(reservationId) });
      window.location.assign(checkoutUrl);
    },
    onError: (e: Error) => setCheckoutError(e.message),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: flutterwaveReservationKey(reservationId) });
    },
  });

  if (isLoading) return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 animate-pulse">Checking online payment availability…</div>;
  if (isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription className="flex items-center justify-between gap-3">Flutterwave status could not be loaded: {error instanceof Error ? error.message : "Please retry."}<Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button></AlertDescription></Alert>;
  if (!data) return null;
  const primary = primaryGatewayAttempt(data.attempts);
  const current = primary && !["failed","cancelled"].includes(primary.state) ? primary : undefined;
  const isCollected = current && ["awaiting_admin", "reconciliation"].includes(current.state);
  const coolingDown = primary && ["failed","cancelled"].includes(primary.state) && !!primary.checkoutExpiresAt && Date.parse(primary.checkoutExpiresAt)>Date.now();
  const canStart = data.available && !current && !coolingDown;

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4" aria-label="Flutterwave payment" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-900">Pay online with Flutterwave</h4>
          <p className="mt-1 text-xs text-slate-600">Secure checkout. Payment does not grant ownership; an admin must approve it.</p>
        </div>
        <ShieldCheck className="h-5 w-5 shrink-0 text-green-700" />
      </div>
      <p className="text-sm font-medium">Exact checkout charge: {data.amount} {data.currency}. No conversion or new gateway surcharge.</p>
      {current && (
        <div className={`rounded-md border p-3 text-sm ${isCollected ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>
          <div className="font-semibold">{labels[current.state]}</div>
          <div className="mt-1">Amount: {current.expectedAmount} {current.expectedCurrency}</div>
          {current.state === "awaiting_admin" && <p className="mt-1">Awaiting admin approval. Your reservation is not ownership until approval.</p>}
          {current.state === "reconciliation" && <p className="mt-1">Payment received but needs reconciliation. Do not pay again; our team will review it.</p>}
          {current.state === "rejected" && <p className="mt-1">No refund has been issued. Contact support; do not pay again.</p>}
          {["initiated", "verification_pending"].includes(current.state) && <p className="mt-1">Check this payment status before paying again. No additional checkout can be started while verification is in progress.</p>}
          {current.reason && <p className="mt-1 text-xs">{current.reason}</p>}
          <Button type="button" size="sm" variant="outline" className="mt-3" disabled={isFetching || recheck.isPending} onClick={() => { setCheckoutError(""); recheck.mutate(current.id); }}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching || recheck.isPending ? "animate-spin" : ""}`} /> Check status
          </Button>
        </div>
      )}
      {!current && data.attempts[0] && ["rejected", "approved"].includes(data.attempts[0].state) && (
        <div className={`rounded-md border p-3 text-sm ${data.attempts[0].state === "rejected" ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}>
          <strong>{labels[data.attempts[0].state]}</strong>
          {data.attempts[0].state === "rejected" && <p className="mt-1">No refund has been issued. Contact support for assistance.</p>}
        </div>
      )}
      {checkoutError && <p role="alert" className="text-sm text-red-700">{checkoutError}</p>}
      {coolingDown && <p className="text-sm text-amber-900">The previous hosted session has not expired. Wait until {new Date(primary.checkoutExpiresAt!).toLocaleString()} before starting another checkout; do not pay twice.</p>}
      {canStart && <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={checkout.isPending} onClick={() => { setCheckoutError(""); checkout.mutate(); }}>
        {checkout.isPending ? "Opening secure checkout…" : "Continue to Flutterwave"}
        {!checkout.isPending && <ExternalLink className="ml-2 h-4 w-4" />}
      </Button>}
      {!data.available && data.reason && <p className="text-xs text-slate-600">{data.reason}</p>}
      {!current && data.attempts.some(a => a.state === "failed" || a.state === "cancelled") && (
        <p className="text-xs text-slate-600">{labels[data.attempts[0].state]}: the provider reports the previous payment did not complete. {coolingDown ? "Wait for the hosted session to expire before retrying." : "You may retry Flutterwave or use bank transfer."}</p>
      )}
    </section>
  );
}

/** Late receipts can belong to expired or already confirmed holdings and must
 * remain visible even when those holdings have no payment action anymore. */
export function FlutterwaveActivity() {
  const { data = [], isError } = useQuery<FlutterwaveAttempt[]>({
    queryKey: ["/api/payments/flutterwave/attempts"],
    queryFn: async () => {
      const response = await fetch("/api/payments/flutterwave/attempts", { credentials: "include" });
      if (!response.ok) throw new Error("Gateway payment history unavailable");
      return response.json();
    },
    retry: false,
    refetchInterval: 30_000,
  });
  if (isError) return <p role="alert" className="mb-4 text-sm text-red-700">Online payment history could not be loaded. Check with support before making another payment.</p>;
  const unresolved = data.filter(a => a.verifiedAt && ["reconciliation", "rejected"].includes(a.state));
  if (!unresolved.length) return null;
  return <section aria-label="Payments needing resolution" aria-live="polite" className="mb-6 space-y-2">
    {unresolved.map(a => <div key={a.id} className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <strong>{labels[a.state]} — reservation #{a.reservationId}</strong>
      <p>Received: {a.verifiedAmount} {a.verifiedCurrency}. Reference: {a.txRef}</p>
      <p>{a.reason} No refund has been issued. Contact support; do not pay again.</p>
    </div>)}
  </section>;
}

type AdminAttempt = FlutterwaveAttempt & {
  reservation?: { id?: number; amount?: string; currency?: string; units?: number };
  property?: { name?: string };
  user?: { email?: string; fullName?: string };
  audit?: Array<{ action?: string; reason?: string; createdAt?: string; actor?: string }>;
  charges?: Array<{ transaction_id: string; amount: string; currency: string; disposition: string }>;
  notification?: { state: string } | null;
  unmatched?: boolean;
  checkoutClosure?: { status: string; attempts: number } | null;
};

export function FlutterwavePaymentReviews({ authenticatedRequest, queryClient, toast }: {
  authenticatedRequest: (url: string, options?: any) => Promise<any>;
  queryClient: any;
  toast: any;
}) {
  const [reasonById, setReasonById] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const { data: attempts = [], isLoading, isError, error, refetch, isFetching } = useQuery<AdminAttempt[]>({
    queryKey: flutterwaveAdminKey,
    queryFn: async () => {
      const response = await authenticatedRequest("/api/admin/payments/flutterwave");
      if (!Array.isArray(response)) throw new Error("Invalid gateway review response.");
      return response;
    },
    retry: false,
  });
  const perform = async (attempt: AdminAttempt, action: "approve" | "reject" | "recheck") => {
    if (action === "reject" && !reasonById[attempt.id]?.trim()) {
      toast({ title: "Reason required", description: "Enter a reason before rejecting this payment.", variant: "destructive" });
      return;
    }
    setBusyId(attempt.id);
    try {
      await authenticatedRequest(`/api/admin/payments/flutterwave/${attempt.id}/${action}`, {
        method: action === "recheck" ? "POST" : "PUT",
        ...(action !== "recheck" ? { body: JSON.stringify({ reason: reasonById[attempt.id]?.trim() || "" }) } : {}),
        ...(action === "recheck" ? { body: JSON.stringify({}) } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: flutterwaveAdminKey });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/payment-submissions"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/investments"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/reservations"] });
      toast({ title: action === "approve" ? "Flutterwave payment approved" : action === "reject" ? "Flutterwave payment rejected" : "Verification requested" });
    } catch (e: any) {
      toast({ title: "Payment action failed", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4 border-t-2 border-slate-200 pt-6" aria-labelledby="flutterwave-reviews-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="flutterwave-reviews-title" className="text-xl font-bold text-slate-900">Flutterwave payments</h2><p className="text-sm text-slate-600">Verified gateway payments remain reservations until you approve them.</p></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={async () => {
          try { await authenticatedRequest("/api/admin/payments/flutterwave/recover", { method: "POST", body: "{}" }); await refetch(); }
          catch (e: any) { toast({ title: "Recovery unavailable", description: e.message, variant: "destructive" }); }
        }}>Recover pending work</Button><Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>
      </div>
      {isLoading ? <div className="space-y-3"><div className="h-24 rounded-lg bg-slate-100 animate-pulse" /><div className="h-24 rounded-lg bg-slate-100 animate-pulse" /></div>
        : isError ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>Could not load Flutterwave reviews: {error instanceof Error ? error.message : "Please retry."}<Button size="sm" variant="outline" className="ml-3" onClick={() => void refetch()}>Retry</Button></AlertDescription></Alert>
        : attempts.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-slate-600">No Flutterwave payment attempts yet.</CardContent></Card>
        : <div className="space-y-3">{attempts.map(attempt => {
          const awaitingApproval = attempt.state === "awaiting_admin";
          const canReject = (awaitingApproval || attempt.state === "reconciliation") && !!attempt.verifiedAt && !attempt.unmatched;
          const statusClass = attempt.state === "awaiting_admin" ? "border-amber-300 bg-amber-50 text-amber-900" : attempt.state === "reconciliation" ? "border-orange-300 bg-orange-50 text-orange-900" : attempt.state === "approved" ? "border-green-300 bg-green-50 text-green-900" : attempt.state === "rejected" || attempt.state === "failed" ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-900";
          return <Card key={attempt.id} className="overflow-hidden"><CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-900">{attempt.property?.name || `Reservation #${attempt.reservationId}`}</h3><Badge variant="outline" className={statusClass}>{labels[attempt.state]}</Badge></div>
                <p className="mt-1 text-sm text-slate-600">{attempt.user?.email || "Investor"}{attempt.reservation?.units ? ` · ${attempt.reservation.units} units` : ""}</p>
                <p className="mt-1 font-mono text-xs text-slate-500">Reference: {attempt.txRef}</p>
                {attempt.transactionId && <p className="mt-1 font-mono text-xs text-slate-500">Provider transaction: {attempt.transactionId}</p>}
              </div>
              <div className="text-right"><p className="text-xs text-slate-500">Expected amount</p><p className="font-semibold">{attempt.expectedAmount} {attempt.expectedCurrency}</p></div>
            </div>
            {attempt.verifiedAmount != null && <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-3">
              <p><span className="text-slate-500">Verified:</span> <strong>{attempt.verifiedAmount} {attempt.verifiedCurrency || ""}</strong></p>
              <p><span className="text-slate-500">Verified at:</span> {attempt.verifiedAt ? new Date(attempt.verifiedAt).toLocaleString() : "Not recorded"}</p>
              <p><span className="text-slate-500">Result:</span> {attempt.state === "awaiting_admin" ? "Awaiting admin approval" : labels[attempt.state]}</p>
            </div>}
            {attempt.reason && <p className="rounded-md border border-slate-200 p-3 text-sm text-slate-700">{attempt.state === "rejected" ? "Rejection reason: " : "Gateway note: "}{attempt.reason}</p>}
            {attempt.state === "rejected" && <p className="text-sm font-medium text-red-800">No refund has been issued. Contact support to resolve any refund request.</p>}
            {attempt.state === "reconciliation" && <p className="text-sm text-orange-900">Reconciliation required. Do not approve until the payment discrepancy is resolved.</p>}
            {attempt.charges && attempt.charges.length > 1 && <ul aria-label="Actual charges" className="text-sm">{attempt.charges.map(c => <li key={c.transaction_id}>Transaction {c.transaction_id}: {c.amount} {c.currency} — {c.disposition}</li>)}</ul>}
            {attempt.notification && <p className="text-xs">Confirmation notification: {attempt.notification.state}{["sending","uncertain"].includes(attempt.notification.state) ? " — delivery requires manual investigation; no automatic resend." : ""}</p>}
            {attempt.checkoutClosure && <p className="text-sm font-medium">Hosted checkout closure: {attempt.checkoutClosure.status === "done" ? "Provider confirmed disabled" : "Pending provider confirmation — do not use this checkout"}{attempt.checkoutClosure.attempts ? ` (${attempt.checkoutClosure.attempts} retry attempts)` : ""}</p>}
            {canReject && <><p className="text-xs text-red-800">Rejecting does not issue a refund. The charge remains unresolved and the investor must not pay again.</p><Textarea aria-label={`Rejection reason for ${attempt.txRef}`} maxLength={1000} rows={2} placeholder="Reason for rejection (required)" value={reasonById[attempt.id] || ""} onChange={e => setReasonById(prev => ({ ...prev, [attempt.id]: e.target.value }))} /></>}
            <fieldset disabled={busyId !== null} className="flex flex-wrap gap-2">
              {awaitingApproval && <Button size="sm" className="bg-green-700 hover:bg-green-800" onClick={() => void perform(attempt, "approve")}><CheckCircle2 className="mr-2 h-4 w-4" />Approve payment</Button>}
              {canReject && <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" disabled={!reasonById[attempt.id]?.trim()} onClick={() => void perform(attempt, "reject")}><XCircle className="mr-2 h-4 w-4" />Reject</Button>}
              {!attempt.unmatched && <Button size="sm" variant="outline" onClick={() => void perform(attempt, "recheck")}><RefreshCw className="mr-2 h-4 w-4" />Recheck with Flutterwave</Button>}
            </fieldset>
            {!!attempt.audit?.length && <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">Audit history ({attempt.audit.length})</summary><ul className="mt-2 space-y-2">{attempt.audit.map((entry, index) => <li key={`${entry.createdAt || "event"}-${index}`} className="text-xs text-slate-600">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "Event"} · {entry.action || "Update"}{entry.actor ? ` by ${entry.actor}` : ""}{entry.reason ? ` — ${entry.reason}` : ""}</li>)}</ul></details>}
          </CardContent></Card>;
        })}</div>}
    </section>
  );
}
