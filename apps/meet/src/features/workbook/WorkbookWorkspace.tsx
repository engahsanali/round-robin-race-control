import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BracketState, MeetStateV1 } from "@rr3/meet-domain";
import type { OrganisationRole } from "../../data/meetRepository";
import { useMeetStore } from "../../state/MeetStore";
import {
  buildScheduleCandidate,
  parseRegistrationPaste,
  registrationRows,
  schedulePayload,
  validateSetupGraph,
  type RegistrationDraft,
  type ScheduleCandidate,
} from "./workbookModel";
import * as workbookViewModel from "./workbookModel";

export type WorkbookActionResult = { ok: boolean; message: string };
export type WorkbookActions = {
  saveSetup(input: MeetStateV1): Promise<WorkbookActionResult>;
  saveRegistration(input: { bracketId: string; expectedVersion: number; rows: RegistrationDraft[] }): Promise<WorkbookActionResult>;
  activateSchedule(input: { bracketId: string; expectedVersion: number; candidate: ReturnType<typeof schedulePayload>; replacementReason: string | null }): Promise<WorkbookActionResult>;
  confirmWinner(input: { heatId: string; winnerId: string; lane: number; laneTimes: Record<string, number>; expectedVersion: number }): Promise<WorkbookActionResult>;
  correctWinner(input: { heatId: string; winnerId: string; lane: number; laneTimes: Record<string, number>; expectedVersion: number; reason: string }): Promise<WorkbookActionResult>;
};

const CREATOR_CREDIT = "Made by Cesar Lacsamana and Ahsan Ali";

export function WorkbookWorkspace({ meet, role, readOnly, actions, heatVersions = {}, onSignOut }: { meet: MeetStateV1; role: OrganisationRole; readOnly: boolean; actions: WorkbookActions; heatVersions?: Readonly<Record<string, number>>; onSignOut?(): void }) {
  const ordered = useMemo(() => meet.brackets.slice().sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id)), [meet.brackets]);
  const [selectedId, setSelectedId] = useState(ordered[0]?.id ?? "");
  const [expanded, setExpanded] = useState(() => new Set<string>(ordered[0] ? [ordered[0].id] : []));
  const [setupOpen, setSetupOpen] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [printAll, setPrintAll] = useState(false);
  const [printRequest, setPrintRequest] = useState<"selected" | "all" | null>(null);
  const prePrintExpanded = useRef<Set<string> | null>(null);
  const [notice, setNotice] = useState("");
  const selected = ordered.find((bracket) => bracket.id === selectedId) ?? ordered[0];
  const store = useMeetStore();

  useEffect(() => {
    if (!selected && ordered[0]) setSelectedId(ordered[0].id);
  }, [ordered, selected]);

  const selectBracket = useCallback((id: string, focusHeading = false) => {
    setSelectedId(id);
    setExpanded((current) => new Set(current).add(id));
    if (focusHeading) setPendingFocusId(id);
  }, []);
  useLayoutEffect(() => {
    if (!pendingFocusId) return;
    const heading = document.getElementById(`bracket-title-${pendingFocusId}`);
    heading?.scrollIntoView?.({ block: "start" });
    heading?.focus();
    setPendingFocusId(null);
  }, [expanded, pendingFocusId]);
  const expandAll = () => setExpanded(new Set(ordered.map((bracket) => bracket.id)));
  const collapseAll = () => setExpanded(new Set(selected ? [selected.id] : []));
  const print = (all: boolean) => {
    prePrintExpanded.current = new Set(expanded);
    setPrintAll(all);
    if (all) expandAll();
    setPrintRequest(all ? "all" : "selected");
  };
  useEffect(() => {
    if (!printRequest) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        window.print();
        if (prePrintExpanded.current) setExpanded(prePrintExpanded.current);
        prePrintExpanded.current = null;
        setPrintAll(false);
        setPrintRequest(null);
      });
    });
    return () => { cancelAnimationFrame(firstFrame); if (secondFrame) cancelAnimationFrame(secondFrame); };
  }, [printRequest]);
  const announce = (result: WorkbookActionResult) => {
    setNotice(result.message);
    return result;
  };

  return (
    <section id="meet-workbook" aria-label="Meet workbook" className={`workbook-page ${printAll ? "print-all" : "print-selected"}`}>
      <a className="skip-link" href="#active-race-control">Skip to active race control</a>
      <header className="meet-toolbar" aria-label="Meet controls">
        <div className="meet-identity"><p className="eyebrow">{meet.meet.status} meet</p><h2>{meet.meet.name}</h2><p>{meet.meet.venue} · <time dateTime={meet.meet.date}>{meet.meet.date}</time></p></div>
        <div className="status-cluster" aria-label="Connection and save status">
          <StatusChip label={readOnly ? "Read-only Viewer" : `Role: ${role}`} tone="neutral" />
          <StatusChip label={`Connection: ${store.state.connectionStatus}`} tone={store.state.connectionStatus === "connected" ? "good" : "warning"} />
          <StatusChip label={`Save: ${store.state.saveStatus}`} tone={store.state.saveStatus === "error" ? "bad" : "good"} />
        </div>
        <nav className="toolbar-actions" aria-label="Workbook actions">
          {!readOnly ? <><button type="button" onClick={() => setSetupOpen(true)}>Meet setup</button><button type="button" onClick={() => setRegistrationOpen(true)}>Registration</button></> : null}
          <button type="button" className="quiet-action" onClick={expandAll}>Expand all</button>
          <button type="button" className="quiet-action" onClick={collapseAll}>Collapse all</button>
          <button type="button" className="quiet-action" onClick={() => print(false)}>Print selected</button>
          <button type="button" className="quiet-action" onClick={() => print(true)}>Print all</button>
          {onSignOut ? <button type="button" className="quiet-action" onClick={onSignOut}>Sign out</button> : null}
        </nav>
        <label className="mobile-bracket-picker"><span>Active bracket</span><select value={selected?.id ?? ""} onChange={(event) => selectBracket(event.target.value)}>{ordered.map((bracket) => <option key={bracket.id} value={bracket.id}>{bracket.name} · {bracket.stage}</option>)}</select></label>
      </header>

      <div className="workbook-layout">
        <aside className="bracket-index" aria-label="Bracket and stage index">
          <h3>Bracket index</h3>
          <ol>{ordered.map((bracket) => <li key={bracket.id}><a href={`#bracket-${bracket.id}`} aria-current={selected?.id === bracket.id ? "location" : undefined} onClick={(event) => { event.preventDefault(); selectBracket(bracket.id, true); }}><span>{bracket.status === "completed" ? "✓" : bracket.status === "running" ? "●" : "○"}</span><span>{bracket.name}<small>{bracket.stage} · {bracket.status}</small></span></a></li>)}</ol>
        </aside>

        <div className="workbook-content">
          <ProgressionSummary meet={meet} />
          <p className="sr-only" aria-live="polite">{notice || store.state.advisory || store.state.error}</p>
          <div className="bracket-stack">
            {ordered.map((bracket) => (
              <BracketSheet
                key={`${bracket.id}:${bracket.version}`}
                bracket={bracket}
                active={selected?.id === bracket.id}
                expanded={expanded.has(bracket.id)}
                readOnly={readOnly}
                role={role}
                actions={actions}
                heatVersions={heatVersions}
                announce={announce}
                onSelect={() => selectBracket(bracket.id)}
                onToggle={() => setExpanded((current) => { const next = new Set(current); next.has(bracket.id) ? next.delete(bracket.id) : next.add(bracket.id); return next; })}
              />
            ))}
          </div>
          <FinalResults meet={meet} />
        </div>
      </div>

      <p className="print-credit">{CREATOR_CREDIT}</p>
      {setupOpen ? <SetupDialog meet={meet} actions={actions} onResult={announce} onClose={() => setSetupOpen(false)} /> : null}
      {registrationOpen && selected ? <RegistrationDialog bracket={selected} actions={actions} onResult={announce} onClose={() => setRegistrationOpen(false)} /> : null}
    </section>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "neutral" | "good" | "warning" | "bad" }) {
  return <span className={`status-chip ${tone}`}><span aria-hidden="true">{tone === "good" ? "✓" : tone === "bad" ? "!" : tone === "warning" ? "△" : "●"}</span>{label}</span>;
}

