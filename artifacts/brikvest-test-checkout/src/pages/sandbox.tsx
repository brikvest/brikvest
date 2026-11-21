import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, FlaskConical, HelpCircle, MapPin, Plus, RefreshCw, RotateCcw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  type Attempt, type SandboxState, getSandboxState, handleProviderReturn, newReservation,
  recheckAttempt, resetRecords, startCheckout, closeTerminalLink,
} from "@/sandbox-api";

const KEY = ["sandbox-state"] as const;
const RESET_PHRASE = "RESET SYNTHETIC RECORDS";
const MAX_POLLS = 12;
const COLLECTED = ["awaiting_admin", "reconciliation", "rejected", "approved"];
const OPEN = ["initiated", "verification_pending"];

const labels: Record<string, string> = {
  initiated: "Payment started",
  verification_pending: "Verification pending",
  failed: "Payment failed",
  cancelled: "Payment cancelled",
  awaiting_admin: "Payment received — awaiting admin approval",
  reconciliation: "Payment under reconciliation",
  approved: "Marked approved (synthetic)",
  rejected: "Payment rejected",
};
const label = (s: string) => labels[s] || s.replace(/_/g, " ");

function primaryAttempt(a: Attempt[]) {
  return a.find(x => x.verifiedAt && COLLECTED.includes(x.state))
    || a.find(x => COLLECTED.includes(x.state))
    || a.find(x => OPEN.includes(x.state))
    || a[0];
}
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Request failed. Retry; do not pay again.");

function readReturnParams() {
  const p = new URLSearchParams(window.location.search);
  const txRef = p.get("tx_ref");
  if (!txRef) return null;
  return { txRef, transactionId: p.get("transaction_id") || undefined };
}
function clearReturnParams() {
  const url = new URL(window.location.href);
  ["tx_ref", "transaction_id", "status"].forEach(k => url.searchParams.delete(k));
  window.history.replaceState(null, "", url.pathname.replace(/\/dashboard\/?$/, "/") + url.search + url.hash);
}

function TestBanner() {
  return (
    <div role="status" data-testid="banner-test-only" className="sticky top-0 z-40">
      <div className="test-stripes h-1.5" />
      <div className="bg-[hsl(215_25%_17%)] px-4 py-2.5 text-center text-sm text-white">
        <strong className="mr-2 rounded bg-[hsl(43_96%_56%)] px-1.5 py-0.5 text-xs font-bold tracking-wider text-[hsl(215_25%_17%)]">TEST ONLY</strong>
        All records synthetic. No real investment is purchased. This is not the live Brikvest site.
      </div>
    </div>
  );
}

function StatusPill({ state }: { state: string }) {
  const cls = state === "awaiting_admin" || state === "approved" ? "status-active"
    : OPEN.includes(state) || state === "reconciliation" ? "status-pending"
    : state === "failed" || state === "cancelled" || state === "rejected" ? "border border-red-200 bg-red-50 text-red-700"
    : "border border-slate-200 bg-slate-50 text-slate-600";
  return <span data-testid={`status-${state}`} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label(state)}</span>;
}

