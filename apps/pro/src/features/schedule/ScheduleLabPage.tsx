import { useEffect, useMemo, useRef, useState } from "react";
import { analyseSchedule, getPreset, mapPresetToCars, type EventStateV1, type Heat, type SchedulePreset, type ScheduleQualityReport } from "@rr3/domain";
import { generateCustomSchedule, type ScheduleScore } from "@rr3/scheduler";
import { useOptionalEventState } from "../../state/EventProvider";
import { CandidateComparison } from "./CandidateComparison";
import { LaneBalanceChart } from "./LaneBalanceChart";
import { OpponentNetwork } from "./OpponentNetwork";
import { PairMatrix, type PairDatum } from "./PairMatrix";

type PresetKey = Exclude<SchedulePreset["key"], "finals15">;
type CandidateMode = "preset" | "custom";

export type ScheduleCandidate = {
  id: string;
  source: "preset" | "custom";
  presetKey: PresetKey | null;
  seed: string;
  heats: Heat[];
  score: ScheduleScore;
  quality: ScheduleQualityReport;
  signature: string;
};

const presetOptions: Array<{ key: PresetKey; label: string }> = [
  { key: "template9", label: "9 cars · 4 matches" },
  { key: "template12", label: "12 cars · 5 matches" },
  { key: "template15", label: "15 cars · 6 matches" },
];

