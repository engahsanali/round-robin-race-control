import {
  calculateRankings,
  calculateStandings,
  type CsvRow,
  type EventStateV1,
  type RankedStanding,
} from "@rr3/domain";

export type RankingProjection = {
  rankings: RankedStanding[];
  comparisonRankings: RankedStanding[];
  issue: string | null;
};

const ORDINAL_TIE_MESSAGE = "Ordinal ranks are withheld because configured tie breaks leave an unresolved tie.";

export function projectRankings(
  event: EventStateV1,
  phase: "preliminary" | "final",
): RankingProjection {
  const finalistIds = phase === "final"
    ? new Set(event.finals.flatMap(({ lanes }) => lanes.filter((id): id is string => id !== null)))
    : null;
  const standings = calculateStandings(event, phase)
    .filter(({ carId }) => finalistIds === null || finalistIds.has(carId));

  try {
    const rankings = calculateRankings(standings, event.settings);
    return { rankings, comparisonRankings: rankings, issue: null };
  } catch (cause) {
    if (event.settings.rankingMode !== "ordinal") throw cause;
    const comparisonRankings = calculateRankings(standings, {
      ...event.settings,
      rankingMode: "competition",
    });
    const rankings = comparisonRankings.map((row): RankedStanding => ({
      ...row,
      rank: null,
      rankingMode: "ordinal",
      displayOrderIsCompetitive: false,
      displayOrderReason: "Ordinal display order is provisional until every tie is resolved",
    }));
    return { rankings, comparisonRankings, issue: ORDINAL_TIE_MESSAGE };
  }
}

export function buildProjectedStandingsRows(
  event: EventStateV1,
  phase: "preliminary" | "final",
): CsvRow[] {
  const { rankings } = projectRankings(event, phase);
  return [
    [
      "Rank", "Tied", "Car entry ID", "Car number", "Car", "Participant ID", "Participant", "Category",
      "Total wins", "Matches won", "Completed heats", "Average time ms", "Best time ms",
    ],
    ...rankings.map((standing): CsvRow => [
      standing.rank,
      standing.isTied,
      standing.carId,
      standing.carNumber,
      standing.carName,
      standing.participantId,
      standing.participantName,
      standing.categoryId,
      standing.totalWins,
      standing.matchesWon,
      standing.completedHeats,
      standing.averageTimeMs,
      standing.bestTimeMs,
    ]),
  ];
}
