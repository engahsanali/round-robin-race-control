import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventStateV1, Heat } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import type { CommandReceipt } from "../../state/commands";
import {
  publishSpectatorSnapshot,
  subscribeToSpectatorRequests,
} from "../presentation/eventChannel";
import { HeatStage } from "./HeatStage";
import { ResultReceipt } from "./ResultReceipt";
import { useAnnouncer } from "./useAnnouncer";
import { useWakeLock } from "./useWakeLock";

type IssueState = "ready" | "called" | "delayed" | "held";

type UndoState = {
  before: EventStateV1;
  receipt: CommandReceipt;
  committedUpdatedAt: string;
  expiresAt: number;
};

const emptyTimes: [string, string, string] = ["", "", ""];

export function RaceCommandPage() {
  const eventState = useOptionalEventState();
  const event = eventState?.state ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const eventRef = useRef(event);
  const pendingRef = useRef(false);
  const [selectedHeatId, setSelectedHeatId] = useState<string | null>(null);
  const [pendingLane, setPendingLane] = useState<number | null>(null);
  const [times, setTimes] = useState<[string, string, string]>(emptyTimes);
  const [correctionReason, setCorrectionReason] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [issues, setIssues] = useState<Record<string, IssueState>>({});
  const [receipt, setReceipt] = useState<CommandReceipt | null>(null);
  const [receiptDescription, setReceiptDescription] = useState("");
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const announcer = useAnnouncer();
  const wakeLock = useWakeLock();

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("rr3:result-dirty", { detail: pendingLane !== null || times.some(Boolean) || Boolean(correctionReason.trim()) }));
    return () => { window.dispatchEvent(new CustomEvent("rr3:result-dirty", { detail: false })); };
  }, [correctionReason, pendingLane, times]);

  eventRef.current = event;
  const heats = useMemo(() => orderedHeats(event), [event]);
  const firstRunnable = useMemo(
    () => heats.find(({ status }) => status === "scheduled" || status === "rerun") ?? heats[0] ?? null,
    [heats],
  );
  const current = heats.find(({ id }) => id === selectedHeatId) ?? firstRunnable;
  const currentIndex = current ? heats.findIndex(({ id }) => id === current.id) : -1;

  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    if (!current) return;
    setSelectedHeatId(current.id);
    setPendingLane(null);
    setTimes(current.laneTimesMs.map((value) => value === null ? "" : (value / 1_000).toFixed(3)) as [string, string, string]);
    setCorrectionReason("");
    setActionReason("");
    setError("");
  }, [current?.id]);

  useEffect(() => {
    if (!event) return;
    publishSpectatorSnapshot(event);
  }, [event]);

  useEffect(() => subscribeToSpectatorRequests(() => eventRef.current), []);

  const selectHeat = useCallback((index: number) => {
    const next = heats[index];
    if (next) setSelectedHeatId(next.id);
  }, [heats]);

  const chooseLane = useCallback((lane: number) => {
    if (!current?.lanes[lane - 1]) return;
    setPendingLane(lane);
    setError("");
    setMessage(`Lane ${lane} selected for confirmation.`);
  }, [current]);

  const commitWinner = useCallback(async () => {
    if (!eventState || !event || !current || pendingRef.current) return;
    if (pendingLane === null) { setError("Choose a winning lane before confirming the result."); return; }
    const carId = current.lanes[pendingLane - 1];
    if (!carId) { setError("The selected lane is vacant."); return; }
    const isCorrection = current.status === "completed" && current.winnerEntryId !== carId;
    if (current.status === "completed" && current.winnerEntryId === carId) { setError("That car is already the official winner for this heat."); return; }
    if (isCorrection && !correctionReason.trim()) { setError("A correction reason is required when replacing an official winner."); return; }
    let laneTimesMs: [number | null, number | null, number | null];
    try { laneTimesMs = parseLaneTimes(times, current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Lane times are invalid."); return; }

    const before = structuredClone(event);
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const nextReceipt = await eventState.dispatchEventCommand({
        type: "result.record-winner",
        heatId: current.id,
        carId,
        correctionReason: isCorrection ? correctionReason.trim() : undefined,
        laneTimesMs,
      });
      const entry = event.entries.find(({ id }) => id === carId);
      const description = isCorrection
        ? `Changed winner to Car ${entry?.carNumber ?? carId} for ${heatLabel(current)}`
        : `Recorded Car ${entry?.carNumber ?? carId} for ${heatLabel(current)}`;
      setReceipt(nextReceipt);
      setReceiptDescription(description);
      setUndo({ before, receipt: nextReceipt, committedUpdatedAt: nextReceipt.timestamp, expiresAt: Date.now() + 30_000 });
      setMessage("Official result committed.");
      announcer.announce(`${description}.`);
      setPendingLane(null);
      if (!isCorrection) {
        const nextIndex = heats.findIndex(({ id }) => id === current.id) + 1;
        const nextRunnable = heats.slice(nextIndex).find(({ status }) => status === "scheduled" || status === "rerun");
        if (nextRunnable) setSelectedHeatId(nextRunnable.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The result could not be committed.");
    } finally { pendingRef.current = false; setPending(false); }
  }, [correctionReason, current, event, eventState, heats, pending, pendingLane, times]);

  const runHeatAction = useCallback(async (type: "heat.mark-rerun" | "heat.cancel") => {
    if (!eventState || !event || !current || pendingRef.current) return;
    if (!actionReason.trim()) { setError("A heat action reason is required."); return; }
    const before = structuredClone(event);
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const nextReceipt = await eventState.dispatchEventCommand({ type, heatId: current.id, reason: actionReason.trim() });
      const description = type === "heat.mark-rerun" ? `Marked ${heatLabel(current)} for rerun` : `Cancelled ${heatLabel(current)}`;
      setReceipt(nextReceipt);
      setReceiptDescription(description);
      setUndo({ before, receipt: nextReceipt, committedUpdatedAt: nextReceipt.timestamp, expiresAt: Date.now() + 30_000 });
      setMessage(`${description}.`);
      setActionReason("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The heat action failed."); }
    finally { pendingRef.current = false; setPending(false); }
  }, [actionReason, current, event, eventState, pending]);

  const undoLast = useCallback(async () => {
    if (!eventState || !undo || pendingRef.current) return;
    if (!undo.receipt.undoUntil || Date.now() > undo.expiresAt) { setUndo(null); setError("The 30-second undo window has expired."); return; }
    if (eventState.state?.event.updatedAt !== undo.committedUpdatedAt) { setUndo(null); setError("Undo is unavailable after another event change."); return; }
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await eventState.dispatchEventCommand({ type: "event.replace", event: undo.before, summary: `Undo ${undo.receipt.summary}` });
      setMessage("The previous official state was restored.");
      setSelectedHeatId(current?.id ?? null);
      setReceipt(null);
      setUndo(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Undo failed."); }
    finally { pendingRef.current = false; setPending(false); }
  }, [current?.id, eventState, pending, undo]);

  const callCurrent = useCallback(() => {
    if (!current || !event) return;
    setIssues((value) => ({ ...value, [current.id]: "called" }));
    const assignments = current.lanes.flatMap((carId, index) => {
      const entry = event.entries.find(({ id }) => id === carId);
      return entry ? [`Lane ${index + 1}, Car ${entry.carNumber}`] : [];
    });
    announcer.announce(`Match ${current.matchNumber}, Heat ${current.heatNumber}, ${assignments.join(", ")}`);
    setMessage(`${heatLabel(current)} called to the lanes.`);
  }, [announcer, current, event]);

  const markIssue = useCallback((issue: "delayed" | "held") => {
    if (!current) return;
    setIssues((value) => ({ ...value, [current.id]: issue }));
    setMessage(`${heatLabel(current)} marked ${issue}.`);
  }, [current]);

  useEffect(() => {
    const handleKey = (keyboard: KeyboardEvent) => {
      const target = keyboard.target;
      if (target instanceof Element && target.matches("input, textarea, select, button, a")) return;
      if (keyboard.key === "1" || keyboard.key === "2" || keyboard.key === "3") {
        keyboard.preventDefault();
        chooseLane(Number(keyboard.key));
      } else if (keyboard.key === "Enter") {
        keyboard.preventDefault();
        void commitWinner();
      } else if (keyboard.key.toLowerCase() === "u") {
        keyboard.preventDefault();
        void undoLast();
      } else if (keyboard.key === "ArrowLeft") {
        keyboard.preventDefault();
        selectHeat(Math.max(0, currentIndex - 1));
      } else if (keyboard.key === "ArrowRight") {
        keyboard.preventDefault();
        selectHeat(Math.min(heats.length - 1, currentIndex + 1));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [chooseLane, commitWinner, currentIndex, heats.length, selectHeat, undoLast]);

  if (!eventState || eventState.loading) return <RaceUnavailable message="Loading the local event…" />;
  if (!event || !current) return <RaceUnavailable message="Create or load an event with an active schedule before opening live race control." />;

  const issueItems = heats.filter((heat) => issues[heat.id] === "delayed" || issues[heat.id] === "held");
  const previousHeat = heats[currentIndex - 1] ?? null;
  const nextHeat = heats[currentIndex + 1] ?? null;
  const undoable = Boolean(undo?.receipt.undoUntil && Date.now() <= undo.expiresAt);
  return (
    <section className="page-frame race-command-page" aria-labelledby="page-title">
      <div className="race-command-heading">
        <div><p className="eyebrow">Keyboard-first live operations</p><h2 ref={headingRef} id="page-title" tabIndex={-1}>Race Command Center</h2></div>
        <div className="live-control-toggles">
          <button type="button" onClick={announcer.enabled ? announcer.disable : announcer.enable} disabled={!announcer.available}>{announcer.enabled ? "Disable announcer" : "Enable announcer"}</button>
          <button type="button" onClick={wakeLock.enabled ? wakeLock.disable : wakeLock.enable}>{wakeLock.enabled ? "Disable wake lock" : "Enable wake lock"}</button>
        </div>
      </div>
      <p className="page-intro">Use 1, 2, or 3 to choose a lane, Enter to commit, arrow keys to move through heats, and U to undo the latest eligible command.</p>
      <p role="status" aria-label="Wake lock status">Wake lock {wakeLock.status}</p>
      <nav className="heat-navigation" aria-label="Heat navigation">
        <button type="button" onClick={() => selectHeat(currentIndex - 1)} disabled={currentIndex <= 0}>Previous heat</button>
        <span>{currentIndex + 1} of {heats.length}</span>
        <button type="button" onClick={() => selectHeat(currentIndex + 1)} disabled={currentIndex >= heats.length - 1}>Next heat</button>
      </nav>
      <p className="heat-phase" aria-label="Current heat call status">Heat call status: {issues[current.id] ?? "ready"}</p>
      <dl className="race-context-facts" aria-label="Live heat context">
        <div><dt>Previous</dt><dd>{previousHeat ? `${heatLabel(previousHeat)} · ${previousHeat.status}` : "None"}</dd></div>
        <div><dt>Next</dt><dd>{nextHeat ? `${heatLabel(nextHeat)} · ${nextHeat.status}` : "None"}</dd></div>
        <div><dt>Result seal</dt><dd>{event.event.resultSeal}</dd></div>
      </dl>
      <div className="race-command-grid">
        <div>
          <HeatStage heat={current} event={event} pendingLane={pendingLane} times={times} onChooseLane={chooseLane} onTime={(lane, value) => setTimes((old) => old.map((item, index) => index === lane - 1 ? value : item) as [string, string, string])} />
          <p role="status" aria-label="Pending result">{pendingLane ? `Lane ${pendingLane} · ${carLabel(current.lanes[pendingLane - 1], event)} pending confirmation` : "No lane selected"}</p>
          <label>Official change reason<textarea value={correctionReason} onChange={(change) => setCorrectionReason(change.target.value)} maxLength={500} /></label>
          <button type="button" className="primary-action" onClick={() => void commitWinner()} disabled={pending || pendingLane === null}>Confirm result</button>
        </div>
        <aside className="race-side-panel">
          <section className="feature-panel" aria-label="Heat call and issues">
            <h3>Heat call &amp; issue control</h3>
            <div className="button-stack"><button type="button" onClick={callCurrent}>Call current heat</button><button type="button" onClick={() => markIssue("delayed")}>Mark current heat delayed</button><button type="button" onClick={() => markIssue("held")}>Mark current heat held</button></div>
            <label>Heat action reason<textarea value={actionReason} onChange={(change) => setActionReason(change.target.value)} maxLength={500} /></label>
            <div className="button-stack"><button type="button" onClick={() => void runHeatAction("heat.mark-rerun")} disabled={pending}>Mark heat for rerun</button><button type="button" onClick={() => void runHeatAction("heat.cancel")} disabled={pending}>Cancel heat</button></div>
          </section>
          <section className="feature-panel" aria-label="Issue queue"><h3>Issue queue</h3>{issueItems.length ? <ul>{issueItems.map((heat) => <li key={heat.id}><button type="button" onClick={() => setSelectedHeatId(heat.id)}>{heatLabel(heat)} · {issues[heat.id]}</button></li>)}</ul> : <p>No delayed or held heats.</p>}</section>
        </aside>
      </div>
      {receipt ? <ResultReceipt receipt={receipt} description={receiptDescription} undoable={undoable} onUndo={() => void undoLast()} pending={pending} /> : null}
      <p role="status" aria-label="Command status" aria-live="polite">{message}</p>
      <section className="feature-panel" aria-label="Validation drawer"><h3>Validation &amp; recovery</h3><p>{error || eventState.postCommitIssue?.message || "No blocking validation issues."}</p></section>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function RaceUnavailable({ message }: { message: string }) {
  return <section className="page-frame" aria-labelledby="page-title"><p className="eyebrow">Live operations</p><h2 id="page-title">Race Command Center</h2><p className="page-intro">{message}</p></section>;
}

function orderedHeats(event: EventStateV1 | null): Heat[] {
  return event ? [...event.matches, ...event.finals].sort((left, right) => (left.phase === right.phase ? 0 : left.phase === "preliminary" ? -1 : 1) || left.matchNumber - right.matchNumber || left.heatNumber - right.heatNumber || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) : [];
}

function parseLaneTimes(values: [string, string, string], heat: Heat): [number | null, number | null, number | null] {
  return values.map((value, index) => {
    if (!heat.lanes[index]) return null;
    if (!value.trim()) return null;
    const seconds = Number(value);
    const milliseconds = Math.round(seconds * 1_000);
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(milliseconds)) throw new Error(`Lane ${index + 1} time must be a non-negative number.`);
    return milliseconds;
  }) as [number | null, number | null, number | null];
}

function heatLabel(heat: Heat): string { return `Match ${heat.matchNumber} Heat ${heat.heatNumber}`; }
function carLabel(carId: string | null | undefined, event: EventStateV1): string {
  const entry = event.entries.find(({ id }) => id === carId);
  return entry ? `Car ${entry.carNumber}` : "Vacant lane";
}