function ReturnPanel({ onDone }: { onDone: () => void }) {
  const [params, setParams] = useState(readReturnParams);
  const started = useRef(false);
  const verify = useMutation({
    mutationFn: (p: { txRef: string; transactionId?: string }) => handleProviderReturn(p.txRef, p.transactionId),
    onSuccess: () => { clearReturnParams(); setParams(null); onDone(); },
    onSettled: () => onDone(),
  });
  useEffect(() => {
    if (params && !started.current) { started.current = true; verify.mutate(params); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!params && !verify.isSuccess) return null;
  if (verify.isSuccess) return (
    <div className="rise rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900" data-testid="text-return-result">
      <strong>Verification request processed.</strong> {verify.data.message} The redirect status was never trusted.
    </div>
  );
  if (verify.isError && params) return (
    <div role="alert" className="rise flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
      <div><strong>Could not verify your return from the hosted checkout.</strong> {errMsg(verify.error)} Do not pay again. Reference <span className="font-mono">{params.txRef}</span> is preserved for retry.</div>
      <Button size="sm" variant="outline" data-testid="button-retry-return" onClick={() => verify.mutate(params)}><RotateCcw className="mr-2 h-3.5 w-3.5" />Retry verification</Button>
    </div>
  );
  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900" aria-live="polite">
      <RefreshCw className="h-4 w-4 animate-spin" /> Verifying your return with the provider. The redirect status is ignored; only the server's provider check counts.
    </div>
  );
}

function ReservationCard({ r, available, onChanged }: { r: SandboxState["reservations"][number]; available: boolean; onChanged: () => void }) {
  const [error, setError] = useState("");
  const primary = primaryAttempt(r.attempts);
  const current = primary && !["failed", "cancelled"].includes(primary.state) ? primary : undefined;
  const canStart = available && r.attempts.length === 0;
  const checkout = useMutation({
    mutationFn: () => startCheckout(r.id),
    onSuccess: ({ checkoutUrl }) => {
      let ok = false;
      try {
        const url = new URL(checkoutUrl);
        const sandboxHost = url.hostname === "checkout-v2.dev-flutterwave.com";
        ok = url.protocol === "https:" &&
          ["checkout.flutterwave.com", "checkout-v2.dev-flutterwave.com"].includes(url.hostname) &&
          !url.username && !url.password && !url.port &&
          (!sandboxHost || (!url.search && !url.hash && /^\/v3\/hosted\/pay\/[a-zA-Z0-9_-]{1,200}$/.test(url.pathname)));
      } catch { ok = false; }
      if (!ok) { setError("The server returned an invalid checkout link. Checkout creation is uncertain; recheck before trying again."); return; }
      window.location.assign(checkoutUrl);
    },
    onError: e => setError(errMsg(e)),
    onSettled: onChanged,
  });
  const recheck = useMutation({
    mutationFn: (id: number) => recheckAttempt(id),
    onError: e => setError(errMsg(e)),
    onSettled: onChanged,
  });
  const close = useMutation({
    mutationFn: (id: number) => closeTerminalLink(id),
    onError: e => setError(errMsg(e)),
    onSettled: onChanged,
  });
  const collected = current && ["awaiting_admin", "reconciliation"].includes(current.state);

  return (
    <article data-testid={`card-reservation-${r.id}`} className="rise overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900">Synthetic reservation #{r.id}</span>
          <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{r.status.replace(/_/g, " ")}</span>
        </div>
        <span className="text-financial text-slate-900">{r.amount} {r.currency}</span>
      </header>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">Created {fmtDate(r.createdAt)} · exact checkout charge, no conversion or surcharge.</p>

        {current && (
          <div aria-live="polite" className={`rounded-md border p-3 text-sm ${collected ? "border-[hsl(158_64%_52%/.3)] bg-[hsl(158_64%_52%/.08)] text-[hsl(158_64%_22%)]" : current.state === "rejected" ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-900"}`}>
            <div className="flex items-center gap-2 font-semibold">
              {collected ? <CheckCircle2 className="h-4 w-4" /> : current.state === "rejected" ? <XCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              {label(current.state)}
            </div>
            <div className="mt-1">Expected: <span className="text-financial">{current.expectedAmount} {current.expectedCurrency}</span>
              {current.verifiedAmount && <> · Verified: <span className="text-financial">{current.verifiedAmount}</span> at {fmtDate(current.verifiedAt)}</>}</div>
            {current.state === "awaiting_admin" && <p className="mt-1">Payment received — awaiting admin approval. This is not ownership; no holding is created in this sandbox.</p>}
            {current.state === "reconciliation" && <p className="mt-1">Payment received but needs reconciliation. Do not pay again.</p>}
            {current.state === "rejected" && <p className="mt-1">No refund has been issued. Do not pay again.</p>}
            {OPEN.includes(current.state) && <p className="mt-1">A checkout link alone is not a payment. Recheck receipt only checks status; it does not submit a payment. If you already paid on Flutterwave, do not pay again. No additional checkout can start while verification is unresolved.</p>}
            {current.reason && <p className="mt-1 text-xs">{current.reason}</p>}
            <p className="mt-1 break-all font-mono text-[11px] opacity-80" data-testid={`text-txref-${current.id}`}>{current.txRef}</p>
          </div>
        )}

        {!current && primary && ["failed", "cancelled"].includes(primary.state) && (
          <div className="rounded-md border border-slate-200 p-3 text-sm text-slate-700">
            <strong>{label(primary.state)}.</strong> A failed/cancelled transaction alone does not establish that its hosted link cannot collect. No replacement checkout is allowed for this reservation.
            {primary.reason && <p className="mt-1 text-xs">{primary.reason}</p>}
          </div>
        )}

        {primary && (
          <section aria-label="Sandbox checkout recovery" className="space-y-2 rounded-md border bg-muted p-3 text-sm" data-testid={`recovery-${primary.id}`}>
            <h3 className="font-semibold">Recover this test checkout safely</h3>
            <p>{primary.recovery.explanation}</p>
            <dl className="text-xs text-muted-foreground">
              <div>Saved hosted link: {primary.recovery.hasSavedLink ? "retained, not reopened" : "none recorded"}</div>
              <div>Provider charge records: {primary.recovery.chargeCount} · Verified receipt: {primary.verifiedAt ? "recorded" : "none recorded"}</div>
              <div>Original checkout deadline: {fmtDate(primary.checkoutExpiresAt)} — not proof of failure.</div>
              <div className="break-all font-mono">Reference: {primary.txRef}</div>
            </dl>
            <p className="text-xs">{primary.recovery.resumeExplanation}</p>
            <Button size="sm" variant="outline" data-testid={`button-recheck-${primary.id}`} disabled={recheck.isPending || close.isPending}
              onClick={() => { setError(""); recheck.mutate(primary.id); }}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${recheck.isPending ? "animate-spin" : ""}`} />Recheck receipt
            </Button>
            {primary.recovery.canClose && <Button size="sm" variant="outline" className="ml-2" data-testid={`button-close-${primary.id}`}
              disabled={close.isPending || recheck.isPending}
              onClick={() => { setError(""); close.mutate(primary.id); }}>
              {close.isPending ? "Confirming closure…" : "Disable terminal test link"}
            </Button>}
            {recheck.isSuccess && <p role="status" className="text-xs">{recheck.data.message}</p>}
            {close.isSuccess && <p role="status" className="text-xs">{close.data.message}</p>}
            <p className="text-xs">If still unresolved, retain this reference and ask Flutterwave test support to trace it. Do not clear browser storage, reset the store, or pay again to clear this reservation. A new synthetic reservation is a separate test, not recovery of this one.</p>
          </section>
        )}

        {error && <p role="alert" className="text-sm text-red-700" data-testid={`text-error-${r.id}`}>{error}</p>}

        {canStart && (
          <Button data-testid={`button-checkout-${r.id}`} className="cta-primary w-full text-white sm:w-auto" disabled={checkout.isPending}
            onClick={() => { setError(""); checkout.mutate(); }}>
            {checkout.isPending ? "Opening hosted checkout…" : "Continue to Flutterwave test checkout"}
            {!checkout.isPending && <ExternalLink className="ml-2 h-4 w-4" />}
          </Button>
        )}
        {!available && !current && <p className="text-xs text-muted-foreground">Checkout unavailable until setup blockers are resolved.</p>}
        {canStart && <p className="text-xs text-muted-foreground">Complete the test payment on Flutterwave's hosted page, including its test PIN and OTP steps when prompted. Opening checkout or pressing Recheck receipt does not make a payment. Never use a real card.</p>}

        {r.attempts.length > 1 && (
          <details className="border-t pt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-slate-700">All attempts ({r.attempts.length})</summary>
            <ul className="mt-2 space-y-1.5">{r.attempts.map(a => (
              <li key={a.id} className="flex flex-wrap items-center gap-2"><StatusPill state={a.state} /><span className="font-mono">{a.txRef}</span></li>
            ))}</ul>
          </details>
        )}
      </div>
    </article>
  );
}

function Help({ state }: { state?: SandboxState }) {
  return (
    <section id="help" className="rounded-lg border bg-card p-5 text-sm" data-testid="section-help">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900"><HelpCircle className="h-4 w-4 text-primary" />Setup, run and reset</h2>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-slate-600">
        <li>Store dedicated <span className="font-mono text-xs">BRIKVEST_TEST_FLW_SECRET_KEY</span> and <span className="font-mono text-xs">BRIKVEST_TEST_FLW_SECRET_HASH</span> in secure settings. Existing live-site keys are never used.</li>
        <li>Record the main-site review or the owner's explicit waiver, and approve this preview's callback scope. Private browser-return testing does not establish webhook delivery. Flutterwave <strong>test-payment</strong> emails to the business address require the owner's permission, or test notifications must be confirmed disabled. Brikvest's own email and SMS stay disabled. Do not change production settings.</li>
        <li>With owner approval only, point the Flutterwave <strong>test</strong> webhook to this preview origin plus <span className="font-mono text-xs">/brikvest-test-checkout/api/webhook</span>. A private preview may block provider delivery; no access controls have been changed.</li>
        <li>Reload this page. When no blockers remain, create a synthetic reservation and continue to Flutterwave. Select Card and use only Flutterwave's documented test-card details, then complete its PIN and OTP prompts. Never enter API keys or real card details on the hosted page, and never enter any card details in Brikvest.</li>
        <li>After returning in the same browser, the server rechecks the provider. Use Recheck receipt if the state is still pending. Only use instruments from <a href="https://developer.flutterwave.com/docs/testing" target="_blank" rel="noreferrer" className="underline">Flutterwave's official test documentation</a> on Flutterwave's hosted page — never a real card.</li>
        <li>Abandoned checkout? Read its recovery panel and recheck the receipt. No missing dashboard entry or not-found response proves failure. Saved links are retained but cannot be resumed without provider-backed safety evidence.</li>
        <li>For a provider-verified failed/cancelled transaction, use Disable terminal test link. Closure does not prove an earlier submission cannot settle. All checkout evidence stays protected; Reset only removes reservations that have never started checkout.</li>
      </ol>
      {state && (
        <dl className="mt-4 grid gap-2 rounded-md bg-muted p-3 text-xs sm:grid-cols-3">
          <div><dt className="font-semibold text-slate-700">Database</dt><dd className="text-slate-600">{state.safety.database}</dd></div>
          <div><dt className="font-semibold text-slate-700">Mail</dt><dd className="text-slate-600">{state.safety.mail}</dd></div>
          <div><dt className="font-semibold text-slate-700">Ownership</dt><dd className="text-slate-600">{state.safety.ownership}</dd></div>
        </dl>
      )}
    </section>
  );
}

export default function SandboxPage() {
  const qc = useQueryClient();
  const [polls, setPolls] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [actionMsg, setActionMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const q = useQuery({
    queryKey: KEY, queryFn: getSandboxState, retry: false,
    refetchInterval: query => {
      const d = query.state.data;
      const pending = d?.reservations.some(r => r.attempts.some(a => OPEN.includes(a.state)));
      return pending && polls < MAX_POLLS ? 10_000 : false;
    },
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: KEY }); };
  useEffect(() => { if (q.dataUpdatedAt) setPolls(p => p + 1); }, [q.dataUpdatedAt]);

  const create = useMutation({
    mutationFn: newReservation,
    onSuccess: r => setActionMsg({ kind: "ok", text: `Synthetic reservation #${r.id} created.` }),
    onError: e => setActionMsg({ kind: "err", text: errMsg(e) }),
    onSettled: refresh,
  });
  const reset = useMutation({
    mutationFn: resetRecords,
    onSuccess: r => { setActionMsg({ kind: "ok", text: r.message }); setResetOpen(false); setPhrase(""); },
    onError: e => { setActionMsg({ kind: "err", text: errMsg(e) }); setResetOpen(false); },
    onSettled: refresh,
  });

  const d = q.data;
  const pendingCount = d?.reservations.filter(r => r.attempts.some(a => OPEN.includes(a.state))).length ?? 0;
  const resetEligible = !!d?.reservations.length && d.reservations.every(r => r.attempts.every(a => a.recovery.resetEligible));

  return (
    <div className="min-h-[100dvh] bg-muted">
      <TestBanner />
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}brand/brikvest-logo.png`} alt="Brikvest" className="h-8 w-auto" data-testid="img-logo" />
            <span className="hidden items-center gap-1 rounded-full border border-[hsl(43_96%_56%/.5)] bg-[hsl(43_96%_56%/.12)] px-2.5 py-0.5 text-xs font-semibold text-[hsl(43_96%_28%)] sm:inline-flex"><FlaskConical className="h-3 w-3" />Test checkout</span>
          </div>
          <a href="#help" className="text-sm font-medium text-primary hover:underline" data-testid="link-help">Setup help</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <ReturnPanel onDone={refresh} />

        {q.isLoading && (
          <div className="space-y-4" aria-busy="true">
            <div className="skeleton h-40 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-28 animate-pulse rounded-lg bg-slate-200" />
          </div>
        )}

        {q.isError && (
          <div role="alert" className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />Sandbox state could not be loaded: {errMsg(q.error)}</div>
            <Button size="sm" variant="outline" data-testid="button-retry-state" disabled={q.isFetching} onClick={() => void q.refetch()}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />Retry
            </Button>
          </div>
        )}

        {d && (
          <>
            <section className="rise grid overflow-hidden rounded-lg border bg-card md:grid-cols-[1.3fr_1fr]">
              <div className="relative flex min-h-48 flex-col justify-end bg-[linear-gradient(135deg,hsl(224_76%_48%)_0%,hsl(224_76%_35%)_100%)] p-6 text-white">
                <div aria-hidden className="absolute inset-0 opacity-[.12] [background-image:linear-gradient(hsl(0_0%_100%)_1px,transparent_1px),linear-gradient(90deg,hsl(0_0%_100%)_1px,transparent_1px)] [background-size:28px_28px]" />
                <span className="relative mb-2 w-fit rounded bg-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider">Fictional plot · synthetic</span>
                <h1 className="relative text-2xl font-bold md:text-3xl" data-testid="text-property-name">{d.property.name}</h1>
                <p className="relative mt-1 flex items-center gap-1 text-sm text-white/80"><MapPin className="h-3.5 w-3.5" />{d.property.location}</p>
              </div>
              <dl className="grid grid-cols-3 divide-x border-t md:grid-cols-1 md:divide-x-0 md:divide-y md:border-l md:border-t-0">
                {[["Unit price", d.property.unitPrice], ["Units", String(d.property.units)], ["Area", `${d.property.area} m²`]].map(([k, v]) => (
                  <div key={k} className="p-4"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-financial text-lg text-slate-900">{v}</dd></div>
                ))}
              </dl>
            </section>

            <section className={`rounded-lg border p-4 text-sm ${d.setup.available ? "status-active" : "status-pending"}`} data-testid="section-setup">
              <div className="flex items-center gap-2 font-semibold">
                {d.setup.available ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {d.setup.available ? "Hosted test checkout is ready" : "Checkout is blocked until setup is complete"}
              </div>
              {d.setup.blockers.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-6">{d.setup.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
              <p className="mt-2 text-xs" data-testid="text-provider-email-policy">{d.setup.providerEmailPolicy}</p>
              <p className="mt-2 text-xs" data-testid="text-test-scope">{d.setup.scopeNotice}</p>
              <p className="mt-2 text-xs opacity-80">Provider evidence: {d.setup.providerEvidence}</p>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Your synthetic reservations</h2>
                  <p className="text-xs text-muted-foreground">
                    {pendingCount > 0 ? (polls < MAX_POLLS ? "Auto-refreshing while verification is pending." : "Auto-refresh paused. Use Recheck receipt or Refresh.") : "Owned by this browser session only."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" data-testid="button-refresh" disabled={q.isFetching} onClick={() => { setPolls(0); void q.refetch(); }}>
                    <RefreshCw className={`mr-2 h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />Refresh
                  </Button>
                  <Button size="sm" data-testid="button-new-reservation" disabled={create.isPending} onClick={() => { setActionMsg(null); create.mutate(); }}>
                    <Plus className="mr-2 h-3.5 w-3.5" />{create.isPending ? "Creating…" : "New synthetic reservation"}
                  </Button>
                  <Button size="sm" variant="outline" data-testid="button-open-reset" className="border-red-200 text-red-700 hover:bg-red-50" disabled={!resetEligible} onClick={() => setResetOpen(true)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" />Reset
                  </Button>
                </div>
              </div>
              {!resetEligible && <p className="text-xs text-muted-foreground">Reset is locked because checkout evidence must be retained, even after terminal link closure. Use the recovery panel below.</p>}

              {actionMsg && <p role={actionMsg.kind === "err" ? "alert" : "status"} data-testid="text-action-message" className={`text-sm ${actionMsg.kind === "err" ? "text-red-700" : "text-[hsl(158_64%_28%)]"}`}>{actionMsg.text}</p>}

              {d.reservations.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-card p-10 text-center" data-testid="empty-reservations">
                  <FlaskConical className="mx-auto h-8 w-8 text-primary/60" />
                  <p className="mt-3 font-semibold text-slate-900">No synthetic reservations yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Create one to rehearse the hosted payment flow. Fixed at one unit; nothing touches investor holdings.</p>
                  <Button className="cta-primary mt-4 text-white" data-testid="button-empty-create" disabled={create.isPending} onClick={() => create.mutate()}>
                    <Plus className="mr-2 h-4 w-4" />Create synthetic reservation
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {d.reservations.map(r => <ReservationCard key={r.id} r={r} available={d.setup.available} onChanged={refresh} />)}
                </div>
              )}
            </section>
          </>
        )}

        <Help state={d} />
      </main>

      <AlertDialog open={resetOpen} onOpenChange={o => { setResetOpen(o); if (!o) setPhrase(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session's synthetic records?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes only this session's reservations that have never started checkout. Any checkout attempt blocks this session reset: terminal status, link closure and an elapsed deadline cannot establish that a prior submission will never settle. Payment evidence cannot be deleted. This is not cancellation or a refund. Type <span className="font-mono font-semibold text-slate-900">{RESET_PHRASE}</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={phrase} onChange={e => setPhrase(e.target.value)} placeholder={RESET_PHRASE} className="font-mono" data-testid="input-reset-phrase" autoComplete="off" />
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-reset" className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={phrase !== RESET_PHRASE || reset.isPending}
              onClick={e => { e.preventDefault(); reset.mutate(); }}>
              {reset.isPending ? "Resetting…" : "Reset synthetic records"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
