import { selectFinalists, type EventStateV1, type RankedStanding } from "@rr3/domain";
import { projectRankings } from "../standings/rankingProjection";

type InsightStudioProps = { event: EventStateV1; rankings: readonly RankedStanding[] };

export function InsightStudio({ event, rankings }: InsightStudioProps) {
  const hasOfficialResult = rankings.some(({ completedHeats }) => completedHeats > 0);
  const leader = hasOfficialResult ? rankings.find(({ rank }) => rank !== null) : undefined;
  const runnerUp = rankings.find(({ rank }) => rank !== leader?.rank);
  const matchNumbers = [...new Set(event.matches.map(({ matchNumber }) => matchNumber))].sort((a, b) => a - b);
  const headToHead = pairRows(event);
  const decision = selectFinalists(rankings, event.settings.finalistCount);
  return (
    <section className="insight-studio" aria-labelledby="insight-studio-title">
      <p className="eyebrow">Accessible analytics</p><h2 id="insight-studio-title">Insight Studio</h2>
      <div className="insight-grid">
        <Insight name="Leader gap" takeaway={leader ? `${carLabel(leader)} leads by ${Math.max(0, leader.totalWins - (runnerUp?.totalWins ?? 0))} win(s).` : "No official result yet; no leader is inferred."} heads={["Car", "Wins", "Gap"]} rows={rankings.map((row) => [carLabel(row), row.totalWins, leader ? Math.max(0, leader.totalWins - row.totalWins) : 0])} />
        <Insight name="Rank history" takeaway="Rank movement is reconstructed after each completed match." heads={["Match", ...rankings.map(carLabel)]} rows={matchNumbers.map((match) => [match, ...rankAfterMatch(event, match, rankings.map(({ carId }) => carId))])} />
        <Insight name="Cumulative wins" takeaway="Cumulative official wins never include scheduled, rerun, or cancelled heats." heads={["Car", ...matchNumbers.map((match) => `Match ${match}`)]} rows={rankings.map((row) => [carLabel(row), ...cumulativeWins(event, row.carId, matchNumbers)])} />
        <Insight name="Win distribution" takeaway={`${rankings.filter(({ totalWins }) => totalWins > 0).length} cars have an official win.`} heads={["Car", "Official wins"]} rows={rankings.map((row) => [carLabel(row), row.totalWins])} />
        <Insight name="Lane balance" takeaway="A lower spread means a more even completed-result lane distribution." heads={["Car", "Lane 1", "Lane 2", "Lane 3", "Spread"]} rows={rankings.map((row) => { const counts = laneCounts(event, row.carId); return [carLabel(row), ...counts, Math.max(...counts) - Math.min(...counts)]; })} />
        <Insight name="Head-to-head matrix" takeaway={`${headToHead.filter((row) => Number(row[3]) > 1).length} opponent pairs have met more than once in completed heats.`} heads={["First car", "Second car", "First wins", "Meetings"]} rows={headToHead} />
        <Insight name="Consistency" takeaway="Consistency compares recent form and the spread between recorded race times." heads={["Car", "Recent wins", "Recent starts", "Time spread ms"]} rows={rankings.map((row) => [carLabel(row), row.recentForm.filter((result) => result === "win").length, row.recentForm.length, timeSpread(event, row.carId)])} />
        <Insight name="Qualification cutoff" takeaway={!hasOfficialResult ? "Provisional: no official result exists, so no car is qualified." : decision.tiedCutoffEntrants.length ? `Provisional: ${decision.tiedCutoffEntrants.length} cars are tied across the cutoff; a decision is required.` : `Provisional: ${decision.automaticQualifiers.length} automatic qualifiers currently clear the cutoff.`} heads={["Car", "Rank", "Position"]} rows={rankings.map((row) => [carLabel(row), row.rank ?? "—", !hasOfficialResult ? "Awaiting result" : decision.automaticQualifiers.some(({ carId }) => carId === row.carId) ? "Automatic" : decision.tiedCutoffEntrants.some(({ carId }) => carId === row.carId) ? "Cutoff tie" : "Outside"])} />
      </div>
    </section>
  );
}

function Insight({ name, takeaway, heads, rows }: { name: string; takeaway: string; heads: string[]; rows: Array<Array<string | number>> }) {
  return <section className="insight-card" aria-label={name}><h3>{name}</h3><div className="insight-graphic" role="img" aria-label={`${name} visualization`}>{rows.slice(0, 12).map((row, index) => <span key={index} style={{ inlineSize: `${Math.max(8, Math.min(100, Number(row.at(-1)) * 12 || 12))}%` }} />)}</div><p><strong>Takeaway:</strong> {takeaway}</p><div className="insight-table-scroll"><table aria-label={`${name} data`}><thead><tr>{heads.map((head) => <th scope="col" key={head}>{head}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => cellIndex === 0 ? <th scope="row" key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></section>;
}

function carLabel(row: Pick<RankedStanding, "carNumber">): string { return `Car ${row.carNumber}`; }
function cumulativeWins(event: EventStateV1, carId: string, matches: number[]): number[] { let total = 0; return matches.map((match) => { total += event.matches.filter((heat) => heat.matchNumber === match && heat.status === "completed" && heat.winnerEntryId === carId).length; return total; }); }
function rankAfterMatch(event: EventStateV1, match: number, carIds: string[]): Array<string | number> { const clone = structuredClone(event); clone.matches = clone.matches.map((heat) => heat.matchNumber <= match ? heat : { ...heat, status: "scheduled", winnerEntryId: null, laneTimesMs: [null, null, null] }); const map = new Map(projectRankings(clone, "preliminary").rankings.map((row) => [row.carId, row.rank])); return carIds.map((id) => map.get(id) ?? "—"); }
function pairRows(event: EventStateV1): Array<Array<string | number>> { const map = new Map<string, { a: string; b: string; wins: number; meetings: number }>(); for (const heat of event.matches.filter(({ status }) => status === "completed")) { const ids = heat.lanes.filter((id): id is string => id !== null); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const sorted = [ids[i]!, ids[j]!].sort(); const a = sorted[0]!; const b = sorted[1]!; const key = JSON.stringify([a, b]); const row = map.get(key) ?? { a, b, wins: 0, meetings: 0 }; row.meetings += 1; if (heat.winnerEntryId === a) row.wins += 1; map.set(key, row); } } const n = (id: string) => event.entries.find((entry) => entry.id === id)?.carNumber ?? id; return [...map.values()].map((row) => [`Car ${n(row.a)}`, `Car ${n(row.b)}`, row.wins, row.meetings]); }
function timeSpread(event: EventStateV1, carId: string): number { const times = event.matches.flatMap((heat) => { const lane = heat.lanes.indexOf(carId); return heat.status === "completed" && lane >= 0 && heat.laneTimesMs[lane] !== null ? [heat.laneTimesMs[lane]!] : []; }); return times.length < 2 ? 0 : Math.max(...times) - Math.min(...times); }
function laneCounts(event: EventStateV1, carId: string): [number, number, number] { const counts: [number, number, number] = [0, 0, 0]; for (const heat of event.matches) { if (heat.status !== "completed") continue; const lane = heat.lanes.indexOf(carId); if (lane >= 0 && lane < 3) counts[lane] = (counts[lane] ?? 0) + 1; } return counts; }
