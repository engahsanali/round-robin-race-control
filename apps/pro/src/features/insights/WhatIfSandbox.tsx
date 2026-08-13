import { useMemo, useState } from "react";
import { calculateRankings, calculateStandings, type EventStateV1 } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import { prepareEventCommand } from "../../state/commands";

export function WhatIfSandbox({ event: provided }: { event?: EventStateV1 }) {
  const context = useOptionalEventState();
  const event = provided ?? context?.state ?? null;
  const openHeats = useMemo(() => event?.matches.filter(({ status }) => status !== "completed") ?? [], [event]);
  const [heatId, setHeatId] = useState(""); const [winnerId, setWinnerId] = useState(""); const [simulation, setSimulation] = useState<EventStateV1 | null>(null); const [error, setError] = useState("");
  const selected = openHeats.find(({ id }) => id === heatId) ?? openHeats[0] ?? null;
  if (!event) return null;
  const run = () => { const heat = selected; const winner = winnerId || heat?.lanes.find((id) => id !== null); if (!heat || !winner) { setError("Choose a heat and winner."); return; } try { const cloned = structuredClone(event); const result = prepareEventCommand(cloned, { type: "result.record-winner", heatId: heat.id, carId: winner }, "what-if", event.event.updatedAt); setSimulation(result.event); setHeatId(heat.id); setWinnerId(winner); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Simulation failed"); } };
  return <section className="what-if-sandbox" aria-labelledby="what-if-title"><p className="eyebrow">Pure local projection</p><h2 id="what-if-title">What-if Sandbox</h2><p>Every result below is What-if — not official. It is never saved or broadcast.</p><div className="what-if-controls"><label>Hypothetical heat<select aria-label="Hypothetical heat" value={heatId || selected?.id || ""} onChange={(change) => { setHeatId(change.target.value); setWinnerId(""); }}><option value="">Choose a heat</option>{openHeats.map((heat) => <option value={heat.id} key={heat.id}>Match {heat.matchNumber} Heat {heat.heatNumber}</option>)}</select></label><label>Hypothetical winner<select aria-label="Hypothetical winner" value={winnerId} onChange={(change) => setWinnerId(change.target.value)}><option value="">Choose a winner</option>{selected?.lanes.flatMap((id) => { const entry = event.entries.find((row) => row.id === id); return entry ? [<option value={entry.id} key={entry.id}>Car {entry.carNumber}</option>] : []; })}</select></label><button type="button" onClick={run}>Run what-if</button><button type="button" className="quiet-action" onClick={() => { setSimulation(null); setError(""); }}>Reset what-if</button></div>{error ? <p role="alert">{error}</p> : null}{simulation ? <Simulation event={simulation} /> : null}</section>;
}

function Simulation({ event }: { event: EventStateV1 }) { const rows = calculateRankings(calculateStandings(event, "preliminary"), event.settings); return <section className="what-if-result" aria-label="What-if — not official"><h3>What-if — not official</h3><table aria-label="What-if standings"><thead><tr><th>Rank</th><th>Car</th><th>Wins</th></tr></thead><tbody>{rows.map((row) => <tr key={row.carId}><td>{row.rank ?? "—"}</td><th scope="row">Car {row.carNumber}</th><td>{row.totalWins} win{row.totalWins === 1 ? "" : "s"}</td></tr>)}</tbody></table></section>; }
