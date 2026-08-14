import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { previewMeetImport, serializeMeetBackup, type MeetImportPreview, type PortableHostedMeetBundle } from "@rr3/meet-domain";
import type { MeetBackupRepository, MeetRevisionPreview, MeetRevisionSummary } from "../../data/meetBackupRepository";
import { WorkbookDialog } from "../workbook/WorkbookDialog";

type ValidPreview = Extract<MeetImportPreview, { ok: true }>;

export function BackupDrawer({ open, organisationId, bundle, repository, onClose, onImported, onDirtyChange, onDownload }: {
  open: boolean;
  organisationId: string;
  bundle: PortableHostedMeetBundle;
  repository: MeetBackupRepository;
  onClose(): void;
  onImported(meetId: string): void;
  onDirtyChange?(source: string, dirty: boolean): void;
  onDownload?(file: { name: string; type: "application/json"; text: string }): void;
}) {
  const [preview, setPreview] = useState<ValidPreview | null>(null);
  const [revisionPreview, setRevisionPreview] = useState<MeetRevisionPreview | null>(null);
  const [revisions, setRevisions] = useState<MeetRevisionSummary[]>([]);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const requestIds = useRef(new Map<string, string>());
  const revisionPreviewRef = useRef<HTMLElement>(null);
  const revisionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const returnToRevisionTrigger = useRef(false);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => () => dirtyCallback.current?.("backup:import", false), []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setRevisions([]);
    void repository.listRevisions(organisationId, bundle.state.meet.id).then((value) => { if (active) setRevisions(value); }).catch(() => { if (active) setNotice("Saved revision history is temporarily unavailable. The current meet is unchanged."); });
    return () => { active = false; };
  }, [bundle.state.meet.id, open, organisationId, repository]);
  useLayoutEffect(() => { if (revisionPreview) revisionPreviewRef.current?.focus(); }, [revisionPreview]);
  useLayoutEffect(() => {
    if (!revisionPreview && returnToRevisionTrigger.current) {
      returnToRevisionTrigger.current = false;
      revisionTriggerRef.current?.focus();
    }
  }, [revisionPreview]);
  if (!open) return null;

  const markDirty = (dirty: boolean) => onDirtyChange?.("backup:import", dirty);
  const resetDraft = () => { setPreview(null); setRevisionPreview(null); setReason(""); setConfirmed(false); setError(""); markDirty(false); };
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setError(""); setNotice(""); setRevisionPreview(null); setReason(""); setConfirmed(false);
    const result = await previewMeetImport(await file.text());
    if (!result.ok) { setPreview(null); markDirty(false); setError(result.issues[0]?.message ?? "The import file is invalid."); return; }
    setPreview(result); markDirty(true);
  };
  const stableId = (key: string) => {
    const existing = requestIds.current.get(key); if (existing) return existing;
    const value = crypto.randomUUID(); requestIds.current.set(key, value); return value;
  };
  const finishReceipt = (key: string, receipt: { ok: boolean; kind?: string }) => {
    if (receipt.ok || !["network", "offline", "unknown"].includes(receipt.kind ?? "")) requestIds.current.delete(key);
  };
  const importCopy = async () => {
    if (!preview || !confirmed || !reason.trim() || reason.trim().length > 500) return;
    setPending(true); setError("");
    try {
      const portable = await serializeMeetBackup(preview.bundle, { exportedAt: bundle.state.meet.updatedAt, applicationVersion: "0.1.0" });
      const key = "import"; const receipt = await repository.importAsNewMeet(organisationId, portable, reason.trim(), true, stableId(key)); finishReceipt(key, receipt);
      if (!receipt.ok) { setError(receipt.message); return; }
      resetDraft(); setNotice("Import committed as a separate new meet."); onImported(receipt.value.meetId);
    } catch { requestIds.current.delete("import"); setError("The validated import could not be prepared. The current meet was preserved."); }
    finally { setPending(false); }
  };
  const reviewRevision = async (revision: MeetRevisionSummary, event: MouseEvent<HTMLButtonElement>) => {
    revisionTriggerRef.current = event.currentTarget;
    setPending(true); setError(""); setPreview(null); setReason(""); setConfirmed(false); markDirty(true);
    try { setRevisionPreview(await repository.previewRevision(organisationId, revision.id)); }
    catch { setRevisionPreview(null); markDirty(false); setError("The revision preview could not be loaded. No data changed."); }
    finally { setPending(false); }
  };
  const restoreCopy = async () => {
    if (!revisionPreview || !confirmed || !reason.trim() || reason.trim().length > 500) return;
    setPending(true); setError(""); const key = `restore:${revisionPreview.revisionId}`;
    const receipt = await repository.restoreRevisionAsNewMeet(organisationId, revisionPreview.revisionId, reason.trim(), true, stableId(key)); finishReceipt(key, receipt);
    if (!receipt.ok) setError(receipt.message); else { returnToRevisionTrigger.current = true; resetDraft(); setNotice("Revision restored as a separate new meet."); onImported(receipt.value.meetId); }
    setPending(false);
  };
  const counts = preview ? count(preview.bundle) : null;
  const exportCurrent = async () => {
    setPending(true); setError("");
    try {
      const receipt = await repository.exportBackup(organisationId, bundle.state.meet.id, bundle.state.meet.version, { exportedAt: bundle.state.meet.updatedAt, applicationVersion: "0.1.0" });
      if (!receipt.ok) { setError(receipt.message); return; }
      const file = { name: backupName(bundle), type: "application/json" as const, text: receipt.value };
      if (onDownload) onDownload(file);
      else {
        const url = URL.createObjectURL(new Blob([file.text], { type: "application/json;charset=utf-8" }));
        try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click(); }
        finally { URL.revokeObjectURL(url); }
      }
      setNotice("Validated current-meet backup downloaded.");
    } catch { setError("The backup was validated, but the browser download could not start. Try again."); }
    finally { setPending(false); }
  };
  return <WorkbookDialog title="Backup, import and recovery" onClose={() => { resetDraft(); onClose(); }}>
    <section aria-labelledby="backup-export-heading"><h3 id="backup-export-heading">Current meet backup</h3><p>Exports are deterministic, validated and contain the complete meet graph and audit history.</p><button type="button" disabled={pending} onClick={() => void exportCurrent()}>Download current meet backup</button></section>
    <section aria-labelledby="import-heading"><h3 id="import-heading">Import compatible race data</h3>
      <label>Choose Meet backup or compatible event JSON<input data-initial-focus type="file" accept="application/json,.json" onChange={(event) => void selectFile(event)} /></label>
      {preview && counts ? <section role="region" aria-label="Import preview" className="recovery-preview"><h4>Validated import preview</h4><p>{counts.brackets} brackets · {counts.cars} cars · {counts.heats} heats · {counts.rules} advancement rules</p><p>This creates a new meet. The open meet is never overwritten.</p>{preview.warnings.map((warning) => <p key={warning.code} className="safe-notice">{warning.message}</p>)}<label>Import reason<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label><label><input type="checkbox" aria-label="Create a separate new meet" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Create a separate new meet</label><button type="button" disabled={pending || !confirmed || !reason.trim()} onClick={() => void importCopy()}>Import as new meet</button></section> : null}
    </section>
    <section aria-labelledby="revision-heading"><h3 id="revision-heading">Saved revisions</h3>{revisions.length ? <ul className="revision-list">{revisions.map((revision) => <li key={revision.id}><span><strong>{revision.label}</strong><small>Version {revision.sourceMeetVersion} · {revision.createdAt}</small></span><button type="button" disabled={pending} onClick={(event) => void reviewRevision(revision, event)}>Review restore {revision.label}</button></li>)}</ul> : <p>No saved revisions are available for this meet.</p>}
      {revisionPreview ? <section ref={revisionPreviewRef} tabIndex={-1} role="region" aria-live="polite" aria-label="Revision restore preview" className="recovery-preview"><h4>Restore review</h4><p>Source meet version {revisionPreview.sourceMeetVersion}. Restoring creates a separate new meet and keeps the current one.</p><ManifestComparison manifest={revisionPreview.manifest} current={bundle} /><label>Restore reason<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label><label><input type="checkbox" aria-label="Restore into a separate new meet" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Restore into a separate new meet</label><div className="dialog-actions"><button type="button" disabled={pending || !confirmed || !reason.trim()} onClick={() => void restoreCopy()}>Restore as new meet</button><button type="button" className="quiet-action" onClick={() => { returnToRevisionTrigger.current = true; setRevisionPreview(null); setReason(""); setConfirmed(false); markDirty(false); }}>Cancel revision restore</button></div></section> : null}
    </section>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status" className="safe-notice">{notice}</p> : null}
    <div className="dialog-actions"><button type="button" className="quiet-action" onClick={() => { resetDraft(); onClose(); }}>Close backup and recovery</button></div>
  </WorkbookDialog>;
}

