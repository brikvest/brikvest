import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AlertCircle, CheckCircle2, FileCheck2, Loader2, PenLine, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type NativeSigningSession = {
  documentId: number;
  operationId: number;
  challengeToken: string;
  expiresAt: string;
  unsignedPdfSha256: string;
  signerName: string;
  consentVersion: string;
  consentText: string;
};

type SigningResult = "investor_signed" | "processing";

async function responseError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    return data.error || data.message || fallback;
  } catch {
    return fallback;
  }
}

export function NativeSigningDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: number;
  documentName: string;
  onCompleted: (status: SigningResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const previousPointRef = useRef<{ x: number; y: number } | null>(null);
  const pathLengthRef = useRef(0);
  const typedSignatureNameRef = useRef("");
  const [session, setSession] = useState<NativeSigningSession | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep] = useState<"review" | "sign">("review");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [password, setPassword] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [irreversibleConfirmed, setIrreversibleConfirmed] = useState(false);
  const [hasMeaningfulSignature, setHasMeaningfulSignature] = useState(false);
  const [signatureMethod, setSignatureMethod] = useState<"drawn" | "typed">("drawn");
  const [result, setResult] = useState<SigningResult | null>(null);
  const [expiryReached, setExpiryReached] = useState(false);
  const expiresAt = session ? new Date(session.expiresAt).getTime() : 0;
  const sessionExpired = !!session && (expiryReached || !Number.isFinite(expiresAt) || expiresAt <= Date.now());
  const signerNameMatches = !!session && typedName === session.signerName;
  const signatureMatchesSigner = signatureMethod === "typed"
    ? typedSignatureNameRef.current === typedName && signerNameMatches
    : pathLengthRef.current >= 12;
  const canSubmit = !!session &&
    !sessionExpired &&
    signerNameMatches &&
    password.length > 0 &&
    reviewed &&
    consent &&
    irreversibleConfirmed &&
    hasMeaningfulSignature &&
    signatureMatchesSigner &&
    !submitting;

  useEffect(() => {
    if (!session) {
      setExpiryReached(false);
      return;
    }
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setExpiryReached(true);
      return;
    }
    setExpiryReached(false);
    const timer = window.setTimeout(() => setExpiryReached(true), remaining);
    return () => window.clearTimeout(timer);
  }, [session?.expiresAt]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let disposed = false;
    let createdPreviewUrl: string | null = null;

    setLoading(true);
    setError(null);
    setSession(null);
    setPreviewUrl(null);
    setResult(null);
    setStep("review");
    setTypedName("");
    setPassword("");
    setReviewed(false);
    setConsent(false);
    setIrreversibleConfirmed(false);
    setHasMeaningfulSignature(false);
    setSignatureMethod("drawn");
    typedSignatureNameRef.current = "";
    pathLengthRef.current = 0;

    const initialize = async () => {
      try {
        const [sessionResponse, previewResponse] = await Promise.all([
          fetch(`/api/legal/documents/${documentId}/signing-session`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "X-Brikvest-Signing": "1" },
            body: JSON.stringify({}),
            signal: controller.signal,
          }),
          fetch(`/api/legal/documents/${documentId}/preview?version=unsigned`, {
            credentials: "include",
            signal: controller.signal,
          }),
        ]);
        if (!sessionResponse.ok) throw new Error(await responseError(sessionResponse, "Could not start a secure signing session."));
        if (!previewResponse.ok) throw new Error(await responseError(previewResponse, "Could not load the protected document preview."));
        const sessionData = await sessionResponse.json() as NativeSigningSession;
        if (
          Number(sessionData.documentId) !== Number(documentId) ||
          !sessionData.challengeToken ||
          !sessionData.signerName ||
          !sessionData.consentVersion ||
          !sessionData.consentText ||
          !/^[a-f0-9]{64}$/i.test(sessionData.unsignedPdfSha256 || "") ||
          !Number.isFinite(new Date(sessionData.expiresAt).getTime()) ||
          new Date(sessionData.expiresAt).getTime() <= Date.now()
        ) {
          throw new Error("The signing session response was incomplete. Close this dialog and try again.");
        }
        const pdfBlob = await previewResponse.blob();
        if (!pdfBlob.size) throw new Error("The protected document preview is empty. Close this dialog and try again.");
        if (disposed) return;
        if (!window.crypto?.subtle) throw new Error("This browser cannot verify the protected PDF integrity. Use a current browser and try again.");
        const digest = await window.crypto.subtle.digest("SHA-256", await pdfBlob.arrayBuffer());
        const previewSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (previewSha256.toLowerCase() !== sessionData.unsignedPdfSha256.toLowerCase()) {
          throw new Error("The PDF preview does not match the immutable signing-session hash. Close this dialog and try again.");
        }
        if (disposed) return;
        createdPreviewUrl = URL.createObjectURL(pdfBlob);
        setSession(sessionData);
        setPreviewUrl(createdPreviewUrl);
      } catch (cause: any) {
        if (!disposed && cause?.name !== "AbortError") {
          setError(cause instanceof Error ? cause.message : "Could not prepare this signing session.");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void initialize();
    return () => {
      disposed = true;
      controller.abort();
      if (createdPreviewUrl) URL.revokeObjectURL(createdPreviewUrl);
    };
  }, [documentId, open]);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    activePointerRef.current = null;
    previousPointRef.current = null;
    pathLengthRef.current = 0;
    typedSignatureNameRef.current = "";
    setHasMeaningfulSignature(false);
  };

  const resetSensitiveFields = () => {
    setTypedName("");
    setPassword("");
    setReviewed(false);
    setConsent(false);
    setIrreversibleConfirmed(false);
    clearSignature();
    setSignatureMethod("drawn");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting && !nextOpen) return;
    if (!nextOpen) {
      resetSensitiveFields();
      setSession(null);
      setPreviewUrl(null);
      setResult(null);
      setError(null);
      setStep("review");
    }
    onOpenChange(nextOpen);
  };

  const pointerCoordinates = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (submitting || result || signatureMethod !== "drawn") return;
    event.preventDefault();
    const point = pointerCoordinates(event);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    activePointerRef.current = event.pointerId;
    previousPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const point = pointerCoordinates(event);
    const previous = previousPointRef.current;
    const context = event.currentTarget.getContext("2d");
    if (!context || !previous) return;
    pathLengthRef.current += Math.hypot(point.x - previous.x, point.y - previous.y);
    context.strokeStyle = "#111827";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineTo(point.x, point.y);
    context.stroke();
    previousPointRef.current = point;
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    previousPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setHasMeaningfulSignature(pathLengthRef.current >= 12);
  };

  const continueToSigning = () => {
    if (!reviewed) return;
    resetSensitiveFields();
    setReviewed(true);
    setStep("sign");
    setError(null);
  };

  const backToReview = () => {
    resetSensitiveFields();
    setStep("review");
    setError(null);
  };

  const changeTypedName = (value: string) => {
    if (value !== typedName) clearSignature();
    setTypedName(value);
  };

  const changeSignatureMethod = (method: "drawn" | "typed") => {
    if (method === signatureMethod) return;
    clearSignature();
    setSignatureMethod(method);
  };

  const createTypedSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !session || typedName !== session.signerName) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111827";
    context.textBaseline = "middle";
    let fontSize = 68;
    context.font = `italic ${fontSize}px Georgia, "Times New Roman", serif`;
    while (fontSize > 32 && context.measureText(typedName).width > canvas.width - 80) {
      fontSize -= 2;
      context.font = `italic ${fontSize}px Georgia, "Times New Roman", serif`;
    }
    const measuredWidth = context.measureText(typedName).width;
    if (!measuredWidth) {
      clearSignature();
      return;
    }
    context.fillText(typedName, Math.max(24, (canvas.width - measuredWidth) / 2), canvas.height / 2, canvas.width - 48);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let inkPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) inkPixels += 1;
    }
    if (inkPixels < 20) {
      clearSignature();
      return;
    }
    pathLengthRef.current = 0;
    typedSignatureNameRef.current = typedName;
    setHasMeaningfulSignature(true);
  };

  const submitSignature = async () => {
    if (!session || !canSubmit) return;
    const canvas = canvasRef.current;
    const signatureIsValid = signatureMethod === "typed"
      ? typedSignatureNameRef.current === typedName && typedName === session.signerName && hasMeaningfulSignature
      : pathLengthRef.current >= 12 && hasMeaningfulSignature;
    if (!canvas || !signatureIsValid) {
      setHasMeaningfulSignature(false);
      setError(signatureMethod === "typed"
        ? "Create a fresh typed signature from the exact verified name before submitting."
        : "Draw a clear signature using a continuous pen or touch movement before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/legal/documents/${documentId}/sign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Brikvest-Signing": "1" },
        body: JSON.stringify({
          challengeToken: session.challengeToken,
          password,
          typedName,
          consent: true,
          reviewed: true,
          signaturePng: canvas.toDataURL("image/png"),
          signatureMethod,
          consentVersion: session.consentVersion,
          unsignedPdfSha256: session.unsignedPdfSha256,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not submit your signature."));
      const responseData = await response.json() as { status?: SigningResult };
      if (responseData.status !== "investor_signed" && responseData.status !== "processing") {
        throw new Error("The signing service returned an unexpected status. Refresh the legal documents before retrying.");
      }
      setResult(responseData.status);
      setSession((current) => current ? { ...current, challengeToken: "" } : current);
      resetSensitiveFields();
      onCompleted(responseData.status);
    } catch (cause: any) {
      setError(cause instanceof Error ? cause.message : "Could not submit your signature.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl max-h-[92dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PenLine className="h-5 w-5 text-blue-700" />Sign {documentName}</DialogTitle>
          <DialogDescription>Review the protected document and sign directly with Brikvest. Your password and signature mark stay only in this temporary signing session.</DialogDescription>
        </DialogHeader>

        {loading && <p className="flex items-center gap-2 py-8 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Preparing the protected PDF and signing challenge…</p>}
        {error && <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

        {!loading && previewUrl && session && !result && (
          <>
            <section className="space-y-3" aria-label="Protected document review">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-900">Review the unsigned document</h3>
                <details className="text-xs text-slate-600">
                  <summary className="cursor-pointer font-medium">Document integrity details</summary>
                  <div className="mt-2 space-y-1 rounded border bg-slate-50 p-2">
                    <p><strong>SHA-256:</strong> <code className="break-all">{session.unsignedPdfSha256}</code></p>
                    <p><strong>Signing challenge expires:</strong> {new Date(session.expiresAt).toLocaleString()}</p>
                    <p><strong>Consent version:</strong> {session.consentVersion}</p>
                    <p><strong>Operation ID:</strong> {session.operationId}</p>
                  </div>
                </details>
              </div>
              <iframe title={`${documentName} unsigned PDF`} src={previewUrl} className="h-[min(52dvh,32rem)] w-full rounded-md border bg-slate-100" />
              {step === "review" && (
                <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <Checkbox checked={reviewed} onCheckedChange={(checked) => setReviewed(checked === true)} />
                    <span>I have reviewed the document above and want to continue to the signing details.</span>
                  </label>
                  <Button onClick={continueToSigning} disabled={!reviewed} className="w-full sm:w-auto">
                    Continue to signing
                  </Button>
                </div>
              )}
            </section>

            {step === "sign" && (
              <section className="space-y-5 border-t border-slate-200 pt-5" aria-label="Sign legal document">
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  The verified signer is <strong>{session.signerName}</strong>. Enter this name exactly and re-enter your Brikvest password to authorize this signature.
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`signer-name-${documentId}`}>Type your verified name exactly</Label>
                    <Input
                      id={`signer-name-${documentId}`}
                      value={typedName}
                      onChange={(event) => changeTypedName(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={submitting}
                      aria-describedby={`signer-name-help-${documentId}`}
                    />
                    <p id={`signer-name-help-${documentId}`} className="text-xs text-slate-500">Must match “{session.signerName}” exactly, including spelling and case.</p>
                    {typedName.length > 0 && !signerNameMatches && <p className="text-xs text-red-700">The typed name does not match the verified name exactly.</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`signer-password-${documentId}`}>Re-enter your Brikvest password</Label>
                    <Input
                      id={`signer-password-${documentId}`}
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="off"
                      disabled={submitting}
                    />
                    <p className="text-xs text-slate-500">Used for this request only; it is not saved in this dialog or browser storage.</p>
                  </div>
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium text-slate-900">Signature method</legend>
                  <div className="flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`signature-method-${documentId}`}
                        value="drawn"
                        checked={signatureMethod === "drawn"}
                        onChange={() => changeSignatureMethod("drawn")}
                        disabled={submitting}
                        className="h-4 w-4 accent-blue-700"
                      />
                      Draw signature
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`signature-method-${documentId}`}
                        value="typed"
                        checked={signatureMethod === "typed"}
                        onChange={() => changeSignatureMethod("typed")}
                        disabled={submitting}
                        className="h-4 w-4 accent-blue-700"
                      />
                      Use typed signature
                    </label>
                  </div>
                  {signatureMethod === "drawn" && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Label htmlFor={`signature-canvas-${documentId}`}>Draw your signature</Label>
                          <p className="text-xs text-slate-500">Use a finger, stylus, or mouse. A clear drawn stroke is required.</p>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={clearSignature} disabled={submitting || !hasMeaningfulSignature}>
                          <RotateCcw className="mr-1.5 h-4 w-4" />Clear signature
                        </Button>
                      </div>
                      <canvas
                        id={`signature-canvas-${documentId}`}
                        ref={canvasRef}
                        width={800}
                        height={240}
                        aria-label="Draw your signature using touch, stylus, or mouse"
                        role="img"
                        className="h-36 w-full touch-none rounded-md border border-slate-300 bg-white sm:h-44"
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={finishPointer}
                        onPointerCancel={finishPointer}
                      />
                      {!hasMeaningfulSignature && <p className="text-xs text-amber-700">Add a continuous signature stroke before signing.</p>}
                    </div>
                  )}
                  {signatureMethod === "typed" && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Label htmlFor={`typed-signature-preview-${documentId}`}>Typed signature preview</Label>
                          <p className="text-xs text-slate-500">This creates a local black italic mark from the verified name above; it does not use a saved KYC signature image.</p>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={createTypedSignature} disabled={submitting || !signerNameMatches}>
                            Create typed signature
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={clearSignature} disabled={submitting || !hasMeaningfulSignature}>
                            <RotateCcw className="mr-1.5 h-4 w-4" />Clear
                          </Button>
                        </div>
                      </div>
                      <canvas
                        id={`typed-signature-preview-${documentId}`}
                        ref={canvasRef}
                        width={800}
                        height={240}
                        aria-label={hasMeaningfulSignature && typedSignatureNameRef.current === typedName ? `Typed signature preview for ${typedName}` : "Typed signature preview is empty"}
                        role="img"
                        className="h-36 w-full rounded-md border border-slate-300 bg-white sm:h-44"
                      />
                      {!hasMeaningfulSignature && <p className="text-xs text-amber-700">Create the typed signature after the verified name matches exactly.</p>}
                    </div>
                  )}
                </fieldset>

                <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} disabled={submitting} />
                    <span>{session.consentText}</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm font-medium text-slate-800">
                    <Checkbox checked={irreversibleConfirmed} onCheckedChange={(checked) => setIrreversibleConfirmed(checked === true)} disabled={submitting} />
                    <span>I understand this submission is irreversible and records my investor signature only; external execution is handled separately.</span>
                  </label>
                </div>

                {sessionExpired && <p className="text-sm text-red-700" role="alert">This signing challenge has expired. Close this dialog and start a new signing session.</p>}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <Button type="button" variant="outline" onClick={backToReview} disabled={submitting}>
                    Back to review (clears signature and password)
                  </Button>
                  <Button type="button" onClick={submitSignature} disabled={!canSubmit} className="sm:min-w-48">
                    {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : <><ShieldCheck className="mr-2 h-4 w-4" />Sign and submit</>}
                  </Button>
                </div>
              </section>
            )}
          </>
        )}

        {result === "investor_signed" && (
          <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4" role="status">
            <p className="flex items-center gap-2 font-semibold text-blue-900"><CheckCircle2 className="h-5 w-5" />Investor signature recorded</p>
            <p className="text-sm text-blue-900">Investor signed — external execution is handled separately.</p>
            <Button onClick={() => handleOpenChange(false)}>Close</Button>
          </div>
        )}
        {result === "processing" && (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4" role="status">
            <p className="flex items-center gap-2 font-semibold text-amber-900"><FileCheck2 className="h-5 w-5" />Signing is still being finalized</p>
            <p className="text-sm text-amber-900">Your signing request is processing. This page will refresh as its status changes; external execution is handled separately.</p>
            <Button onClick={() => handleOpenChange(false)}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}