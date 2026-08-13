import { useEffect, useRef, useState } from "react";
import { calculateRankings, calculateStandings, type RankedStanding } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import { InsightStudio } from "../insights/InsightStudio";
import { WhatIfSandbox } from "../insights/WhatIfSandbox";
import { RankProofDrawer } from "./RankProofDrawer";

export function StandingsPage() {
  const context = useOptionalEventState(); const heading = useRef<HTMLHeadingElement>(null); const [phase, setPhase] = useState<"preliminary" | "final">("preliminary"); const [proof, setProof] = useState<RankedStanding | null>(null); const state = context?.state ?? null;
  useEffect(() => { heading.current?.focus(); }, []);
  if (!state) return <section className="page-frame"><h2 ref={heading} tabIndex={-1} id="page-title">Standings</h2><p>No event is loaded.</p></section>;
  const rankings = calculateRankings(calculateStandings(state, phase), state.settings);
  const hasResult = rankings.some(({ completedHeats }) => completedHeats > 0);
  return <section className="page-frame standings-page" aria-labelledby="page-title"><p className="eyebrow">Official projection</p><h2 ref={heading} tabIndex={-1} id="page-title">Standings</h2><label className="phase-selector">Standings phase<select value={phase} onChange={(change) => setPhase(change.target.value as typeof phase)}><option value="preliminary">Preliminary</option><option value="final">Finals</option></select></label>{!hasResult ? <p>No official {phase === "final" ? "final " : ""}result exists yet. Competitive ranks remain empty.</p> : null}<div className="insight-table-scroll"><table aria-label={`${phase === "final" ? "Finals" : "Preliminary"} standings`}><thead><tr><th>Rank</th><th>Car</th><th>Participant</th><th>Category</th><th>Wins</th><th>Matches won</th><th>Completed</th><th>Average</th><th>Best</th><th>Tie</th><th>Proof</th></tr></thead><tbody>{rankings.map((row) => <tr key={row.carId}><td>{row.rank ?? "—"}</td><th scope="row">Car {row.carNumber} · {row.carName}</th><td>{row.participantName}</td><td>{row.categoryId}</td><td>{row.totalWins}</td><td>{row.matchesWon}</td><td>{row.completedHeats}</td><td>{formatTime(row.averageTimeMs)}</td><td>{formatTime(row.bestTimeMs)}</td><td>{row.isTied ? "Tied" : "Clear"}</td><td><button type="button" onClick={() => setProof(row)}>Why is Car {row.carNumber} ranked here?</button></td></tr>)}</tbody></table></div>{phase === "preliminary" ? <><InsightStudio event={state} rankings={rankings} /><WhatIfSandbox event={state} /></> : null}{proof ? <RankProofDrawer carId={proof.carId} carLabel={`Car ${proof.carNumber}`} rankings={rankings} onClose={() => setProof(null)} /> : null}</section>;
}

function formatTime(time: number | null): string { return time === null ? "—" : `${(time / 1_000).toFixed(3)} s`; }
