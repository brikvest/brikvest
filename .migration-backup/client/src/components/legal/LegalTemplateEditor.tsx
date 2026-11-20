import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, FileText, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LegalActionError, LegalActionNotice, legalNetworkError, readLegalResponse, type LegalActionResult } from "./legalActionErrors";

export type LegalEditorTemplate = { id: number; documentType: string; version: number };
type Paragraph = { id: string; text: string; editable: boolean; reason?: string; tokens: string[]; alignment?: string };
type Section = { id: string; name: string; paragraphs: Paragraph[] };
type EditorDocument = {
  templateId: number;
  propertyId: number;
  documentType: string;
  version: number;
  sourceSha256: string;
  sections: Section[];
};
type SavedDraft = { id: number; propertyId: number; version: number; documentType: string; validationStatus: "valid" };

const documentName = (type: string) => type === "deed_of_assignment"
  ? "Deed of Assignment"
  : type === "transfer_exit_rights" ? "Transfer and Exit Rights Agreement" : type.replace(/_/g, " ");
const foundTokens = (text: string) => text.match(/{{[^{}]+}}/g) || [];
const sameTokens = (a: string[], b: string[]) => a.length === b.length && a.every((token, index) => token === b[index]);

function actionContext(propertyName: string, template: LegalEditorTemplate, action: string) {
  return { property: propertyName, documentType: template.documentType, templateVersion: `v${template.version}`, action };
}