function ProgressionSummary({ meet }: { meet: MeetStateV1 }) {
  const byId = new Map(meet.brackets.map((bracket) => [bracket.id, bracket]));
  return <section className="progression-panel" aria-labelledby="progression-heading"><div className="panel-heading"><div><p className="eyebrow">Meet flow</p><h3 id="progression-heading">Progression</h3></div><span>{meet.brackets.length} brackets · {meet.advancementRules.length} rules</span></div>
    <svg className="progression-visual" role="img" aria-labelledby="progression-map-title progression-map-description" viewBox="0 0 900 170" preserveAspectRatio="xMidYMid meet">
      <title id="progression-map-title">Qualifier to semifinal to final progression</title>
      <desc id="progression-map-description">Semantic meet graph showing bracket stages and configured advancement paths.</desc>
      <defs><marker id="progression-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
      {["qualifier", "semifinal", "final"].map((stage, stageIndex) => <g key={stage} transform={`translate(${40 + stageIndex * 300} 24)`}><rect width="220" height="118" rx="16" /><text x="18" y="30" className="stage-title">{stage}</text>{meet.brackets.filter((bracket) => bracket.stage === stage).slice(0, 5).map((bracket, index) => <text key={bracket.id} x="18" y={54 + index * 17}>{bracket.name}</text>)}</g>)}
      <path className="progression-edge" d="M260 83 H330" markerEnd="url(#progression-arrow)" /><path className="progression-edge" d="M560 83 H630" markerEnd="url(#progression-arrow)" />
    </svg>
    <div className="table-scroll progression-table"><table aria-label="Progression connections"><thead><tr><th scope="col">Source bracket</th><th scope="col">Top N</th><th scope="col">Destination brackets</th><th scope="col">Status</th></tr></thead><tbody>{meet.advancementRules.length ? meet.advancementRules.map((rule) => <tr key={rule.id}><th scope="row">{byId.get(rule.sourceBracketId)?.name ?? "Unknown"}</th><td>{rule.topN}</td><td>{rule.destinationBracketIds.map((id) => byId.get(id)?.name ?? "Unknown").join(", ")}</td><td>{rule.status}</td></tr>) : <tr><td colSpan={4}>No progression rules configured yet.</td></tr>}</tbody></table></div>
  </section>;
}