function ManifestComparison({ manifest, current }: { manifest: Record<string, unknown>; current: PortableHostedMeetBundle }) {
  const currentCounts = { bracketCount: current.state.brackets.length, carCount: current.state.brackets.reduce((sum, bracket) => sum + bracket.event.entries.length, 0), heatCount: current.state.brackets.reduce((sum, bracket) => sum + bracket.event.matches.length + bracket.event.finals.length, 0), ruleCount: current.state.advancementRules.length, auditEventCount: current.state.auditLog.length };
  const fields = [["Brackets", "bracketCount"], ["Cars", "carCount"], ["Heats", "heatCount"], ["Rules", "ruleCount"], ["Audit events", "auditEventCount"]] as const;
  return <dl className="revision-manifest">{fields.map(([label, key]) => { const value = typeof manifest[key] === "number" ? manifest[key] as number : null; const delta = value === null ? null : value - currentCounts[key]; return <div key={key}><dt>{label}</dt><dd>{value ?? "Not recorded"}{delta === null ? "" : ` · ${delta > 0 ? "+" : ""}${delta} from current`}</dd></div>; })}</dl>;
}

function count(bundle: PortableHostedMeetBundle) {
  return {
    brackets: bundle.state.brackets.length,
    cars: bundle.state.brackets.reduce((sum, bracket) => sum + bracket.event.entries.length, 0),
    heats: bundle.state.brackets.reduce((sum, bracket) => sum + bracket.event.matches.length + bracket.event.finals.length, 0),
    rules: bundle.state.advancementRules.length,
  };
}

function backupName(bundle: PortableHostedMeetBundle): string {
  const slug = bundle.state.meet.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80) || "meet";
  return `${slug}-${bundle.state.meet.date}-v${bundle.state.meet.version}.rr3-meet-backup.json`;
}
