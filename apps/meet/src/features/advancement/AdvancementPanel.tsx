import { useEffect, useMemo, useRef, useState } from "react";
import { prepareAdvancementSelections, prepareReplacementAdvancementSelections, previewAdvancement, type MeetStateV1 } from "@rr3/meet-domain";
import type { AdvancementHistory } from "../../data/meetRepository";
import { AdvancementDialog } from "./AdvancementDialog";

export type AdvancementCommitInput = {
  ruleId: string;
  sourceResultVersion: number;
  expectedVersion: number;
  selections: readonly { sourceCarId: string; destinationBracketId: string; rank: number }[];
  reason: string | null;
  mode: "confirm" | "replace";
};

export function AdvancementPanel({ meet, history, canManage, onCommit, onNavigateBracket, onDirtyChange }: {
  meet: MeetStateV1;
  history: AdvancementHistory;
  canManage: boolean;
  onCommit(input: AdvancementCommitInput): Promise<{ ok: boolean; message: string }>;
  onNavigateBracket?(bracketId: string): void;
  onDirtyChange?(source: string, dirty: boolean): void;
}) {
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const pending = useRef(new Set<string>());
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    if (!activeRuleId) return;
    const source = `advancement:${activeRuleId}`;
    onDirtyRef.current?.(source, true);
    return () => onDirtyRef.current?.(source, false);
  }, [activeRuleId]);
  const byId = useMemo(() => new Map(meet.brackets.map((bracket) => [bracket.id, bracket])), [meet.brackets]);
  return <section className="advancement-panel" aria-labelledby="advancement-heading">
    <div className="panel-heading"><div><p className="eyebrow">Progression control</p><h3 id="advancement-heading">Advancement</h3></div><span>{meet.advancementRules.length} configured rules</span></div>
    {notice ? <p role="status">{notice}</p> : null}
    <div className="advancement-rules">{meet.advancementRules.length ? meet.advancementRules.map((rule) => {
      const source = byId.get(rule.sourceBracketId)!;
      const preview = previewAdvancement(meet, rule.id);
      const current = meet.advancementSnapshots.find((snapshot) => snapshot.ruleId === rule.id);
      const staleDependency = findStaleDependency(meet, source.id);
      const hasOfficialResults = [...source.event.matches, ...source.event.finals].some((heat) => heat.status === "completed");
      const sourceComplete = [...source.event.matches, ...source.event.finals].length > 0 && [...source.event.matches, ...source.event.finals].every((heat) => heat.status === "completed");
      const status = rule.status === "disabled" ? "Disabled" : !hasOfficialResults || !sourceComplete ? "Awaiting results" : current?.stale || preview.staleSource ? "Upstream stale" : preview.capacityIssues.length ? "Capacity conflict" : current ? "Confirmed" : preview.tiedCarIds.length ? `Tie decision · ${rule.topN - preview.selected.length} place remains` : preview.canConfirm ? "Ready" : "Conflict";
      const blockingStale = staleDependency !== null || (preview.staleSource && !current?.stale);
      const blocked = !canManage || rule.status === "disabled" || !sourceComplete || preview.capacityIssues.length > 0 || blockingStale;
      return <article key={rule.id} aria-label={`${source.name} advancement`} className={`advancement-rule state-${status.toLowerCase().replaceAll(" ", "-")}`}>
        <header><div><h4>{source.name}</h4><a href={`#bracket-${source.id}`} onClick={(event) => { if (onNavigateBracket) { event.preventDefault(); onNavigateBracket(source.id); } }}>Open {source.name}</a></div><span className="advancement-state">{status}</span></header>
        <p>Top {rule.topN} → {rule.destinationOrder.map((id) => byId.get(id)?.name ?? "Unknown").join(", ")}</p>
        <dl><div><dt>Source version</dt><dd>{source.version}</dd></div><div><dt>Rule version</dt><dd>{rule.version ?? 1}</dd></div><div><dt>Automatic</dt><dd>{preview.selected.length}</dd></div><div><dt>Cutoff tie</dt><dd>{preview.tiedCarIds.length}</dd></div></dl>
        {preview.capacityIssues.map((issue) => <p role="alert" key={issue.destinationBracketId}>{byId.get(issue.destinationBracketId)?.name}: {issue.required} required, {issue.available} available.</p>)}
        {staleDependency ? <p role="alert"><strong>{staleDependency.name}</strong> has stale upstream advancement lineage. <a href={`#bracket-${staleDependency.id}`} onClick={(event) => { if (onNavigateBracket) { event.preventDefault(); onNavigateBracket(staleDependency.id); } }}>Open {staleDependency.name}</a>, then refresh and reconfirm its upstream advancement first.</p> : null}
        <button type="button" disabled={blocked || pending.current.has(rule.id)} onClick={() => setActiveRuleId(rule.id)}>{current ? "Review and reconfirm" : "Review advancement"}</button>
      </article>;
    }) : <p>No progression rules configured.</p>}</div>
    {activeRuleId ? <AdvancementDecision meet={meet} ruleId={activeRuleId} history={history} pending={pending.current.has(activeRuleId)} onClose={() => setActiveRuleId(null)} onCommit={async (input) => {
      if (pending.current.has(input.ruleId)) return;
      pending.current.add(input.ruleId);
      setNotice("Saving advancement…");
      const result = await onCommit(input);
      pending.current.delete(input.ruleId);
      setNotice(result.message);
      if (result.ok) setActiveRuleId(null);
    }} /> : null}
  </section>;
}