const BracketSheet = memo(function BracketSheet({ bracket, active, expanded, readOnly, role, actions, heatVersions, announce, onSelect, onToggle }: { bracket: BracketState; active: boolean; expanded: boolean; readOnly: boolean; role: OrganisationRole; actions: WorkbookActions; heatVersions: Readonly<Record<string, number>>; announce(result: WorkbookActionResult): WorkbookActionResult; onSelect(): void; onToggle(): void }) {
  const activeCars = bracket.event.entries.filter((entry) => entry.active).length;
  const heats = bracket.stage === "final" ? bracket.event.finals : bracket.event.matches;
  const complete = heats.filter((heat) => heat.status === "completed").length;
  const completedPercent = heats.length === 0 ? 0 : Math.round(complete / heats.length * 100);
  const detailsMounted = expanded || active;
  return <section id={`bracket-${bracket.id}`} data-testid="bracket-sheet" className={`bracket-sheet ${active ? "active" : ""}`} aria-labelledby={`bracket-title-${bracket.id}`}>
    <header className="sheet-summary" onClick={onSelect}>
      <button type="button" className="sheet-toggle" aria-expanded={detailsMounted} aria-controls={`bracket-detail-${bracket.id}`} onClick={(event) => { event.stopPropagation(); onToggle(); }}>{detailsMounted ? "−" : "+"}<span className="sr-only"> {detailsMounted ? "Collapse" : "Expand"} {bracket.name}</span></button>
      <div><p className="eyebrow">{bracket.stage} · sheet {bracket.displayOrder}</p><h3 tabIndex={-1} id={`bracket-title-${bracket.id}`}>{bracket.name}</h3></div>
      <dl><div><dt>Cars</dt><dd>{activeCars}</dd></div><div><dt>Progress</dt><dd>{complete}/{heats.length || "—"}</dd></div><div><dt>Status</dt><dd>{bracket.status}</dd></div></dl>
      <span className="summary-copy">{activeCars} active cars</span>
      <progress max={100} value={completedPercent} aria-label={`${bracket.name} completion`}>{completedPercent}%</progress>
    </header>
    {detailsMounted ? <BracketDetails bracket={bracket} active={active} readOnly={readOnly} role={role} actions={actions} heatVersions={heatVersions} announce={announce} /> : null}
  </section>;
});

const BracketDetails = memo(function BracketDetails({ bracket, active, readOnly, role, actions, heatVersions, announce }: { bracket: BracketState; active: boolean; readOnly: boolean; role: OrganisationRole; actions: WorkbookActions; heatVersions: Readonly<Record<string, number>>; announce(result: WorkbookActionResult): WorkbookActionResult }) {
  const view = useMemo(() => workbookViewModel.selectBracketView(bracket), [bracket]);
  return <div id={`bracket-detail-${bracket.id}`} className="sheet-detail">
      <RaceControl bracket={bracket} view={view} readOnly={readOnly} role={role} actions={actions} heatVersions={heatVersions} announce={announce} active={active} />
      <div className="sheet-grid">
        <RegistrationTable bracket={bracket} />
        <ScheduleLab bracket={bracket} readOnly={readOnly} role={role} actions={actions} announce={announce} />
      </div>
      <ScheduleTable bracket={bracket} />
      <StandingsTable bracket={bracket} view={view} />
      <div className="sheet-footer-grid"><section><h4>Advancement cutoff</h4><p>Top {bracket.event.settings.finalistCount || "N not set"} · unresolved ties require an organiser decision.</p></section><section><h4>Selected advancing cars</h4><p>{bracket.lineage.length ? `${bracket.lineage.length} lineage records` : "No selection confirmed."}</p></section><section><h4>Bracket winner</h4><p>{view.winner ? `#${view.winner.carNumber} ${view.winner.carName}` : "Not declared"}</p></section></div>
    </div>;
});