export function LegalTemplateEditor({
  template, propertyId, propertyName, onClose, onSaved,
}: {
  template: LegalEditorTemplate;
  propertyId: number;
  propertyName: string;
  onClose(): void;
  onSaved(saved: { id: number; version: number; documentType: string }): void;
}) {
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<LegalActionResult | null>(null);
  const [saveError, setSaveError] = useState<LegalActionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const requestSequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const changedCount = Object.keys(edits).length;
  const validation = useMemo(() => {
    if (!document) return [];
    const issues: { id: string; sectionName: string; text: string }[] = [];
    for (const section of document.sections) {
      for (const paragraph of section.paragraphs) {
        const edited = edits[paragraph.id];
        if (edited === undefined) continue;
        const originalTokens = foundTokens(paragraph.text);
        const changedTokens = foundTokens(edited);
        if (!sameTokens(originalTokens, changedTokens)) {
          issues.push({
            id: paragraph.id,
            sectionName: section.name,
            text: `Keep the automatic placeholders in this paragraph exactly as provided (${originalTokens.length ? originalTokens.join(", ") : "this paragraph has no placeholders"}). Placeholders cannot be removed, renamed, reordered or moved to another paragraph.`,
          });
        }
      }
    }
    return issues;
  }, [document, edits]);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setDocument(null);
    setEdits({});
    try {
      const session = localStorage.getItem("admin_session_id");
      if (!session) {
        throw new LegalActionError({
          ...actionContext(propertyName, template, "session"),
          stage: "session",
          summary: "Your administrator session has expired. Sign in again, then return to this property.",
          issues: [], instructions: [], nextAction: "Sign in again and retry loading this wording.", kind: "session",
        });
      }
      const response = await fetch(`/api/admin/legal/templates/${template.id}/editor?propertyId=${propertyId}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${session}` },
        signal: controller.signal,
      });
      const result = await readLegalResponse(response, actionContext(propertyName, template, "inspection")) as EditorDocument;
      if (!result || !Array.isArray(result.sections) || typeof result.sourceSha256 !== "string" ||
          result.templateId !== template.id || result.propertyId !== propertyId ||
          result.documentType !== template.documentType || result.version !== template.version) {
        throw new LegalActionError({
          ...actionContext(propertyName, template, "inspection"),
          stage: "inspection", summary: "The wording editor did not receive a complete template document.",
          issues: [], instructions: [], nextAction: "Retry loading this assigned template.", kind: "other",
        });
      }
      if (sequence === requestSequence.current && !controller.signal.aborted) setDocument(result);
    } catch (error) {
      if (sequence === requestSequence.current && !controller.signal.aborted) {
        const wrapped = error instanceof LegalActionError ? error : legalNetworkError(error, actionContext(propertyName, template, "inspection"));
        setLoadError(wrapped.result);
      }
    } finally {
      if (sequence === requestSequence.current && !controller.signal.aborted) setLoading(false);
    }
  }, [propertyId, propertyName, template]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
      controllerRef.current?.abort();
    };
  }, [load]);

  const changeParagraph = (paragraph: Paragraph, value: string) => {
    setEdits((previous) => {
      const next = { ...previous };
      if (value === paragraph.text) delete next[paragraph.id];
      else next[paragraph.id] = value;
      return next;
    });
    setSaveError(null);
  };

  const requestClose = () => {
    if (saving) return;
    if (changedCount) setConfirmClose(true);
    else onClose();
  };

  const save = async () => {
    if (!document || !changedCount || validation.length || saving) return;
    const sequence = requestSequence.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setSaving(true);
    setSaveError(null);
    try {
      const session = localStorage.getItem("admin_session_id");
      if (!session) {
        throw new LegalActionError({
          ...actionContext(propertyName, template, "session"),
          stage: "session",
          summary: "Your administrator session has expired. Sign in again, then return to this property.",
          issues: [], instructions: [], nextAction: "Sign in again and retry saving this draft.", kind: "session",
        });
      }
      const changes = document.sections.flatMap((section) => section.paragraphs)
        .filter((paragraph) => Object.prototype.hasOwnProperty.call(edits, paragraph.id))
        .map((paragraph) => ({ id: paragraph.id, text: edits[paragraph.id] }));
      const response = await fetch(`/api/admin/legal/templates/${template.id}/editor`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, sourceSha256: document.sourceSha256, changes }),
        signal: controller.signal,
      });
      const result = await readLegalResponse(response, actionContext(propertyName, template, "save")) as SavedDraft;
      if (!result || typeof result.id !== "number" || typeof result.version !== "number" || !result.documentType) {
        throw new LegalActionError({
          ...actionContext(propertyName, template, "save"),
          stage: "save", summary: "The service did not confirm the saved draft version.",
          issues: [], instructions: [], nextAction: "Refresh this property’s template list before retrying, to avoid creating a duplicate draft.", kind: "network",
        });
      }
      if (sequence === requestSequence.current && !controller.signal.aborted) onSaved({ id: result.id, version: result.version, documentType: result.documentType });
    } catch (error) {
      if (!controller.signal.aborted) {
        const wrapped = error instanceof LegalActionError ? error : legalNetworkError(error, actionContext(propertyName, template, "save"));
        setSaveError(wrapped.result);
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  const tokenDisplay = (tokens: string[]) => tokens.map((token) => token.startsWith("{{") ? token : `{{${token}}}`);

  return <>
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className="flex max-h-[94dvh] w-[calc(100%-1rem)] max-w-5xl flex-col gap-0 overflow-hidden border-[#d7dfd6] bg-[#f8faf7] p-0 shadow-[0_24px_80px_-28px_rgba(28,46,32,0.36)] sm:w-[calc(100%-2rem)]">
        <DialogHeader className="border-b border-[#dce4dc] bg-[#eef3ed] px-5 py-5 pr-12 text-left sm:px-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-[#aebfae] bg-white/70 text-[#405a45]">Wording editor</Badge>
            <span className="text-xs font-medium tracking-wide text-[#657568]">{propertyName} · source v{template.version}</span>
          </div>
          <DialogTitle className="font-serif text-2xl font-semibold tracking-[-0.025em] text-[#21372a] sm:text-3xl">{documentName(template.documentType)}</DialogTitle>
          <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-[#58695c]">
            Edit approved wording only. Paragraph breaks and document layout are retained; protected structures remain read-only.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
          <div className="mb-6 grid gap-3 rounded-xl border border-[#d8e3d7] bg-white p-4 sm:grid-cols-[auto_1fr] sm:items-start sm:p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8f0e6] text-[#4d6c52]"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <h3 className="text-sm font-semibold text-[#2f4935]">Changes save as a new inactive draft</h3>
              <p className="mt-1 text-sm leading-6 text-[#5d6c60]">Saving does not activate this wording or change existing investor documents or signed records. Review the saved version, then use the existing template controls to preview and activate it when ready.</p>
            </div>
          </div>

          {loading && <div role="status" aria-label="Loading template wording" className="space-y-5">
            {[0, 1, 2].map((item) => <div key={item} className="animate-pulse rounded-xl border border-[#e2e8e1] bg-white p-5"><div className="h-4 w-36 rounded bg-[#e8eee7]" /><div className="mt-5 h-24 rounded bg-[#f0f3ef]" /><span className="sr-only">Loading template wording…</span></div>)}
          </div>}
          {!loading && loadError && <div className="mx-auto max-w-2xl py-8">
            <LegalActionNotice result={loadError} />
            <Button className="mt-4" variant="outline" onClick={() => void load()}>Retry loading wording</Button>
          </div>}
          {!loading && document && <div className="mx-auto max-w-3xl space-y-9">
            {document.sections.map((section, sectionIndex) => <section key={section.id} aria-labelledby={`legal-editor-section-${section.id}`}>
              <div className="mb-4 flex items-center gap-3">
                <span aria-hidden="true" className="font-mono text-xs tracking-[0.16em] text-[#859487]">{String(sectionIndex + 1).padStart(2, "0")}</span>
                <h2 id={`legal-editor-section-${section.id}`} className="text-base font-semibold tracking-[-0.01em] text-[#2d4433]">{section.name}</h2>
                <span className="h-px flex-1 bg-[#dce5dc]" />
              </div>
              <div className="space-y-4">
                {section.paragraphs.map((paragraph, paragraphIndex) => {
                  const current = edits[paragraph.id] ?? paragraph.text;
                  const problem = validation.find((issue) => issue.id === paragraph.id);
                  const labelId = `paragraph-label-${section.id}-${paragraph.id}`;
                  return <article key={paragraph.id} className={`overflow-hidden rounded-xl border ${paragraph.editable ? "border-[#dce4dc] bg-white shadow-[0_2px_8px_rgba(39,57,42,0.035)]" : "border-[#e4e8e3] bg-[#f0f2ef]"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0ec] px-4 py-2.5">
                      <label id={labelId} htmlFor={`legal-paragraph-${section.id}-${paragraph.id}`} className="text-xs font-semibold tracking-wide text-[#67766a]">Paragraph {paragraphIndex + 1}</label>
                      {paragraph.editable
                        ? <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#55765a]"><FileText className="h-3.5 w-3.5" />Wording editable</span>
                        : <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#737c73]"><LockKeyhole className="h-3.5 w-3.5" />Protected structure</span>}
                    </div>
                    <textarea
                      id={`legal-paragraph-${section.id}-${paragraph.id}`}
                      aria-labelledby={labelId}
                      aria-describedby={`${labelId}-hint${problem ? ` ${labelId}-error` : ""}`}
                      value={current}
                      onChange={(event) => changeParagraph(paragraph, event.target.value)}
                      readOnly={!paragraph.editable}
                      maxLength={20000}
                      rows={Math.max(3, Math.min(12, current.split("\n").length + 1))}
                      className={`block min-h-24 w-full resize-y border-0 bg-transparent px-4 py-4 text-sm leading-7 text-[#354438] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#78927a] ${!paragraph.editable ? "cursor-not-allowed text-[#778078]" : ""}`}
                    />
                    <div id={`${labelId}-hint`} className="flex flex-wrap items-start justify-between gap-2 border-t border-[#edf0ec] px-4 py-2.5 text-xs leading-5 text-[#758176]">
                      {paragraph.editable
                        ? <span>Line breaks and paragraph boundaries are retained.</span>
                        : <span className="max-w-2xl">{paragraph.reason || "This paragraph contains a structure the wording editor cannot safely modify."}</span>}
                      {!!paragraph.tokens?.length && <span className="flex flex-wrap gap-1.5" aria-label="Automatic fields">
                        {tokenDisplay(paragraph.tokens).map((token, index) => <code key={`${token}-${index}`} className="rounded bg-[#edf2eb] px-1.5 py-0.5 font-mono text-[10px] text-[#49644d]">{token}</code>)}
                      </span>}
                    </div>
                    {problem && <p id={`${labelId}-error`} role="alert" className="flex gap-2 border-t border-[#edd8b1] bg-[#fff8e9] px-4 py-3 text-xs leading-5 text-[#775719]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{problem.text}</p>}
                  </article>;
                })}
              </div>
            </section>)}
            {!document.sections.length && <div className="rounded-xl border border-dashed border-[#ccd8cc] bg-white px-6 py-12 text-center text-sm text-[#647266]">This template has no editable wording sections.</div>}
          </div>}
        </div>

        <footer className="border-t border-[#dce4dc] bg-white px-4 py-4 sm:px-8">
          {saveError && <div className="mb-3"><LegalActionNotice result={saveError} /></div>}
          {validation.length > 0 && <p role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-[#edd8b1] bg-[#fff8e9] p-3 text-xs leading-5 text-[#775719]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Resolve the automatic-field warning in {validation.length === 1 ? "the flagged paragraph" : "each flagged paragraph"} before saving. Fields must remain unchanged and in their original paragraphs.</p>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className="text-xs text-[#68776a]">{saving ? "Saving a new inactive draft…" : changedCount ? `${changedCount} ${changedCount === 1 ? "paragraph" : "paragraphs"} changed` : "No wording changes"}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" disabled={saving} onClick={requestClose}><ArrowLeft className="h-4 w-4" />{changedCount ? "Cancel editing" : "Close"}</Button>
              <Button className="bg-[#49654d] text-white hover:bg-[#3d5842]" disabled={loading || !document || !changedCount || !!validation.length || saving} onClick={() => void save()}>
                <Save className="h-4 w-4" />{saving ? "Saving draft…" : "Save as new draft"}
              </Button>
            </div>
          </div>
        </footer>
      </DialogContent>
    </Dialog>

    <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
      <DialogContent className="max-w-md border-[#d7dfd6]">
        <DialogHeader>
          <DialogTitle className="text-[#263c2c]">Leave wording unsaved?</DialogTitle>
          <DialogDescription>Your {changedCount === 1 ? "paragraph edit" : `${changedCount} paragraph edits`} will be discarded if you close now.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => setConfirmClose(false)}>Continue editing</Button>
          <Button variant="destructive" onClick={onClose}>Discard edits and close</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}