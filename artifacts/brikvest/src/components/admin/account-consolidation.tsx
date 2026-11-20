import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, Loader2, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage } from "@/lib/queryClient";

type Identity = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  kycStatus: string | null;
  kycFullName: string | null;
  kycDateOfBirth: string | null;
  kycIdType: string | null;
  kycIdNumber: string | null;
  emailVerified: boolean;
  isActive: boolean;
};

type ConsolidationPreview = {
  source: Identity;
  destination: Identity;
  holdings: Array<Record<string, unknown>>;
  certificates: Array<Record<string, unknown>>;
  blockers: string[];
  previewToken: string;
};

type ConsolidationResult = {
  auditId: string | number;
  holdingIds: number[];
  sourceId: number;
  destinationId: number;
};

type Props = {
  authenticatedRequest: (url: string, options?: any) => Promise<any>;
};

const safeError = (error: unknown, fallback: string) => getApiErrorMessage(error, fallback);
const prettyDate = (value: unknown) => {
  if (!value) return "Not provided";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
};
const maskId = (value: string | null | undefined) => {
  if (!value?.trim()) return "Not provided";
  const compact = value.trim();
  return compact.length <= 4 ? "••••" : `••••${compact.slice(-4)}`;
};
const displayValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};
const certificateLabel = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const isSensitiveCertificateField = (key: string) => /(?:kyc_?)?(?:id_?number|government_?id|date_?of_?birth|dob)/i.test(key);

