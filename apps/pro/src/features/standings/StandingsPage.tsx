import { useEffect, useRef, useState } from "react";
import { selectFinalists, type QualificationDecision, type RankedStanding } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import { InsightStudio } from "../insights/InsightStudio";
import { WhatIfSandbox } from "../insights/WhatIfSandbox";
import { RankProofDrawer } from "./RankProofDrawer";
import { projectRankings } from "./rankingProjection";

export function StandingsPage() {
  const context = useOptionalEventState();
  const heading = useRef<HTMLHeadingElement>(null);
  const proofTrigger = useRef<HTMLButtonElement | null>(null);
  const [phase, setPhase] = useState<"preliminary" | "final">("preliminary");
  const [proofCarId, setProofCarId] = useState<string | null>(null);
  const state = context?.state ?? null;
  useEffect(() => { heading.current?.focus(); }, []);

  if (!state) {
    return <section className="page-frame"><h2 ref={heading} tabIndex={-1} id="page-title">Standings</h2><p>No event is loaded.</p></section>;
  }

  const projection = projectRankings(state, phase);
  const rankings = projection.rankings;
  const hasResult = rankings.some(({ completedHeats }) => completedHeats > 0);
  const decision = phase === "preliminary" && hasResult && !projection.issue
    ? selectFinalists(rankings, state.settings.finalistCount)
    : null;
  const heats = phase === "preliminary" ? state.matches : state.finals;
  const matchNumbers = [...new Set(heats.map(({ matchNumber }) => matchNumber))].sort((a, b) => a - b);
  const proofRow = proofCarId ? rankings.find(({ carId }) => carId === proofCarId) ?? null : null;

  return (
    <section className="page-frame standings-page" aria-labelledby="page-title">
      <p className="eyebrow">Official projection</p>
      <h2 ref={heading} tabIndex={-1} id="page-title">Standings</h2>
      <label className="phase-selector">
        Standings phase
        <select
          value={phase}
          onChange={(change) => {
            setPhase(change.target.value as typeof phase);
            setProofCarId(null);
          }}
        >
          <option value="preliminary">Preliminary</option>
          <option value="final">Finals</option>
        </select>
      </label>
      {projection.issue ? <p role="status">{projection.issue}</p> : null}
      {!hasResult ? <p>No official {phase === "final" ? "final " : ""}result exists yet. Competitive ranks remain empty.</p> : null}
      <div className="insight-table-scroll">
        <table aria-label={`${phase === "final" ? "Finals" : "Preliminary"} standings`}>
          <thead>
            <tr>
              <th>Rank</th><th>Car</th><th>Participant</th><th>Category</th>
              {matchNumbers.map((match) => <th key={match}>Match {match} wins</th>)}
              <th>Total wins</th><th>Matches won</th><th>Completed</th><th>Average</th><th>Best</th><th>Tie</th><th>Qualification</th><th>Recent form</th><th>Proof</th>
            </tr>
          </thead>
          <tbody>
            {rankings.map((row) => (
              <tr key={row.carId}>
                <td>{row.rank ?? "—"}</td>
                <th scope="row">Car {row.carNumber} · {row.carName}</th>
                <td>{row.participantName}</td>
                <td>{row.categoryId}</td>
                {matchNumbers.map((match) => <td key={match}>{row.matchWins[String(match)] ?? 0}</td>)}
                <td>{row.totalWins}</td><td>{row.matchesWon}</td><td>{row.completedHeats}</td>
                <td>{formatTime(row.averageTimeMs)}</td><td>{formatTime(row.bestTimeMs)}</td>
                <td>{row.isTied ? "Tied" : "Clear"}</td>
                <td>{qualificationLabel(row, phase, hasResult, projection.issue, decision)}</td>
                <td>{row.recentForm.length ? row.recentForm.map((result) => result === "win" ? "W" : "L").join(" ") : "—"}</td>
                <td>
                  <button
                    type="button"
                    onClick={(event) => {
                      proofTrigger.current = event.currentTarget;
                      setProofCarId(row.carId);
                    }}
                  >
                    Why is Car {row.carNumber} ranked here?
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {phase === "preliminary" ? <><InsightStudio event={state} rankings={rankings} /><WhatIfSandbox event={state} /></> : null}
      {proofRow ? (
        <RankProofDrawer
          carId={proofRow.carId}
          carLabel={`Car ${proofRow.carNumber}`}
          rankings={rankings}
          returnFocus={proofTrigger.current}
          onClose={() => setProofCarId(null)}
        />
      ) : null}
    </section>
  );
}

function qualificationLabel(
  row: RankedStanding,
  phase: "preliminary" | "final",
  hasResult: boolean,
  rankingIssue: string | null,
  decision: QualificationDecision | null,
): string {
  if (phase === "final") return "Finalist";
  if (!hasResult) return "Awaiting result";
  if (rankingIssue) return "Unresolved ordinal tie";
  if (decision?.automaticQualifiers.some(({ carId }) => carId === row.carId)) return "Automatic qualifier";
  if (decision?.tiedCutoffEntrants.some(({ carId }) => carId === row.carId)) return "Cutoff tie";
  return "Outside cutoff";
}

function formatTime(time: number | null): string {
  return time === null ? "—" : `${(time / 1_000).toFixed(3)} s`;
}
