import { useEffect, useRef, useState } from "react";
import type { EventStateV1 } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import { useOptionalRehearsalWorkspace } from "../../state/RehearsalWorkspace";
import type { RestorePreview } from "../../persistence/repository";
import { projectRankings } from "../standings/rankingProjection";

export type EventStateChanges = {
  eventFactChanges: number;
  registrationChanges: number;
  paymentChanges: number;
  settingChanges: number;
  heatChanges: number;
  preliminaryRankChanges: number;
  finalRankChanges: number;
  auditChanges: number;
};

export function ReplayTimeline() {
  const context = useOptionalEventState();
  const rehearsal = useOptionalRehearsalWorkspace();
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inRehearsal = Boolean(rehearsal?.state);

  useEffect(() => {
    if (!confirming) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
    confirmRef.current?.focus();
  }, [confirming]);

  if (!context) return null;

  const inspect = async (id: string) => {
    try {
      setPreview(await context.previewSnapshot(id));
      setConfirming(false);
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Revision preview failed");
    }
  };
  const cancelConfirmation = () => {
    try { dialogRef.current?.close(); } catch { dialogRef.current?.removeAttribute("open"); }
    setConfirming(false);
    restoreTriggerRef.current?.focus();
  };
  const restore = async () => {
    if (!preview) return;
    try {
      await context.restoreSnapshot(preview.snapshotId, true);
      setMessage(`Restored ${preview.summary}.`);
      try { dialogRef.current?.close(); } catch { dialogRef.current?.removeAttribute("open"); }
      headingRef.current?.focus();
      setPreview(null);
      setConfirming(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Restore failed");
    }
  };
  const changes = preview && context.state ? compareEventStates(context.state, preview.event) : null;

  return (
    <section className="replay-timeline" aria-label="Replay timeline">
      <h3 ref={headingRef} tabIndex={-1}>Replay timeline</h3>
      <p>Preview an immutable local revision before a guarded restore.</p>
      {inRehearsal ? (
        <p>Exit rehearsal to inspect or restore official history. Rehearsal changes remain isolated.</p>
      ) : context.snapshots.length ? (
        <ol>
          {context.snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              <time dateTime={snapshot.timestamp}>{new Date(snapshot.timestamp).toLocaleString()}</time> · {snapshot.summary}{" "}
              <button type="button" onClick={() => void inspect(snapshot.id)}>Preview {snapshot.summary}</button>
            </li>
          ))}
        </ol>
      ) : <p>No local revisions are available.</p>}
      {preview && changes && !inRehearsal ? (
        <section className="replay-preview" aria-label="Revision preview">
          <h4>{preview.summary}</h4>
          <p>{formatChanges(changes)}</p>
          <button
            type="button"
            onClick={(event) => {
              restoreTriggerRef.current = event.currentTarget;
              setConfirming(true);
            }}
          >
            Restore this revision
          </button>
        </section>
      ) : null}
      {confirming && preview ? (
        <dialog
          ref={dialogRef}
          role="alertdialog"
          aria-labelledby="restore-dialog-title"
          aria-describedby="restore-dialog-description"
          onCancel={(event) => {
            event.preventDefault();
            cancelConfirmation();
          }}
        >
          <h4 id="restore-dialog-title">Confirm revision restore</h4>
          <p id="restore-dialog-description">This replaces the current event with {preview.summary}. The current state remains recoverable as a new revision.</p>
          <div className="action-row">
            <button ref={confirmRef} type="button" onClick={() => void restore()}>Confirm restore</button>
            <button type="button" className="quiet-action" onClick={cancelConfirmation}>Cancel restore</button>
          </div>
        </dialog>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

export function compareEventStates(current: EventStateV1, older: EventStateV1): EventStateChanges {
  return {
    eventFactChanges: countChangedObjectFields(current.event, older.event, new Set(["updatedAt"])),
    registrationChanges:
      countChangedRecords(current.participants, older.participants)
      + countChangedRecords(current.entries, older.entries),
    paymentChanges: countChangedRecords(current.payments, older.payments),
    settingChanges: countChangedObjectFields(current.settings, older.settings),
    heatChanges: countChangedRecords([...current.matches, ...current.finals], [...older.matches, ...older.finals]),
    preliminaryRankChanges: countRankChanges(current, older, "preliminary"),
    finalRankChanges: countRankChanges(current, older, "final"),
    auditChanges: countChangedRecords(current.auditLog, older.auditLog),
  };
}

function countRankChanges(current: EventStateV1, older: EventStateV1, phase: "preliminary" | "final"): number {
  const currentRanks = new Map(projectRankings(current, phase).rankings.map(({ carId, rank }) => [carId, rank]));
  const olderRanks = new Map(projectRankings(older, phase).rankings.map(({ carId, rank }) => [carId, rank]));
  return [...new Set([...currentRanks.keys(), ...olderRanks.keys()])]
    .filter((id) => currentRanks.get(id) !== olderRanks.get(id)).length;
}

function countChangedRecords<T extends { id: string }>(current: readonly T[], older: readonly T[]): number {
  const left = new Map(current.map((record) => [record.id, JSON.stringify(record)]));
  const right = new Map(older.map((record) => [record.id, JSON.stringify(record)]));
  return [...new Set([...left.keys(), ...right.keys()])].filter((id) => left.get(id) !== right.get(id)).length;
}

function countChangedObjectFields(
  current: Record<string, unknown>,
  older: Record<string, unknown>,
  ignored = new Set<string>(),
): number {
  return [...new Set([...Object.keys(current), ...Object.keys(older)])]
    .filter((key) => !ignored.has(key) && JSON.stringify(current[key]) !== JSON.stringify(older[key])).length;
}

function formatChanges(changes: EventStateChanges): string {
  return [
    quantity(changes.eventFactChanges, "event fact"),
    quantity(changes.registrationChanges, "registration record"),
    quantity(changes.paymentChanges, "payment record"),
    quantity(changes.settingChanges, "setting"),
    quantity(changes.heatChanges, "heat result"),
    quantity(changes.preliminaryRankChanges, "preliminary rank position"),
    quantity(changes.finalRankChanges, "final rank position"),
    quantity(changes.auditChanges, "audit entry"),
  ].join("; ") + " will change.";
}

function quantity(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
