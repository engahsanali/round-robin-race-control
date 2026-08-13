import type { Standing } from "./results";
import type { EventStateV1, TieBreakKey } from "./types";

export type TieBreakValue = number | null;

export type TieBreakComparison = {
  key: TieBreakKey;
  value: TieBreakValue;
  competitive: boolean;
  resolved: boolean;
};

export type RankedStanding = Standing & {
  rank: number | null;
  rankingMode: EventStateV1["settings"]["rankingMode"];
  isTied: boolean;
  tiedWithCarIds: string[];
  displayOrder: number;
  displayOrderIsCompetitive: boolean;
  displayOrderReason: string;
  tieBreaks: TieBreakComparison[];
};

export type RankProof = {
  carId: string;
  rank: number | null;
  isTied: boolean;
  tiedWithCarIds: string[];
  comparisons: TieBreakComparison[];
  summary: string;
};

type RankedWork = {
  standing: Standing;
  values: Map<TieBreakKey, TieBreakValue>;
  resolvedKeys: Set<TieBreakKey>;
};

export function calculateRankings(
  standings: readonly Standing[],
  settings: EventStateV1["settings"]
): RankedStanding[] {
  const active = standings
    .filter(({ active }) => active)
    .map((standing): RankedWork => ({ standing, values: new Map(), resolvedKeys: new Set() }))
    .sort((left, right) => left.standing.carId.localeCompare(right.standing.carId));
  const hasOfficialResult = active.some(({ standing }) => standing.totalWins > 0);

  if (!hasOfficialResult) {
    return active.map(({ standing }, index) => ({
      ...standing,
      rank: null,
      rankingMode: settings.rankingMode,
      isTied: active.length > 1,
      tiedWithCarIds: active.filter(({ standing: other }) => other.carId !== standing.carId).map(({ standing: other }) => other.carId),
      displayOrder: index + 1,
      displayOrderIsCompetitive: false,
      displayOrderReason: "Stable ID order for display only; non-competitive because no official result exists",
      tieBreaks: settings.tieBreakOrder.map((key) => ({
        key,
        value: metricValue(key, standing, active.map(({ standing: row }) => row)),
        competitive: key !== "playoff",
        resolved: false
      }))
    }));
  }

  let groups: RankedWork[][] = [active];
  for (const key of settings.tieBreakOrder) {
    const nextGroups: RankedWork[][] = [];
    for (const group of groups) {
      const groupStandings = group.map(({ standing }) => standing);
      for (const work of group) work.values.set(key, metricValue(key, work.standing, groupStandings));
      const sorted = group.slice().sort((left, right) => compareMetric(key, left.values.get(key) ?? null, right.values.get(key) ?? null));
      const partitions = partitionByMetric(sorted, key);
      if (partitions.length > 1) {
        for (const work of group) work.resolvedKeys.add(key);
      }
      nextGroups.push(...partitions);
    }
    groups = nextGroups;
  }

  if (settings.rankingMode === "ordinal" && groups.some((group) => group.length > 1)) {
    throw new Error("Ordinal ranking requires configured tie breaks to resolve every tie");
  }

  const rankings: RankedStanding[] = [];
  let competitionPosition = 1;
  groups.forEach((group, groupIndex) => {
    const competitiveRank = settings.rankingMode === "dense" ? groupIndex + 1 : competitionPosition;
    const tiedIds = group.map(({ standing }) => standing.carId);
    for (const work of group) {
      const isTied = group.length > 1;
      rankings.push({
        ...work.standing,
        rank: competitiveRank,
        rankingMode: settings.rankingMode,
        isTied,
        tiedWithCarIds: tiedIds.filter((carId) => carId !== work.standing.carId),
        displayOrder: rankings.length + 1,
        displayOrderIsCompetitive: !isTied,
        displayOrderReason: isTied
          ? "Stable ID order for display only; non-competitive tie remains"
          : "Configured competitive tie breaks determine this order",
        tieBreaks: settings.tieBreakOrder.map((key) => ({
          key,
          value: work.values.get(key) ?? metricValue(key, work.standing, [work.standing]),
          competitive: key !== "playoff",
          resolved: work.resolvedKeys.has(key)
        }))
      });
    }
    competitionPosition += group.length;
  });
  return rankings;
}

export function explainRank(carId: string, rankings: readonly RankedStanding[]): RankProof {
  const ranked = rankings.find((standing) => standing.carId === carId);
  if (!ranked) throw new Error(`Unknown ranked car ID: ${carId}`);
  const rankText = ranked.rank === null ? "No competitive rank is assigned" : `Competitive rank ${ranked.rank}`;
  const tieText = ranked.isTied ? `; unresolved tie with ${ranked.tiedWithCarIds.join(", ")}` : "; tie breaks resolved";
  return {
    carId,
    rank: ranked.rank,
    isTied: ranked.isTied,
    tiedWithCarIds: [...ranked.tiedWithCarIds],
    comparisons: ranked.tieBreaks.map((comparison) => ({ ...comparison })),
    summary: `${rankText}${tieText}. ${ranked.displayOrderReason}.`
  };
}

function metricValue(key: TieBreakKey, standing: Standing, group: readonly Standing[]): TieBreakValue {
  switch (key) {
    case "totalWins": return standing.totalWins;
    case "headToHead": return group.reduce((total, opponent) => total + (standing.headToHeadWins[opponent.carId] ?? 0), 0);
    case "matchesWon": return standing.matchesWon;
    case "averageTime": return standing.averageTimeMs;
    case "bestTime": return standing.bestTimeMs;
    case "laneBalance": return standing.laneBalanceScore;
    case "carNumber": return standing.carNumber;
    case "playoff": return null;
  }
}

function compareMetric(key: TieBreakKey, left: TieBreakValue, right: TieBreakValue): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left === right) return 0;
  const ascending = key === "averageTime" || key === "bestTime" || key === "laneBalance" || key === "carNumber";
  return ascending ? left - right : right - left;
}

function partitionByMetric(group: RankedWork[], key: TieBreakKey): RankedWork[][] {
  const partitions: RankedWork[][] = [];
  for (const work of group) {
    const previous = partitions.at(-1)?.[0];
    if (!previous || compareMetric(key, previous.values.get(key) ?? null, work.values.get(key) ?? null) !== 0) {
      partitions.push([work]);
    } else {
      partitions.at(-1)?.push(work);
    }
  }
  return partitions;
}