function findStaleDependency(meet: MeetStateV1, sourceBracketId: string): { id: string; name: string } | null {
  const byBracket = new Map(meet.brackets.map((bracket) => [bracket.id, bracket]));
  const stale = new Set(meet.advancementSnapshots.filter((snapshot) => snapshot.stale || byBracket.get(snapshot.sourceBracketId)?.version !== snapshot.sourceResultVersion).map((snapshot) => snapshot.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const snapshot of meet.advancementSnapshots) {
      if (!stale.has(snapshot.id) && byBracket.get(snapshot.sourceBracketId)?.lineage.some((lineage) => stale.has(lineage.snapshotId))) {
        stale.add(snapshot.id);
        changed = true;
      }
    }
  }
  const lineage = byBracket.get(sourceBracketId)?.lineage.find((item) => stale.has(item.snapshotId));
  if (!lineage) return null;
  const snapshot = meet.advancementSnapshots.find((item) => item.id === lineage.snapshotId);
  const bracket = byBracket.get(snapshot?.sourceBracketId ?? lineage.sourceBracketId);
  return bracket ? { id: bracket.id, name: bracket.name } : null;
}

function AdvancementDecision({ meet, ruleId, history, pending, onCommit, onClose }: { meet: MeetStateV1; ruleId: string; history: AdvancementHistory; pending: boolean; onCommit(input: AdvancementCommitInput): Promise<void>; onClose(): void }) {
  const rule = meet.advancementRules.find((candidate) => candidate.id === ruleId)!;
  const source = meet.brackets.find((candidate) => candidate.id === rule.sourceBracketId)!;
  const preview = previewAdvancement(meet, ruleId);
  const current = meet.advancementSnapshots.find((snapshot) => snapshot.ruleId === ruleId) ?? null;
  const automaticIds = preview.selected.map((selection) => selection.sourceCarId);
  const remaining = Math.max(0, rule.topN - automaticIds.length);
  const [tieIds, setTieIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const entries = new Map(source.event.entries.map((entry) => [entry.id, entry]));
  const byId = new Map(meet.brackets.map((bracket) => [bracket.id, bracket]));
  const replacing = current !== null;
  const requiresReason = replacing || preview.tiedCarIds.length > 0;
  const selectedIds = [...automaticIds, ...tieIds];
  const valid = selectedIds.length === rule.topN && (!requiresReason || reason.trim().length > 0) && reason.trim().length <= 500 && !pending;
  const submit = async () => {
    if (!valid) return;
    try {
      const selections = replacing ? prepareReplacementAdvancementSelections(meet, ruleId, selectedIds, current.id) : prepareAdvancementSelections(meet, ruleId, selectedIds);
      await onCommit({ ruleId, sourceResultVersion: source.version, expectedVersion: rule.version ?? 1, selections, reason: reason.trim() || null, mode: replacing ? "replace" : "confirm" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Advancement could not be prepared."); }
  };
  const title = replacing ? "Reconfirm advancement" : preview.tiedCarIds.length ? "Resolve tied cutoff" : "Confirm advancement";
  return <AdvancementDialog title={title} onClose={onClose}>
    <p>Source version {source.version} · rule version {rule.version ?? 1}. Confirmation is authoritative and auditable.</p>
    {replacing ? <p role="alert">The current snapshot is {current.stale ? "stale" : "confirmed"}. Reconfirmation replaces it using the latest source results.</p> : null}
    <section aria-labelledby="automatic-qualifiers"><h3 id="automatic-qualifiers">Automatic qualifiers</h3><p>{automaticIds.length} automatic qualifier{automaticIds.length === 1 ? "" : "s"} locked.</p><ul>{automaticIds.map((id) => <li key={id}>#{entries.get(id)?.carNumber} {entries.get(id)?.name}</li>)}</ul></section>
    {preview.tiedCarIds.length ? <fieldset><legend>Tied cutoff · choose exactly {remaining}</legend>{preview.tiedCarIds.map((id) => <label key={id}><input type="checkbox" checked={tieIds.includes(id)} disabled={!tieIds.includes(id) && tieIds.length >= remaining} onChange={(event) => setTieIds((currentIds) => event.target.checked ? [...currentIds, id] : currentIds.filter((value) => value !== id))} />#{entries.get(id)?.carNumber} {entries.get(id)?.name}</label>)}<button type="button" className="quiet-action" onClick={onClose}>Defer for playoff</button></fieldset> : null}
    <div className="table-scroll"><table aria-label="Advancement placement preview"><thead><tr><th>Rank</th><th>Car</th><th>Destination</th></tr></thead><tbody>{(() => { try { if (selectedIds.length !== rule.topN) return null; const selections = replacing ? prepareReplacementAdvancementSelections(meet, ruleId, selectedIds, current.id) : prepareAdvancementSelections(meet, ruleId, selectedIds); return selections.map((selection) => <tr key={selection.sourceCarId}><td>{selection.rank}</td><td>#{entries.get(selection.sourceCarId)?.carNumber} {entries.get(selection.sourceCarId)?.name}</td><td>{byId.get(selection.destinationBracketId)?.name}</td></tr>); } catch { return null; } })()}</tbody></table></div>
    {requiresReason ? <label>{replacing ? "Reconfirmation reason" : "Decision reason"}<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
    {history.snapshots.some((snapshot) => snapshot.ruleId === ruleId) ? <details><summary>Authoritative history</summary><ol>{history.snapshots.filter((snapshot) => snapshot.ruleId === ruleId).map((snapshot) => <li key={snapshot.id}>{snapshot.confirmedAt} · version {snapshot.sourceResultVersion} · {snapshot.stale ? "stale" : "confirmed"}</li>)}</ol></details> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="dialog-actions"><button type="button" disabled={!valid} onClick={() => void submit()}>{replacing ? "Replace advancement" : "Confirm advancement"}</button><button type="button" className="quiet-action" onClick={onClose}>Cancel</button></div>
  </AdvancementDialog>;
}