function RegistrationTable({ bracket }: { bracket: BracketState }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "withdrawn">("all");
  const [sort, setSort] = useState<"number" | "participant" | "car">("number");
  const participants = new Map(bracket.event.participants.map((participant) => [participant.id, participant]));
  const rows = bracket.event.entries.filter((entry) => `${entry.carNumber} ${entry.name} ${participants.get(entry.participantId)?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || entry.active === (status === "active"))).slice().sort((a, b) => sort === "number" ? a.carNumber - b.carNumber : sort === "car" ? a.name.localeCompare(b.name) : (participants.get(a.participantId)?.name ?? "").localeCompare(participants.get(b.participantId)?.name ?? ""));
  return <section className="sheet-panel"><div className="panel-heading"><h4>Cars and participants</h4><div className="registration-filters"><label><span className="sr-only">Search cars and participants</span><input type="search" placeholder="Search cars or people" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Car status<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All</option><option value="active">Active</option><option value="withdrawn">Withdrawn</option></select></label><label>Sort cars<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="number">Car number</option><option value="participant">Participant</option><option value="car">Car name</option></select></label></div></div><div className="table-scroll"><table aria-label={`${bracket.name} cars and participants`}><thead><tr><th scope="col">Car #</th><th scope="col">Car</th><th scope="col">Participant</th><th scope="col">State</th></tr></thead><tbody>{rows.map((entry) => <tr key={entry.id}><th scope="row">{entry.carNumber}</th><td>{entry.name}</td><td>{participants.get(entry.participantId)?.name ?? "Unknown"}</td><td>{entry.active ? "Active" : "Withdrawn"}</td></tr>)}</tbody></table></div></section>;
}

function ScheduleLab({ bracket, readOnly, role, actions, announce }: { bracket: BracketState; readOnly: boolean; role: OrganisationRole; actions: WorkbookActions; announce(result: WorkbookActionResult): WorkbookActionResult }) {
  const canSchedule = !readOnly && ["owner", "admin", "organiser"].includes(role);
  const [seed, setSeed] = useState(bracket.event.settings.seed || "meet-schedule");
  const [rounds, setRounds] = useState(5);
  const [candidate, setCandidate] = useState<ScheduleCandidate | null>(null);
  const [error, setError] = useState("");
  const [replacementReason, setReplacementReason] = useState("");
  const replacing = bracket.event.matches.length > 0 || bracket.event.finals.length > 0;
  const generate = () => { try { setCandidate(buildScheduleCandidate(bracket, { seed, rounds })); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Schedule generation failed."); } };
  return <section className="sheet-panel schedule-lab"><div className="panel-heading"><h4>Schedule quality</h4><span>{candidate?.source ?? "No candidate"}</span></div>{canSchedule ? <div className="schedule-form"><label>Seed<input value={seed} maxLength={128} onChange={(event) => setSeed(event.target.value)} /></label><label>Rounds<input type="number" min={1} max={10} value={rounds} onChange={(event) => setRounds(Number(event.target.value))} /></label><button type="button" onClick={generate}>Generate candidate</button></div> : <p>Viewer-safe schedule summary.</p>}{error ? <p role="alert">{error}</p> : null}{candidate ? <><dl className="quality-grid"><div><dt>Opponent repeats</dt><dd>{candidate.quality.opponentRepeatExcess}</dd></div><div><dt>Appearances</dt><dd>{candidate.quality.appearanceMinimum}–{candidate.quality.appearanceMaximum} per car</dd></div><div><dt>Byes</dt><dd>{candidate.quality.totalByes} total · max {candidate.quality.maximumByes}</dd></div><div><dt>Max car repeat burden</dt><dd>{candidate.quality.maxCarRepeatBurden}</dd></div><div><dt>Lower-bound gap</dt><dd>{candidate.quality.gap}</dd></div><div><dt>Max pair frequency</dt><dd>{candidate.quality.maxPairFrequency}</dd></div><div><dt>Lane spread</dt><dd>{candidate.quality.laneSpread}</dd></div><div><dt>Certificate</dt><dd>{candidate.quality.provenOptimal ? "Certified optimal" : "Best found"}</dd></div></dl>{canSchedule ? <>{replacing ? <label>Replacement reason<textarea required maxLength={500} value={replacementReason} onChange={(event) => setReplacementReason(event.target.value)} /></label> : null}<button type="button" disabled={replacing && !replacementReason.trim()} onClick={() => void actions.activateSchedule({ bracketId: bracket.id, expectedVersion: bracket.version, candidate: schedulePayload(candidate), replacementReason: replacing ? replacementReason.trim() : null }).then(announce)}>Activate schedule</button></> : null}</> : null}</section>;
}

function ScheduleTable({ bracket }: { bracket: BracketState }) {
  const cars = new Map(bracket.event.entries.map((entry) => [entry.id, entry]));
  const heats = [...bracket.event.matches, ...bracket.event.finals];
  return <section className="sheet-panel full-width"><h4>Bracket schedule</h4><div className="table-scroll"><table aria-label={`${bracket.name} schedule`}><thead><tr><th scope="col">Round</th><th scope="col">Heat</th><th scope="col">Lane 1</th><th scope="col">Lane 2</th><th scope="col">Lane 3</th><th scope="col">Winner</th><th scope="col">Status</th></tr></thead><tbody>{heats.length ? heats.map((heat) => <tr key={heat.id}><th scope="row">{heat.matchNumber}</th><td>{heat.heatNumber}</td>{heat.lanes.map((carId, index) => <td key={index}>{carId ? `#${cars.get(carId)?.carNumber} ${cars.get(carId)?.name}` : "—"}</td>)}<td>{heat.winnerEntryId ? `#${cars.get(heat.winnerEntryId)?.carNumber}` : "—"}</td><td>{heat.status}</td></tr>) : <tr><td colSpan={7}>Generate and activate a schedule to begin racing.</td></tr>}</tbody></table></div></section>;
}

function StandingsTable({ bracket, view }: { bracket: BracketState; view: ReturnType<typeof workbookViewModel.selectBracketView> }) {
  return <section className="sheet-panel full-width"><h4>Standings</h4>{view.standings.every((row) => row.rank === null) ? <p className="ranking-notice">Competitive rankings appear after the first official result.</p> : null}<div className="table-scroll"><table aria-label={`${bracket.name} standings`}><thead><tr><th scope="col">Rank</th><th scope="col">Car</th><th scope="col">Participant</th><th scope="col">Wins</th><th scope="col">Heats</th><th scope="col">Tie state</th></tr></thead><tbody>{view.standings.map((row) => <tr key={row.carId}><td>{row.rank ?? "—"}</td><th scope="row">#{row.carNumber} {row.carName}</th><td>{row.participantName}</td><td>{row.totalWins}</td><td>{row.completedHeats}</td><td>{row.isTied && row.rank !== null ? "Tied" : row.rank === null ? "No official rank" : "Resolved"}</td></tr>)}</tbody></table></div></section>;
}

function RaceControl({ bracket, view, readOnly, role, actions, heatVersions, announce, active }: { bracket: BracketState; view: ReturnType<typeof workbookViewModel.selectBracketView>; readOnly: boolean; role: OrganisationRole; actions: WorkbookActions; heatVersions: Readonly<Record<string, number>>; announce(result: WorkbookActionResult): WorkbookActionResult; active: boolean }) {
  const canRace = !readOnly && ["owner", "admin", "organiser", "marshal"].includes(role);
  const [lane, setLane] = useState(1);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const heat = view.currentHeat;
  const completed = [...bracket.event.matches, ...bracket.event.finals].filter((candidate) => candidate.status === "completed");
  const activeHeat = heat ?? completed[0] ?? null;
  const cars = new Map(bracket.event.entries.map((entry) => [entry.id, entry]));
  const confirm = useCallback(() => {
    if (!canRace || !heat) return;
    const winnerId = heat.lanes[lane - 1];
    if (!winnerId) return;
    void actions.confirmWinner({ heatId: heat.id, winnerId, lane, laneTimes: {}, expectedVersion: heatVersions[heat.id] ?? 1 }).then(announce);
  }, [actions, announce, canRace, heat, heatVersions, lane]);
  useEffect(() => {
    if (!active || !canRace) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select, option, [role="button"], [role="link"], [role="dialog"], [aria-modal="true"], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])')) return;
      if (["1", "2", "3"].includes(event.key)) { setLane(Number(event.key)); event.preventDefault(); }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") { setLane((current) => current === 1 ? 3 : current - 1); event.preventDefault(); }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") { setLane((current) => current === 3 ? 1 : current + 1); event.preventDefault(); }
      if (event.key === "Enter") { confirm(); event.preventDefault(); }
      if (event.key === "?") { document.getElementById(`keyboard-help-${bracket.id}`)?.focus(); }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, bracket.id, canRace, confirm]);
  return <section id={active ? "active-race-control" : undefined} className="race-control" aria-label={`${bracket.name} current race`}>
    <div><p className="eyebrow">Current / next race</p><h4>{heat ? `Round ${heat.matchNumber} · Heat ${heat.heatNumber}` : completed.length ? "Bracket racing complete" : "Schedule not active"}</h4><p>{view.nextHeat ? `Next: Round ${view.nextHeat.matchNumber}, Heat ${view.nextHeat.heatNumber}` : "No queued heat"}</p></div>
    {activeHeat ? <div className="lane-controls" role="radiogroup" aria-label="Winner lane">{activeHeat.lanes.map((carId, index) => carId ? <button type="button" role="radio" aria-checked={lane === index + 1} key={carId} className={lane === index + 1 ? "selected" : ""} disabled={!canRace || !heat} onClick={() => setLane(index + 1)}><span>Lane {index + 1}</span><strong>#{cars.get(carId)?.carNumber}</strong><small>{cars.get(carId)?.name}</small></button> : null)}</div> : null}
    {canRace && heat ? <button className="confirm-winner" type="button" onClick={confirm}>Confirm winner · Lane {lane}</button> : null}
    {canRace && completed.length ? <button type="button" className="quiet-danger" onClick={() => setCorrectionOpen(true)}>Correct result</button> : null}
    <button id={`keyboard-help-${bracket.id}`} type="button" className="keyboard-hint" aria-label="Keyboard help">1/2/3 lane · arrows move · Enter confirms · ? help</button>
    {correctionOpen && completed.length ? <CorrectionDialog heats={completed} bracket={bracket} actions={actions} heatVersions={heatVersions} announce={announce} onClose={() => setCorrectionOpen(false)} /> : null}
  </section>;
}

function SetupDialog({ meet, actions, onResult, onClose }: { meet: MeetStateV1; actions: WorkbookActions; onResult(result: WorkbookActionResult): WorkbookActionResult; onClose(): void }) {
  const [draft, setDraft] = useState(() => structuredClone(meet));
  const [errors, setErrors] = useState<string[]>([]);
  const submit = async (event: FormEvent) => { event.preventDefault(); const issues = validateSetupGraph(draft); setErrors(issues); if (issues.length) return; const result = await actions.saveSetup(draft); onResult(result); if (result.ok) onClose(); };
  const addBracket = () => setDraft((current) => {
    if (current.brackets.length >= 15) return current;
    const id = crypto.randomUUID();
    const template = current.brackets[0]!;
    const displayOrder = current.brackets.length + 1;
    const stage: BracketState["stage"] = "final";
    const bracket: BracketState = {
      ...structuredClone(template), id, name: `Final ${displayOrder}`, stage, displayOrder, status: "setup", version: 1, lineage: [],
      event: { ...structuredClone(template.event), event: { ...template.event.event, id, name: `Final ${displayOrder}`, status: "setup", resultSeal: "draft" }, participants: [], entries: [], matches: [], finals: [], payments: [], auditLog: [] },
    };
    return { ...current, brackets: [...current.brackets, bracket] };
  });
  const addRule = () => setDraft((current) => {
    const ordered = current.brackets.slice().sort((a, b) => a.displayOrder - b.displayOrder);
    const destination = ordered.find((bracket) => bracket.stage === "final") ?? ordered.at(-1);
    const source = ordered.find((bracket) => bracket.id !== destination?.id && bracket.stage !== "final");
    if (!source || !destination) return current;
    return { ...current, advancementRules: [...current.advancementRules, { id: crypto.randomUUID(), version: 1, sourceBracketId: source.id, destinationBracketIds: [destination.id], destinationOrder: [destination.id], topN: 3, destinationCapacity: 12, status: "active" }] };
  });
  return <WorkbookDialog title="Meet setup" onClose={onClose}><form onSubmit={(event) => void submit(event)}>
    <div className="dialog-grid"><label>Meet name<input autoFocus data-initial-focus required maxLength={200} value={draft.meet.name} onChange={(event) => setDraft((current) => ({ ...current, meet: { ...current.meet, name: event.target.value } }))} /></label><label>Venue<input maxLength={200} value={draft.meet.venue} onChange={(event) => setDraft((current) => ({ ...current, meet: { ...current.meet, venue: event.target.value } }))} /></label><label>Date<input type="date" required value={draft.meet.date} onChange={(event) => setDraft((current) => ({ ...current, meet: { ...current.meet, date: event.target.value } }))} /></label></div>
    <div className="setup-section-heading"><h3>Brackets and stages</h3><button type="button" disabled={draft.brackets.length >= 15} onClick={addBracket}>Add bracket</button></div>
    <div className="setup-brackets">{draft.brackets.map((bracket, index) => { const removable = bracket.status === "setup" && bracket.event.entries.length === 0 && bracket.event.matches.length === 0 && bracket.event.finals.length === 0 && bracket.lineage.length === 0; return <fieldset key={bracket.id}><legend>Bracket {index + 1}</legend><label><span className="sr-only">Bracket {index + 1} name</span><input required value={bracket.name} maxLength={200} onChange={(event) => setDraft((current) => ({ ...current, brackets: current.brackets.map((item) => item.id === bracket.id ? { ...item, name: event.target.value, event: { ...item.event, event: { ...item.event.event, name: event.target.value } } } : item) }))} /></label><label>Bracket {index + 1} stage<select value={bracket.stage} onChange={(event) => setDraft((current) => ({ ...current, brackets: current.brackets.map((item) => item.id === bracket.id ? { ...item, stage: event.target.value as BracketState["stage"] } : item) }))}><option value="qualifier">Qualifier</option><option value="semifinal">Semifinal</option><option value="final">Final</option></select></label><label>Bracket {index + 1} order<input type="number" min={1} max={15} value={bracket.displayOrder} onChange={(event) => setDraft((current) => ({ ...current, brackets: current.brackets.map((item) => item.id === bracket.id ? { ...item, displayOrder: Number(event.target.value) } : item) }))} /></label><label>Bracket {index + 1} status<select value={bracket.status} onChange={(event) => setDraft((current) => ({ ...current, brackets: current.brackets.map((item) => item.id === bracket.id ? { ...item, status: event.target.value as BracketState["status"] } : item) }))}><option value="setup">Setup</option><option value="running">Running</option><option value="completed">Completed</option></select></label>{removable ? <button type="button" className="quiet-danger" aria-label={`Remove bracket ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, brackets: current.brackets.filter((item) => item.id !== bracket.id), advancementRules: current.advancementRules.map((rule) => ({ ...rule, destinationBracketIds: rule.destinationBracketIds.filter((id) => id !== bracket.id), destinationOrder: rule.destinationOrder.filter((id) => id !== bracket.id) })).filter((rule) => rule.sourceBracketId !== bracket.id && rule.destinationBracketIds.length > 0) }))}>Remove bracket</button> : <span>Removal locked after registration, scheduling or lineage.</span>}</fieldset>; })}</div>
    <div className="setup-section-heading"><h3>Progression rules</h3><button type="button" disabled={draft.brackets.length < 2} onClick={addRule}>Add progression rule</button></div>
    <div className="setup-rules">{draft.advancementRules.length ? draft.advancementRules.map((rule, index) => <fieldset key={rule.id}><legend>Rule {index + 1} · Top N advance</legend><label>Source bracket<select value={rule.sourceBracketId} onChange={(event) => setDraft((current) => ({ ...current, advancementRules: current.advancementRules.map((item) => item.id === rule.id ? { ...item, sourceBracketId: event.target.value } : item) }))}>{draft.brackets.map((bracket) => <option key={bracket.id} value={bracket.id}>{bracket.name}</option>)}</select></label><label>Top N advance<input type="number" min={1} max={10000} value={rule.topN} onChange={(event) => setDraft((current) => ({ ...current, advancementRules: current.advancementRules.map((item) => item.id === rule.id ? { ...item, topN: Number(event.target.value) } : item) }))} /></label><label>Destination capacity<input type="number" min={1} max={10000} value={rule.destinationCapacity} onChange={(event) => setDraft((current) => ({ ...current, advancementRules: current.advancementRules.map((item) => item.id === rule.id ? { ...item, destinationCapacity: Number(event.target.value) } : item) }))} /></label><label>Rule status<select value={rule.status} onChange={(event) => setDraft((current) => ({ ...current, advancementRules: current.advancementRules.map((item) => item.id === rule.id ? { ...item, status: event.target.value as typeof rule.status } : item) }))}><option value="active">Active</option><option value="disabled">Disabled</option></select></label><label>Destination brackets<select multiple size={Math.min(6, draft.brackets.length)} value={rule.destinationBracketIds} onChange={(event) => { const ids = [...event.target.selectedOptions].map((option) => option.value); setDraft((current) => ({ ...current, advancementRules: current.advancementRules.map((item) => item.id === rule.id ? { ...item, destinationBracketIds: ids, destinationOrder: ids } : item) })); }}>{draft.brackets.map((bracket) => <option key={bracket.id} value={bracket.id}>{bracket.name}</option>)}</select></label><div aria-label={`Destination order for rule ${index + 1}`}>{rule.destinationOrder.map((id, orderIndex) => <span key={id}>{draft.brackets.find((bracket) => bracket.id === id)?.name ?? "Unknown"}<button type="button" disabled={orderIndex === 0} aria-label={`Move destination ${orderIndex + 1} up`} onClick={() => setDraft((current) => ({ ...current, advancementRules: current.advancementRules.map((item) => item.id === rule.id ? { ...item, destinationOrder: item.destinationOrder.map((value, position, order) => position === orderIndex ? order[orderIndex - 1]! : position === orderIndex - 1 ? order[orderIndex]! : value) } : item) }))}>↑</button><button type="button" aria-label={`Remove destination ${orderIndex + 1}`} onClick={() => setDraft((current) => ({ ...current, advancementRules: current.advancementRules.map((item) => item.id === rule.id ? { ...item, destinationBracketIds: item.destinationBracketIds.filter((value) => value !== id), destinationOrder: item.destinationOrder.filter((value) => value !== id) } : item) }))}>×</button></span>)}</div><button type="button" className="quiet-danger" aria-label={`Remove rule ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, advancementRules: current.advancementRules.filter((item) => item.id !== rule.id) }))}>Remove rule</button></fieldset>) : <p>No qualifier-to-semifinal/final edges configured.</p>}</div>
    {errors.length ? <ul role="alert">{errors.map((message) => <li key={message}>{message}</li>)}</ul> : null}
    <div className="dialog-actions"><button type="submit">Save workbook</button><button type="button" className="quiet-action" onClick={onClose}>Cancel</button></div>
  </form></WorkbookDialog>;
}

function RegistrationDialog({ bracket, actions, onResult, onClose }: { bracket: BracketState; actions: WorkbookActions; onResult(result: WorkbookActionResult): WorkbookActionResult; onClose(): void }) {
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<ReturnType<typeof parseRegistrationPaste> | null>(null);
  const [rows, setRows] = useState(() => registrationRows(bracket));
  const [pendingStatus, setPendingStatus] = useState<{ carId: string; active: boolean } | null>(null);
  const [error, setError] = useState("");
  const hasImpact = bracket.event.matches.length + bracket.event.finals.length > 0 || bracket.lineage.length > 0;
  const update = (carId: string, field: keyof RegistrationDraft, value: string | number | boolean) => setRows((current) => {
    const source = current.find((row) => row.carId === carId);
    const participantField = ["participantName", "email", "phone", "notes"].includes(field);
    return current.map((row) => row.carId === carId || (participantField && row.participantId === source?.participantId) ? { ...row, [field]: value } : row);
  });
  const validateRows = (candidate: RegistrationDraft[]) => {
    const numbers = new Set<number>();
    for (const row of candidate) {
      if (!row.participantName.trim() || !row.carName.trim() || !Number.isSafeInteger(row.carNumber) || row.carNumber < 1 || row.carNumber > 999_999 || numbers.has(row.carNumber)) return false;
      numbers.add(row.carNumber);
    }
    return candidate.length > 0;
  };
  const save = async () => { if (!validateRows(rows)) { setError("Fix every row before saving. Car numbers must be unique and all names are required."); return; } const result = await actions.saveRegistration({ bracketId: bracket.id, expectedVersion: bracket.version, rows }); onResult(result); if (result.ok) onClose(); };
  const applyPaste = () => { const next = parseRegistrationPaste(paste); setParsed(next); if (next.ok) { setRows(next.rows); setError(""); } };
  const requestStatus = (row: RegistrationDraft) => { const next = !row.active; if (hasImpact) setPendingStatus({ carId: row.carId, active: next }); else update(row.carId, "active", next); };
  const pendingRow = pendingStatus ? rows.find((row) => row.carId === pendingStatus.carId) : null;
  return <WorkbookDialog title={`Registration · ${bracket.name}`} onClose={onClose}><p>Edit each participant and car, or paste one car per line. Cars sharing the same email are grouped under one participant identity.</p><div className="registration-editor">{rows.map((row, index) => <fieldset key={row.carId}><legend>Car #{row.carNumber}</legend><label>Car {row.carNumber} participant<input data-initial-focus={index === 0 ? true : undefined} required maxLength={200} value={row.participantName} onChange={(event) => update(row.carId, "participantName", event.target.value)} /></label><label>Participant email<input type="email" maxLength={320} value={row.email} onChange={(event) => update(row.carId, "email", event.target.value)} /></label><label>Participant phone<input maxLength={80} value={row.phone} onChange={(event) => update(row.carId, "phone", event.target.value)} /></label><label>Participant notes<textarea maxLength={500} value={row.notes} onChange={(event) => update(row.carId, "notes", event.target.value)} /></label><label>Car number<input type="number" min={1} max={999999} value={row.carNumber} onChange={(event) => update(row.carId, "carNumber", Number(event.target.value))} /></label><label>Car name<input required maxLength={200} value={row.carName} onChange={(event) => update(row.carId, "carName", event.target.value)} /></label><button type="button" className={row.active ? "quiet-danger" : "quiet-action"} onClick={() => requestStatus(row)}>{row.active ? `Withdraw car #${row.carNumber}` : `Restore car #${row.carNumber}`}</button></fieldset>)}</div><details><summary>Bulk paste</summary><label>Bulk registration rows<textarea value={paste} onChange={(event) => { setPaste(event.target.value); setParsed(null); }} placeholder={'7\tCesar\tComet\tcesar@example.com\n8\tCesar\tNova\tcesar@example.com'} /></label><button type="button" onClick={applyPaste}>Validate and replace rows</button></details>{parsed ? parsed.ok ? <p role="status">{parsed.rows.length} valid rows. The server will save the complete candidate atomically.</p> : <ul role="alert">{parsed.errors.map((message) => <li key={message}>{message}</li>)}</ul> : null}{error ? <p role="alert">{error}</p> : null}<div className="dialog-actions"><button type="button" disabled={!validateRows(rows)} onClick={() => void save()}>Save registration batch</button><button type="button" className="quiet-action" onClick={onClose}>Cancel</button></div>{pendingRow && pendingStatus ? <WorkbookDialog role="alertdialog" title={`${pendingStatus.active ? "Restore" : "Withdraw"} car #${pendingRow.carNumber}`} onClose={() => setPendingStatus(null)}><p>This car is scheduled and/or has advancement lineage. Changing its status can invalidate heats and downstream selections.</p><div className="dialog-actions"><button type="button" className="quiet-danger" onClick={() => { update(pendingRow.carId, "active", pendingStatus.active); setPendingStatus(null); }}>Confirm status change</button><button type="button" onClick={() => setPendingStatus(null)}>Keep current status</button></div></WorkbookDialog> : null}</WorkbookDialog>;
}

function CorrectionDialog({ heats, bracket, actions, heatVersions, announce, onClose }: { heats: BracketState["event"]["matches"]; bracket: BracketState; actions: WorkbookActions; heatVersions: Readonly<Record<string, number>>; announce(result: WorkbookActionResult): WorkbookActionResult; onClose(): void }) {
  const [heatId, setHeatId] = useState(heats[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [lane, setLane] = useState(1);
  const heat = heats.find((candidate) => candidate.id === heatId) ?? heats[0]!;
  const save = async () => { const winnerId = heat.lanes[lane - 1]; if (!winnerId || !reason.trim()) return; const result = await actions.correctWinner({ heatId: heat.id, winnerId, lane, laneTimes: {}, expectedVersion: heatVersions[heat.id] ?? 1, reason: reason.trim() }); announce(result); if (result.ok) onClose(); };
  return <WorkbookDialog title="Correct official result" onClose={onClose}><label>Completed heat<select autoFocus data-initial-focus value={heat.id} onChange={(event) => { setHeatId(event.target.value); setLane(1); }}>{heats.map((candidate) => <option key={candidate.id} value={candidate.id}>Round {candidate.matchNumber} · Heat {candidate.heatNumber}</option>)}</select></label><label>Winning lane<select value={lane} onChange={(event) => setLane(Number(event.target.value))}>{heat.lanes.map((carId, index) => carId ? <option key={carId} value={index + 1}>Lane {index + 1} · #{bracket.event.entries.find((entry) => entry.id === carId)?.carNumber}</option> : null)}</select></label><label>Reason<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="dialog-actions"><button type="button" disabled={!reason.trim()} onClick={() => void save()}>Save correction</button><button type="button" className="quiet-action" onClick={onClose}>Cancel</button></div></WorkbookDialog>;
}

function WorkbookDialog({ title, onClose, children, role = "dialog" }: { title: string; onClose(): void; children: ReactNode; role?: "dialog" | "alertdialog" }) {
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [portalRoot] = useState(() => { const root = document.createElement("div"); root.dataset.workbookPortal = "true"; return root; });
  const [titleId] = useState(() => `workbook-dialog-${crypto.randomUUID()}`);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!portalRoot.isConnected) document.body.append(portalRoot);
    const inertTargets = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== portalRoot);
    const priorInert = new Map(inertTargets.map((target) => [target, { value: target.inert, attribute: target.hasAttribute("inert") }]));
    for (const target of inertTargets) { target.inert = true; target.setAttribute("inert", ""); }
    node?.querySelector<HTMLElement>("[data-initial-focus], input, select, textarea, button")?.focus();
    const focusable = () => node ? [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])')].filter((item) => !item.hasAttribute("hidden")) : [];
    const recoverFocus = () => focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (portalRoot.inert) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !node) return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!; const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => { if (!portalRoot.inert && node && event.target instanceof Node && !node.contains(event.target)) recoverFocus(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", onFocus, true); for (const target of inertTargets) { const prior = priorInert.get(target); target.inert = prior?.value ?? false; if (!prior?.attribute) target.removeAttribute("inert"); } portalRoot.remove(); returnFocus.current?.focus(); };
  }, [onClose, portalRoot]);
  return createPortal(<div className="dialog-backdrop"><div ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} className="workbook-dialog"><div className="dialog-title"><h2 id={titleId}>{title}</h2><button type="button" className="quiet-action" aria-label={`Close ${title}`} onClick={onClose}>×</button></div>{children}</div></div>, portalRoot);
}

function FinalResults({ meet }: { meet: MeetStateV1 }) {
  const finals = meet.brackets.filter((bracket) => bracket.stage === "final");
  return <section className="meet-results" aria-labelledby="meet-results-heading"><p className="eyebrow">Overall outcome</p><h3 id="meet-results-heading">Final-stage and meet results</h3>{finals.length ? finals.map((bracket) => { const heats = bracket.event.finals; const winner = heats.length > 0 && heats.every((heat) => heat.status === "completed") ? workbookViewModel.selectBracketView(bracket).winner : null; return <article key={bracket.id}><strong>{bracket.name}</strong><span>{winner ? `Winner: #${winner.carNumber} ${winner.carName}` : "Awaiting final result"}</span></article>; }) : <p>Add a final-stage bracket to publish the meet result.</p>}</section>;
}