export function ScheduleLabPage() {
  const eventState = useOptionalEventState();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const activationTriggerRef = useRef<HTMLButtonElement>(null);
  const activationConfirmRef = useRef<HTMLButtonElement>(null);
  const activationStatusRef = useRef<HTMLParagraphElement>(null);
  const [mode, setMode] = useState<CandidateMode>("preset");
  const [presetKey, setPresetKey] = useState<PresetKey>("template9");
  const [seedDraft, setSeedDraft] = useState("community-night");
  const [matchesDraft, setMatchesDraft] = useState("4");
  const [slotOrder, setSlotOrder] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<ScheduleCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activationOpen, setActivationOpen] = useState(false);
  const [status, setStatus] = useState("");

  const state = eventState?.state ?? null;
  const activeEntries = useMemo(() => state?.entries.filter(({ active }) => active).slice().sort((left, right) => left.carNumber - right.carNumber || left.id.localeCompare(right.id)) ?? [], [state]);
  const activeIds = useMemo(() => activeEntries.map(({ id }) => id), [activeEntries]);
  const carNames = useMemo(() => new Map(activeEntries.map((entry) => [entry.id, `Car ${entry.carNumber}`])), [activeEntries]);

  useEffect(() => {
    setSlotOrder((current) => current.length === activeIds.length && current.every((id) => activeIds.includes(id)) ? current : activeIds);
  }, [activeIds]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const preset = getPreset(presetKey);
  const presetGate = activeIds.length === preset.entrantCount
    ? null
    : `${presetOptions.find(({ key }) => key === presetKey)?.label ?? presetKey} requires exactly ${preset.entrantCount} active cars; ${activeIds.length} available.`;
  const customGate = activeIds.length < 3 || activeIds.length > 24
    ? `Custom schedules support 3–24 active cars; ${activeIds.length} available.`
    : null;
  const selected = candidates.find(({ id }) => id === selectedId) ?? null;
  const pairs = useMemo(() => selected ? pairData(selected.quality, carNames) : [], [carNames, selected]);

  useEffect(() => {
    if (!activationOpen) return undefined;
    activationConfirmRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelActivation();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [activationOpen]);

  if (!eventState) return <ScheduleUnavailable />;
  if (eventState.loading) return <p role="status">Loading Schedule Lab…</p>;
  if (!state) return <ScheduleUnavailable />;

  function cancelActivation() {
    setActivationOpen(false);
    window.setTimeout(() => activationTriggerRef.current?.focus(), 0);
  }

  function swapSlot(slotIndex: number, carId: string) {
    setSlotOrder((current) => {
      const otherIndex = current.indexOf(carId);
      if (otherIndex < 0 || otherIndex === slotIndex) return current;
      const next = [...current];
      [next[slotIndex], next[otherIndex]] = [next[otherIndex]!, next[slotIndex]!];
      return next;
    });
  }

  function buildPreset() {
    if (presetGate) return;
    const heats = mapPresetToCars(preset, slotOrder);
    const quality = analyseSchedule(heats, activeIds);
    const candidate = createCandidate({ id: `preset-${presetKey}`, source: "preset", presetKey, seed: "", heats, quality });
    setCandidates([candidate]);
    setSelectedId(candidate.id);
    setStatus(`Built ${presetKey} from the current stable slot mapping.`);
  }

  function generateCandidates() {
    const matches = Number(matchesDraft);
    const seed = seedDraft.trim();
    if (customGate) {
      setStatus(customGate);
      return;
    }
    if (!seed || !Number.isSafeInteger(matches) || matches < 1 || matches > 10) {
      setStatus("A seed and 1–10 matches are required.");
      return;
    }
    const generated = [seed, `${seed}-2`, `${seed}-3`].map((candidateSeed, index) => {
      const result = generateCustomSchedule(activeIds, { seed: candidateSeed, matches, restarts: 4, iterationsPerRestart: 120 });
      return createCandidate({ id: `custom-${index + 1}-${candidateSeed}`, source: "custom", presetKey: null, seed: candidateSeed, heats: result.heats, quality: result.quality, score: result.score });
    });
    setCandidates(generated);
    setSelectedId(generated[0]!.id);
    setStatus("Generated three immutable deterministic candidates from explicit seeds.");
  }

  async function activate() {
    const currentState = state;
    const currentEventState = eventState;
    if (!currentState || !currentEventState || !selected || selected.quality.status === "invalid" || (mode === "preset" && presetGate !== null)) return;
    const candidate: EventStateV1 = {
      ...currentState,
      settings: {
        ...currentState.settings,
        scheduleMode: selected.presetKey ?? "custom",
        seed: selected.seed,
      },
      matches: structuredClone(selected.heats),
    };
    await currentEventState.dispatchEventCommand({
      type: "event.replace",
      event: candidate,
      summary: `Activated ${selected.presetKey ?? selected.seed} schedule with ${selected.heats.length} validated heats`,
    });
    setActivationOpen(false);
    setStatus(`Activated ${selected.heats.length} heats. The previous live event remains in local recovery history.`);
    window.setTimeout(() => activationStatusRef.current?.focus(), 0);
  }

  return (
    <>
    <section className="page-frame schedule-lab-page" aria-labelledby="page-title" inert={activationOpen ? true : undefined}>
      <p className="eyebrow">Fair race planning</p>
      <h2 ref={headingRef} id="page-title" tabIndex={-1}>Schedule Lab</h2>
      <p className="page-intro">Compare deterministic candidates term by term, inspect fairness evidence, and activate only a validated schedule.</p>
      <fieldset className="schedule-mode">
        <legend>Candidate source</legend>
        <label><input type="radio" name="candidate-mode" checked={mode === "preset"} onChange={() => setMode("preset")} /> Exact preset</label>
        <label><input type="radio" name="candidate-mode" checked={mode === "custom"} onChange={() => setMode("custom")} /> Custom seeded search</label>
      </fieldset>

      {mode === "preset" ? (
        <section className="schedule-controls feature-panel" aria-labelledby="preset-builder-title">
          <h3 id="preset-builder-title">Exact preset and stable slots</h3>
          <label>Exact preset<select value={presetKey} onChange={(event) => setPresetKey(event.target.value as PresetKey)}>{presetOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          {presetGate ? <p className="inline-error" role="alert">{presetGate}</p> : null}
          <div className="slot-grid">{slotOrder.slice(0, preset.entrantCount).map((carId, index) => <label key={index}>Slot {index + 1} car<select value={carId} onChange={(event) => swapSlot(index, event.target.value)}>{activeEntries.map((entry) => <option key={entry.id} value={entry.id}>Car {entry.carNumber} · {entry.name}</option>)}</select></label>)}</div>
          <button type="button" disabled={presetGate !== null} onClick={buildPreset}>Build preset candidate</button>
        </section>
      ) : (
        <section className="schedule-controls feature-panel" aria-labelledby="custom-builder-title">
          <h3 id="custom-builder-title">Deterministic candidate search</h3>
          <label>Schedule seed<input value={seedDraft} onChange={(event) => setSeedDraft(event.target.value)} /></label>
          <label>Matches<input type="number" min="1" max="10" value={matchesDraft} onChange={(event) => setMatchesDraft(event.target.value)} /></label>
          {customGate ? <p className="inline-error" role="alert">{customGate}</p> : null}
          <button type="button" disabled={customGate !== null} onClick={generateCandidates}>Generate three candidates</button>
        </section>
      )}

      <p ref={activationStatusRef} role="status" aria-label="Schedule activation status" tabIndex={-1} className="schedule-status">{status}</p>
      <CandidateComparison candidates={candidates} selectedId={selectedId} onSelect={setSelectedId} />

      {selected ? (
        <section className="selected-candidate feature-panel" aria-label="Selected schedule candidate">
          <div className="selected-heading"><div><p className="eyebrow">Immutable selection</p><h3>{selected.source === "preset" ? selected.presetKey : selected.seed}</h3></div><button ref={activationTriggerRef} type="button" disabled={selected.quality.status === "invalid" || (mode === "preset" && presetGate !== null)} onClick={() => setActivationOpen(true)}>Activate selected schedule</button></div>
          <p>{matchCount(selected.heats)} matches · {selected.heats.length} heats</p>
          <p aria-label="Selected schedule seed">{selected.seed}</p>
          <p aria-label="Selected schedule signature" className="signature">{selected.signature}</p>
          <QualitySummary quality={selected.quality} />
          <HeatPreview heats={selected.heats} carNames={carNames} />
          <div className="fairness-grid"><PairMatrix pairs={pairs} /><OpponentNetwork pairs={pairs} carNames={carNames} /><LaneBalanceChart quality={selected.quality} carNames={carNames} /></div>
        </section>
      ) : null}

      {!selected ? <button type="button" disabled>Activate selected schedule</button> : null}
    </section>
      {activationOpen && selected ? (
        <div className="modal-backdrop"><section className="confirmation-panel" role="alertdialog" aria-modal="true" aria-labelledby="activation-title"><h3 id="activation-title">Confirm schedule activation</h3><p>This will replace {state.matches.length} existing preliminary heat{state.matches.length === 1 ? "" : "s"} with {selected.heats.length} validated heats.</p><p>The transaction creates a recovery snapshot of this replacement in local history.</p><div className="action-row"><button ref={activationConfirmRef} type="button" onClick={() => void activate()}>Confirm activation</button><button type="button" className="quiet-action" onClick={cancelActivation}>Cancel activation</button></div></section></div>
      ) : null}
    </>
  );
}

function QualitySummary({ quality }: { quality: ScheduleQualityReport }) {
  const status = quality.status === "invalid" ? "Invalid" : quality.status === "valid-with-warnings" ? "Valid with warnings" : quality.opponentQualityStatus === "certified-optimal" ? "Certified optimal" : "Valid best found";
  return <section className="quality-summary" aria-label="Schedule quality certificate"><h4>{status}</h4><p>Repeat excess {quality.repeatedOpponentCount} · lower bound {quality.repeatExcessLowerBound} · gap {quality.repeatExcessGap}</p><p>Maximum pair frequency {quality.maximumPairFrequency} · lower bound {quality.maximumPairFrequencyLowerBound} · gap {quality.maximumPairFrequencyGap}</p><p>Appearance imbalance {quality.appearanceImbalance} · Worst repeat burden {quality.worstPerCarRepeatBurden}</p><p>Squared repeat burden {quality.squaredRepeatBurden} · squared pair frequency {quality.squaredPairFrequency}</p><p>Bye assignments {sum(quality.byeCounts)} · two-car participations {sum(quality.twoCarHeatCounts)}</p>{quality.warnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}{quality.errors.map((error) => <p className="inline-error" key={error}>{error}</p>)}</section>;
}

function HeatPreview({ heats, carNames }: { heats: readonly Heat[]; carNames: ReadonlyMap<string, string> }) {
  return <div className="schedule-table-scroll"><table aria-label="Schedule heat preview"><thead><tr><th scope="col">Match</th><th scope="col">Heat</th><th scope="col">Lane 1</th><th scope="col">Lane 2</th><th scope="col">Lane 3</th></tr></thead><tbody>{heats.map((heat) => <tr key={heat.id}><td>Match {heat.matchNumber}</td><td>Heat {heat.heatNumber}</td>{heat.lanes.map((carId, lane) => <td key={lane}>{carId === null ? "Empty" : carNames.get(carId)}</td>)}</tr>)}</tbody></table></div>;
}

function createCandidate(input: { id: string; source: "preset" | "custom"; presetKey: PresetKey | null; seed: string; heats: Heat[]; quality: ScheduleQualityReport; score?: ScheduleScore }): ScheduleCandidate {
  const score = input.score ?? scoreFromQuality(input.quality, input.heats);
  const frozenHeats = structuredClone(input.heats);
  const signature = frozenHeats.map(({ id, lanes }) => `${id}:${lanes.join("|")}`).join(";");
  return Object.freeze({ ...input, heats: frozenHeats, score: [...score] as unknown as ScheduleScore, signature });
}

function scoreFromQuality(quality: ScheduleQualityReport, heats: readonly Heat[]): ScheduleScore {
  return [quality.errors.length, quality.appearanceImbalance, quality.repeatedOpponentCount, quality.maximumPairFrequency, quality.worstPerCarRepeatBurden, quality.squaredRepeatBurden, quality.squaredPairFrequency, consecutiveByePenalty(quality.byeCounts), 0, heats.map(({ lanes }) => lanes.join(",")).join(";")];
}

function pairData(quality: ScheduleQualityReport, carNames: ReadonlyMap<string, string>): PairDatum[] {
  return Object.entries(quality.pairCounts).map(([key, frequency]) => {
    const [firstId, secondId] = JSON.parse(key) as [string, string];
    return { key, firstId, secondId, firstName: carNames.get(firstId) ?? firstId, secondName: carNames.get(secondId) ?? secondId, frequency };
  }).sort((left, right) => left.firstName.localeCompare(right.firstName) || left.secondName.localeCompare(right.secondName));
}

function sum(record: Record<string, number>): number { return Object.values(record).reduce((total, value) => total + value, 0); }
function consecutiveByePenalty(record: Record<string, number>): number { return Object.values(record).reduce((total, value) => total + Math.max(0, value - 1), 0); }
function matchCount(heats: readonly Heat[]): number { return new Set(heats.map(({ matchNumber }) => matchNumber)).size; }

function ScheduleUnavailable() { return <section className="page-frame" aria-labelledby="page-title"><p className="eyebrow">Fair race planning</p><h2 id="page-title">Schedule Lab</h2><p>Create or load an event with at least three active cars before generating schedules.</p><button type="button" disabled>Activate selected schedule</button></section>; }