function IdentityPanel({ identity, role }: { identity: Identity; role: "Source account" | "Destination account" }) {
  const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(" ") || "Name not provided";
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{role}</p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">{fullName}</h3>
        </div>
        <Badge variant="outline" className={identity.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-100 text-slate-600"}>
          {identity.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">Account ID</dt><dd className="mt-0.5 font-medium text-slate-800">{identity.id}</dd></div>
        <div><dt className="text-xs text-slate-500">Email</dt><dd className="mt-0.5 break-all font-medium text-slate-800">{identity.email || "Not provided"}</dd></div>
        <div><dt className="text-xs text-slate-500">Email verification</dt><dd className="mt-0.5 text-slate-800">{identity.emailVerified ? "Verified" : "Not verified"}</dd></div>
        <div><dt className="text-xs text-slate-500">KYC status</dt><dd className="mt-0.5 text-slate-800">{identity.kycStatus || "Not submitted"}</dd></div>
        <div><dt className="text-xs text-slate-500">KYC legal name</dt><dd className="mt-0.5 text-slate-800">{identity.kycFullName || "Not provided"}</dd></div>
        <div><dt className="text-xs text-slate-500">Date of birth</dt><dd className="mt-0.5 text-slate-800">{prettyDate(identity.kycDateOfBirth)}</dd></div>
        <div><dt className="text-xs text-slate-500">Government ID type</dt><dd className="mt-0.5 text-slate-800">{identity.kycIdType || "Not provided"}</dd></div>
        <div><dt className="text-xs text-slate-500">Government ID number</dt><dd className="mt-0.5 font-mono text-slate-800">{maskId(identity.kycIdNumber)}</dd></div>
      </dl>
    </section>
  );
}

export function AccountConsolidation({ authenticatedRequest }: Props) {
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [preview, setPreview] = useState<ConsolidationPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [identityVerified, setIdentityVerified] = useState(false);
  const [verificationNote, setVerificationNote] = useState("");
  const [updateContactEmail, setUpdateContactEmail] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<ConsolidationResult | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);

  const sourceNumber = Number(sourceId);
  const destinationNumber = Number(destinationId);
  const idsValid = /^\d+$/.test(sourceId.trim()) && Number.isSafeInteger(sourceNumber) && sourceNumber > 0 &&
    /^\d+$/.test(destinationId.trim()) && Number.isSafeInteger(destinationNumber) && destinationNumber > 0 && sourceNumber !== destinationNumber;
  const expectedConfirmation = `CONSOLIDATE ${sourceNumber} INTO ${destinationNumber}`;
  const destinationEmailCanBeUsed = !!preview?.destination.emailVerified;
  const isBlocked = (preview?.blockers.length ?? 0) > 0;
  const canSubmit = !!preview && !isBlocked && identityVerified &&
    verificationNote.trim().length >= 20 && verificationNote.trim().length <= 1000 &&
    confirmation === expectedConfirmation && (!updateContactEmail || destinationEmailCanBeUsed);
  const movingHoldings = useMemo(() => (preview?.holdings || []).filter(holding => holding.user_id === preview?.source.id), [preview]);
  const totalUnits = useMemo(() => movingHoldings.reduce((sum, holding) => sum + (Number(holding.units) || 0), 0), [movingHoldings]);

  const clearPreview = () => {
    setPreview(null);
    setPreviewError("");
    setIdentityVerified(false);
    setVerificationNote("");
    setUpdateContactEmail(false);
    setConfirmation("");
    setSubmitError("");
    setResult(null);
    requestIdRef.current = null;
  };

  const editSourceId = (value: string) => {
    setSourceId(value);
    clearPreview();
  };
  const editDestinationId = (value: string) => {
    setDestinationId(value);
    clearPreview();
  };

  const handlePreview = async () => {
    if (!idsValid || previewing || submitting) return;
    setPreviewing(true);
    clearPreview();
    try {
      const response = await authenticatedRequest("/api/admin/account-consolidations/preview", {
        method: "POST",
        body: JSON.stringify({ sourceId: sourceNumber, destinationId: destinationNumber }),
      });
      if (!response?.source || !response?.destination || !Array.isArray(response.holdings) ||
          !Array.isArray(response.certificates) || !Array.isArray(response.blockers) || !response.previewToken) {
        setPreviewError("The server returned an incomplete preview. Please try again.");
        return;
      }
      setPreview(response as ConsolidationPreview);
    } catch (error) {
      setPreviewError(safeError(error, "Unable to prepare the consolidation preview. Please try again."));
    } finally {
      setPreviewing(false);
    }
  };

  const handleConsolidate = async () => {
    if (!canSubmit || submitLockRef.current || !preview) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    const requestId = requestIdRef.current || crypto.randomUUID();
    requestIdRef.current = requestId;
    try {
      const response = await authenticatedRequest("/api/admin/account-consolidations", {
        method: "POST",
        body: JSON.stringify({
          sourceId: sourceNumber,
          destinationId: destinationNumber,
          previewToken: preview.previewToken,
          identityVerified: true,
          verificationNote: verificationNote.trim(),
          updateContactEmail,
          confirmation,
          requestId,
        }),
      });
      setResult(response as ConsolidationResult);
      requestIdRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users/portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/kyc/submissions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/legal"] }),
      ]);
    } catch (error) {
      setSubmitError(safeError(error, "Consolidation was not confirmed. Retry this same request or contact an administrator before starting another."));
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Card className="mt-8 border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-slate-50/70">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-blue-100 p-2 text-blue-800"><Users className="h-5 w-5" /></div>
          <div>
            <CardTitle className="text-xl text-slate-900">Account consolidation</CardTitle>
            <CardDescription className="mt-1 max-w-3xl leading-relaxed text-slate-600">
              Move eligible confirmed holdings to the destination account. Review identity and historical evidence before authorizing; this does not transfer resale listings or send notifications.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-4 sm:p-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Only proceed after independently verifying the same legal name, government ID type and number, and date of birth. Do not infer identity from a shared first name. Approved destination KYC is preserved; historical certificate evidence remains retained.</p></div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="consolidation-source">Source account ID</Label>
            <Input id="consolidation-source" inputMode="numeric" type="number" min="1" step="1" value={sourceId} onChange={(event) => editSourceId(event.target.value)} disabled={previewing || submitting} placeholder="Integer account ID" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="consolidation-destination">Destination account ID</Label>
            <Input id="consolidation-destination" inputMode="numeric" type="number" min="1" step="1" value={destinationId} onChange={(event) => editDestinationId(event.target.value)} disabled={previewing || submitting} placeholder="Integer account ID" />
          </div>
        </div>
        {sourceId && destinationId && sourceNumber === destinationNumber && <p className="text-sm text-red-700">Source and destination must be different accounts.</p>}
        <Button onClick={handlePreview} disabled={!idsValid || previewing || submitting} className="bg-blue-800 text-white hover:bg-blue-900">
          {previewing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Preparing preview</> : <><ShieldCheck className="mr-2 h-4 w-4" />Review accounts</>}
        </Button>
        {previewError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{previewError}</div>}

        {preview && (
          <div className="space-y-6 border-t border-slate-200 pt-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
              <IdentityPanel identity={preview.source} role="Source account" />
              <ArrowRight className="mx-auto hidden h-5 w-5 text-slate-400 lg:block" />
              <IdentityPanel identity={preview.destination} role="Destination account" />
            </div>

            {isBlocked && (
              <section role="alert" className="rounded-md border border-red-200 bg-red-50 p-4">
                <h3 className="flex items-center gap-2 font-semibold text-red-900"><AlertTriangle className="h-4 w-4" />This consolidation is blocked</h3>
                <p className="mt-1 text-sm text-red-800">Resolve the conditions below, then request a fresh preview. No action has been taken.</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-900">{preview.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>
              </section>
            )}

            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div><h3 className="font-semibold text-slate-900">Linked holdings</h3><p className="text-sm text-slate-600">Only source holdings move. Destination holdings stay unchanged. The source account is disabled after success.</p></div>
                <div className="flex gap-2 text-xs"><Badge variant="outline">{movingHoldings.length} source holdings</Badge><Badge variant="outline">{totalUnits.toLocaleString()} units to move</Badge></div>
              </div>
              {preview.holdings.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-600">No eligible holdings were returned for this source account.</div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{["Holding", "Account / action", "Property", "Investor record", "Units", "Amount", "Currency", "Unit price", "Status"].map((heading) => <th key={heading} className="px-3 py-2.5 font-semibold">{heading}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">{preview.holdings.map((holding, index) => (
                      <tr key={String(holding.id ?? index)} className="text-slate-700">
                        <td className="px-3 py-3 font-medium text-slate-900">{displayValue(holding.id)}</td>
                        <td className="px-3 py-3">{holding.user_id === preview.source.id ? `Source #${preview.source.id} — move` : `Destination #${preview.destination.id} — unchanged`}</td>
                        <td className="px-3 py-3">{displayValue(holding.property_id)}</td>
                        <td className="px-3 py-3"><span className="block">{displayValue(holding.full_name)}</span><span className="text-xs text-slate-500">{displayValue(holding.email)}</span></td>
                        <td className="px-3 py-3 tabular-nums">{displayValue(holding.units)}</td>
                        <td className="px-3 py-3 tabular-nums">{displayValue(holding.amount)}</td>
                        <td className="px-3 py-3">{displayValue(holding.currency)}</td>
                        <td className="px-3 py-3 tabular-nums">{displayValue(holding.unit_price_snapshot)}</td>
                        <td className="px-3 py-3">{displayValue(holding.status)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-500" /><h3 className="font-semibold text-slate-900">Certificate evidence</h3><Badge variant="outline">{preview.certificates.length}</Badge></div>
              {preview.certificates.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">No certificate rows are associated with these holdings.</p>
              ) : (
                <div className="space-y-3">{preview.certificates.map((certificate, index) => (
                  <div key={String(certificate.id ?? index)} className="rounded-md border border-slate-200 bg-white p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Certificate record {displayValue(certificate.id ?? index + 1)}</p>
                    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(certificate).map(([key, value]) => (
                        <div key={key} className="min-w-0">
                          <dt className="text-xs text-slate-500">{certificateLabel(key)}</dt>
                          <dd className="mt-0.5 break-words text-sm text-slate-800">{isSensitiveCertificateField(key) ? maskId(value == null ? null : String(value)) : displayValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}</div>
              )}
            </section>

            {!isBlocked && !result && (
              <section className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div>
                  <h3 className="font-semibold text-slate-900">Authorization and evidence</h3>
                  <p className="mt-1 text-sm text-slate-600">Record how identity was verified. Do not enter government ID contents; use a secure evidence reference.</p>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox id="identity-verified" checked={identityVerified} onCheckedChange={(checked) => setIdentityVerified(checked === true)} disabled={submitting || !!submitError} />
                  <Label htmlFor="identity-verified" className="cursor-pointer leading-relaxed text-slate-700">I verified the legal full name, government ID type and number, and date of birth match across both approved identities.</Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="verification-note">Verification note <span className="font-normal text-slate-500">(20–1000 characters)</span></Label>
                  <Textarea id="verification-note" value={verificationNote} onChange={(event) => setVerificationNote(event.target.value.slice(0, 1000))} disabled={submitting || !!submitError} rows={3} maxLength={1000} placeholder="Record the secure case or evidence reference and verification method. Do not include ID numbers." />
                  <p className={`text-right text-xs ${verificationNote.trim().length < 20 ? "text-slate-500" : "text-emerald-700"}`}>{verificationNote.trim().length}/1000 characters</p>
                </div>
                <div className="flex items-start gap-3 border-t border-slate-200 pt-4">
                  <Checkbox id="update-contact-email" checked={updateContactEmail} onCheckedChange={(checked) => setUpdateContactEmail(checked === true)} disabled={submitting || !!submitError || !destinationEmailCanBeUsed} />
                  <div>
                    <Label htmlFor="update-contact-email" className={`cursor-pointer leading-relaxed ${!destinationEmailCanBeUsed ? "text-slate-500" : "text-slate-700"}`}>Update moved holdings’ operational contact email to the destination’s verified email.</Label>
                    <p className="mt-1 text-xs text-slate-500">The original holding email remains in the audit record. {!destinationEmailCanBeUsed && "Unavailable because the destination email is not verified."}</p>
                  </div>
                </div>
                <div className="space-y-2 border-t border-slate-200 pt-4">
                  <Label htmlFor="consolidation-confirmation">Type exactly: <span className="font-mono text-blue-900">{expectedConfirmation}</span></Label>
                  <Input id="consolidation-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={submitting || !!submitError} autoComplete="off" />
                </div>
                {submitError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{submitError}</div>}
                <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-xl text-xs leading-relaxed text-slate-500">The operation moves current confirmed holdings only. Historical evidence is retained; no notification or resale action is performed.</p>
                  <Button onClick={handleConsolidate} disabled={!canSubmit || submitting} className="shrink-0 bg-blue-800 text-white hover:bg-blue-900">
                    {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Consolidating</> : submitError ? <><RefreshCw className="mr-2 h-4 w-4" />Retry same request</> : "Consolidate accounts"}
                  </Button>
                </div>
              </section>
            )}
            {result && (
              <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="flex items-center gap-2 font-semibold text-emerald-900"><CheckCircle2 className="h-5 w-5" />Consolidation completed</h3>
                <p className="mt-1 text-sm text-emerald-900">Audit reference: <span className="font-mono font-semibold">{result.auditId}</span></p>
                <p className="mt-1 text-sm text-emerald-800">{result.holdingIds?.length ?? 0} holding(s) moved from account {result.sourceId} to account {result.destinationId}.</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AccountConsolidation;
