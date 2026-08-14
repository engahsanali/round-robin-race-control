import { useEffect, useMemo, useRef, useState } from "react";
import {
  getPreset,
  mapPresetToCars,
  selectFinalists,
  type AuditEntry,
  type EventStateV1,
  type Heat,
  type JsonValue,
  type QualificationDecision,
  type RankedStanding,
} from "@rr3/domain";
import { generateCustomSchedule } from "@rr3/scheduler";
import { useOptionalEventState } from "../../state/EventProvider";
import { projectRankings } from "../standings/rankingProjection";

type QualificationRecord = {
  basisFingerprint: string | null;
  resolution: "resolved" | "playoff-required" | null;
  qualifiedCarIds: string[];
};

export function FinalsPage() {
  const context = useOptionalEventState();
  const heading = useRef<HTMLHeadingElement>(null);
  const [chosenTieIds, setChosenTieIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"custom" | "fixed">("custom");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [manualChampionId, setManualChampionId] = useState("");
  const [championReason, setChampionReason] = useState("");
  const state = context?.state ?? null;
  useEffect(() => { heading.current?.focus(); }, []);

  const preliminaryProjection = useMemo(
    () => state ? projectRankings(state, "preliminary") : null,
    [state],
  );
  const decision = useMemo(
    () => state && preliminaryProjection
      ? selectFinalists(preliminaryProjection.rankings, state.settings.finalistCount)
      : null,
    [preliminaryProjection, state],
  );

  if (!context || !state || !decision || !preliminaryProjection) {
    return <section className="page-frame"><h2 ref={heading} tabIndex={-1} id="page-title">Finals</h2><p>No event is loaded.</p></section>;
  }

  const tied = decision.tiedCutoffEntrants;
  const automaticIds = decision.automaticQualifiers.map(({ carId }) => carId);
  const basisFingerprint = qualificationFingerprint(decision, preliminaryProjection.rankings);
  const record = latestQualificationRecord(state);
  const staleDecision = Boolean(record && record.basisFingerprint !== basisFingerprint);
  const matchingRecord = record && !staleDecision ? record : null;
  const qualificationResolved = !preliminaryProjection.issue && !staleDecision && (
    tied.length === 0
      ? automaticIds.length > 0
      : matchingRecord?.resolution === "resolved" && matchingRecord.qualifiedCarIds.length > 0
  );
  const qualifiedIds = tied.length === 0
    ? automaticIds
    : matchingRecord?.resolution === "resolved" ? matchingRecord.qualifiedCarIds : automaticIds;
  const playoffPending = matchingRecord?.resolution === "playoff-required";
  const tiedPlaces = Math.max(0, decision.requestedCount - automaticIds.length);
  const name = (id: string) => `Car ${state.entries.find((entry) => entry.id === id)?.carNumber ?? id}`;

  const commitDecision = async (action: "include-all" | "playoff" | "manual-with-reason") => {
    if (pending || tied.length === 0) return;
    let selected: string[];
    let summary: string;
    let resolution: QualificationRecord["resolution"];
    if (action === "include-all") {
      selected = [...automaticIds, ...tied.map(({ carId }) => carId)];
      summary = `Included all ${tied.length} tied cutoff cars in finals qualification`;
      resolution = "resolved";
    } else if (action === "playoff") {
      selected = automaticIds;
      summary = `Recorded playoff required for tied cutoff cars ${tied.map(({ carId }) => name(carId)).join(", ")}`;
      resolution = "playoff-required";
    } else {
      if (chosenTieIds.length !== tiedPlaces) {
        setMessage(`Choose exactly ${tiedPlaces} tied car${tiedPlaces === 1 ? "" : "s"} for the available finals place${tiedPlaces === 1 ? "" : "s"}.`);
        return;
      }
      const normalizedReason = reason.trim();
      if (normalizedReason.length < 3) {
        setMessage("A meaningful manual qualification reason is required.");
        return;
      }
      selected = [...automaticIds, ...chosenTieIds];
      summary = `Qualified ${chosenTieIds.map(name).join(", ")} by reasoned manual decision: ${normalizedReason}`;
      resolution = "resolved";
    }
    setPending(true);
    try {
      await replaceWithAudit(context, state, summary, `qualification.${action}`, {
        qualifiedCarIds: selected,
        decision: action,
        resolution,
        basisFingerprint,
        reason: action === "manual-with-reason" ? reason.trim() : null,
      });
      setMessage(summary);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Qualification decision failed");
    } finally {
      setPending(false);
    }
  };

  const generateFinals = async () => {
    if (pending) return;
    if (!qualificationResolved) {
      setMessage(playoffPending ? "The requested playoff must be resolved before finals can be generated." : "Resolve the current qualification cutoff before generating finals.");
      return;
    }
    if (qualifiedIds.length < 3) {
      setMessage("At least three resolved finalists are required.");
      return;
    }
    if (scheduleMode === "fixed" && qualifiedIds.length !== 15) {
      setMessage("The fixed finals preset requires exactly 15 qualified cars.");
      return;
    }
    const mappedIds = qualifiedIds.slice().sort((left, right) => {
      const leftNumber = state.entries.find(({ id }) => id === left)?.carNumber ?? Number.MAX_SAFE_INTEGER;
      const rightNumber = state.entries.find(({ id }) => id === right)?.carNumber ?? Number.MAX_SAFE_INTEGER;
      return leftNumber - rightNumber || left.localeCompare(right);
    });
    const heats = scheduleMode === "fixed"
      ? mapPresetToCars(getPreset("finals15"), mappedIds)
      : generateCustomSchedule(mappedIds, {
        seed: `${state.settings.seed}-finals`,
        matches: 1,
        restarts: 3,
        iterationsPerRestart: 80,
      }).heats;
    const finals = heats.map((heat, index): Heat => ({
      ...heat,
      id: `final-${index + 1}-${heat.id}`,
      phase: "final",
      matchNumber: heat.matchNumber,
      heatNumber: heat.heatNumber,
    }));
    setPending(true);
    try {
      await replaceWithAudit(
        context,
        { ...state, finals },
        `Activated ${scheduleMode} finals schedule for ${mappedIds.length} qualified cars`,
        "finals.schedule-activated",
        { qualifiedCarIds: mappedIds, basisFingerprint },
      );
      setMessage(`Activated ${finals.length} finals heats.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Finals activation failed");
    } finally {
      setPending(false);
    }
  };

  const finalProjection = projectRankings(state, "final");
  const allFinalsComplete = state.finals.length > 0 && state.finals.every(({ status }) => status === "completed");
  const leadingRank = finalProjection.comparisonRankings.find(({ rank }) => rank !== null)?.rank ?? null;
  const leadingCars = leadingRank === null
    ? []
    : finalProjection.comparisonRankings.filter(({ rank }) => rank === leadingRank);
  const champion = leadingCars.length === 1 ? leadingCars[0] ?? null : null;
  const tiedChampionCandidates = allFinalsComplete && leadingCars.length > 1 ? leadingCars : [];
  const canSeal = allFinalsComplete && Boolean(champion) && state.event.resultSeal !== "official";

  const seal = async () => {
    if (!canSeal || !champion || pending) return;
    await sealChampion(context, state, champion, `Sealed official champion ${name(champion.carId)} after completed finals`, "champion.official-sealed", {} , setPending, setMessage, name);
  };

  const sealManualChampion = async () => {
    if (pending || !allFinalsComplete || tiedChampionCandidates.length < 2) return;
    if (!tiedChampionCandidates.some(({ carId }) => carId === manualChampionId)) {
      setMessage("Choose a tied finals leader as champion.");
      return;
    }
    const normalizedReason = championReason.trim();
    if (normalizedReason.length < 3) {
      setMessage("A meaningful manual champion reason is required.");
      return;
    }
    const selected = tiedChampionCandidates.find(({ carId }) => carId === manualChampionId)!;
    await sealChampion(
      context,
      state,
      selected,
      `Sealed ${name(selected.carId)} as reasoned manual champion: ${normalizedReason}`,
      "champion.manual-sealed",
      { championCarId: selected.carId, reason: normalizedReason },
      setPending,
      setMessage,
      name,
    );
  };

  const scheduleExplanation = staleDecision
    ? "Previous qualification decision no longer matches the current standings; resolve the cutoff again."
    : playoffPending
      ? "The requested playoff must be resolved before finals can be generated."
      : qualificationResolved
        ? `Resolved finalists: ${qualifiedIds.map(name).join(", ")}`
        : `Qualification pending. Automatic places so far: ${automaticIds.map(name).join(", ") || "none"}.`;

  return (
    <section className="page-frame finals-page" aria-labelledby="page-title">
      <p className="eyebrow">Qualification and championship</p>
      <h2 ref={heading} tabIndex={-1} id="page-title">Finals</h2>
      {preliminaryProjection.issue ? <p role="status">{preliminaryProjection.issue}</p> : null}
      {staleDecision ? <p role="status">Previous qualification decision no longer matches the current standings and has been invalidated.</p> : null}
      <section className="feature-panel" aria-label="Qualification cutoff">
        <h3>Qualification cutoff</h3>
        <p>Requested finalists: {decision.requestedCount}</p>
        <p>Automatic: {decision.automaticQualifiers.map(({ carId }) => name(carId)).join(", ") || "none"}</p>
        {tied.length ? <>
          <p>Cutoff tie: {tied.map(({ carId }) => name(carId)).join(", ")}. {tiedPlaces} place{tiedPlaces === 1 ? "" : "s"} remain. Allowed actions: include all, playoff, or reasoned manual decision.</p>
          {tied.map(({ carId }) => (
            <label key={carId}>
              <input
                type="checkbox"
                checked={chosenTieIds.includes(carId)}
                onChange={() => setChosenTieIds((current) => current.includes(carId) ? current.filter((id) => id !== carId) : [...current, carId])}
              />
              Choose {name(carId)}
            </label>
          ))}
          <label>Manual qualification reason<textarea value={reason} maxLength={500} onChange={(change) => setReason(change.target.value)} /></label>
          <div className="action-row">
            <button type="button" disabled={pending} onClick={() => void commitDecision("include-all")}>Include all cutoff ties</button>
            <button type="button" disabled={pending} onClick={() => void commitDecision("playoff")}>Require playoff</button>
            <button type="button" disabled={pending} onClick={() => void commitDecision("manual-with-reason")}>Apply reasoned manual decision</button>
          </div>
        </> : <p>{automaticIds.length ? "No cutoff tie requires intervention." : "Official preliminary results are required before qualification."}</p>}
      </section>
      <section className="feature-panel" aria-label="Final schedule">
        <h3>Final schedule</h3>
        <p>{scheduleExplanation}</p>
        <label>Final schedule mode<select value={scheduleMode} onChange={(change) => setScheduleMode(change.target.value as typeof scheduleMode)}><option value="custom">Custom finalist round</option><option value="fixed">Fixed 15-car finals preset</option></select></label>
        <button type="button" disabled={pending || !qualificationResolved || qualifiedIds.length < 3} onClick={() => void generateFinals()}>Generate and activate finals</button>
      </section>
      <section className="feature-panel" aria-label="Official champion seal">
        <h3>Official champion seal</h3>
        <p>{state.event.resultSeal === "official" ? "Results are Official." : state.finals.length === 0 ? "Create a finals schedule before sealing a champion." : !allFinalsComplete ? "Every finals heat must be completed before a champion can be sealed." : tiedChampionCandidates.length ? "First place remains tied. Use a reasoned manual decision or record a playoff result." : "First place is unambiguous and ready for explicit sealing."}</p>
        <button type="button" disabled={!canSeal || pending} onClick={() => void seal()}>Seal official champion</button>
        {tiedChampionCandidates.length ? <>
          {tiedChampionCandidates.map(({ carId }) => <label key={carId}><input type="radio" name="manual-champion" checked={manualChampionId === carId} onChange={() => setManualChampionId(carId)} />Choose {name(carId)} as champion</label>)}
          <label>Manual champion reason<textarea value={championReason} maxLength={500} onChange={(change) => setChampionReason(change.target.value)} /></label>
          <button type="button" disabled={pending} onClick={() => void sealManualChampion()}>Seal reasoned manual champion</button>
        </> : null}
      </section>
      {message ? <p role={/required|choose exactly|choose a tied|failed/i.test(message) ? "alert" : "status"}>{message}</p> : null}
    </section>
  );
}

function qualificationFingerprint(decision: QualificationDecision, rankings: readonly RankedStanding[]): string {
  return JSON.stringify({
    requestedCount: decision.requestedCount,
    rankings: rankings.filter(({ completedHeats }) => completedHeats > 0).map((row) => ({
      carId: row.carId,
      rank: row.rank,
      tieBreaks: row.tieBreaks.map(({ key, value, competitive }) => [key, value, competitive]),
    })),
  });
}

function latestQualificationRecord(state: EventStateV1): QualificationRecord | null {
  const audit = state.auditLog.slice().reverse().find(({ action }) => action.startsWith("qualification."));
  if (!audit) return null;
  const ids = audit.details.qualifiedCarIds;
  const fingerprint = audit.details.basisFingerprint;
  const resolution = audit.details.resolution;
  return {
    basisFingerprint: typeof fingerprint === "string" ? fingerprint : null,
    resolution: resolution === "resolved" || resolution === "playoff-required" ? resolution : null,
    qualifiedCarIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
  };
}

async function sealChampion(
  context: NonNullable<ReturnType<typeof useOptionalEventState>>,
  state: EventStateV1,
  champion: RankedStanding,
  summary: string,
  action: string,
  details: Record<string, JsonValue>,
  setPending: (value: boolean) => void,
  setMessage: (value: string) => void,
  name: (id: string) => string,
) {
  setPending(true);
  const candidate = { ...state, event: { ...state.event, resultSeal: "official" as const, status: "completed" as const } };
  try {
    await replaceWithAudit(context, candidate, summary, action, details);
    setMessage(`Official champion: ${name(champion.carId)}.`);
  } catch (cause) {
    setMessage(cause instanceof Error ? cause.message : "Champion seal failed");
  } finally {
    setPending(false);
  }
}

async function replaceWithAudit(
  context: NonNullable<ReturnType<typeof useOptionalEventState>>,
  state: EventStateV1,
  summary: string,
  action: string,
  details: Record<string, JsonValue> = {},
) {
  const timestamp = new Date().toISOString();
  const audit: AuditEntry = {
    id: createAuditId(state, action),
    timestamp,
    action,
    summary,
    entityType: "event",
    entityId: state.event.id,
    details,
  };
  const event: EventStateV1 = {
    ...structuredClone(state),
    event: { ...state.event, updatedAt: timestamp },
    auditLog: [...state.auditLog, audit],
  };
  await context.dispatchEventCommand({ type: "event.replace", event, summary });
}

function createAuditId(state: EventStateV1, action: string): string {
  const prefix = `audit-${action.replaceAll(".", "-")}`;
  const existing = new Set(state.auditLog.map(({ id }) => id));
  let sequence = state.auditLog.length + 1;
  let id = `${prefix}-${sequence}`;
  while (existing.has(id)) id = `${prefix}-${++sequence}`;
  return id;
}
