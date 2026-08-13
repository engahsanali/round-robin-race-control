import type { Heat } from "@rr3/domain";

import { mulberry32, seedToUint32 } from "./prng";

export type CustomScheduleOptions = {
  matches: number;
  seed: string;
  restarts?: number;
  iterationsPerRestart?: number;
};

export type ScheduleScore = readonly [
  invalidHeatCount: number,
  appearanceImbalance: number,
  weightedPairRepeatPenalty: number,
  maximumPairFrequency: number,
  maximumLaneSpread: number,
  consecutiveByePenalty: number,
  immediateRepeatPenalty: number,
  stableScheduleKey: string
];

export type GeneratedSchedule = {
  heats: Heat[];
  score: ScheduleScore;
};

type MatchPlan = {
  groups: string[][];
  byes: string[];
};

const DEFAULT_RESTARTS = 24;
const DEFAULT_ITERATIONS_PER_RESTART = 1_500;
const MAX_SEARCH_UNITS = 250_000;
const MAX_RESTARTS = 128;
const MAX_ITERATIONS_PER_RESTART = 10_000;

function pairKey(first: string, second: string): string {
  return first < second ? `${first}::${second}` : `${second}::${first}`;
}

function range(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

function comparePrimitive(left: number | string, right: number | string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareScores(left: ScheduleScore, right: ScheduleScore): number {
  for (let index = 0; index < left.length; index += 1) {
    const comparison = comparePrimitive(left[index]!, right[index]!);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function clonePlan(plan: readonly MatchPlan[]): MatchPlan[] {
  return plan.map((match) => ({
    groups: match.groups.map((group) => [...group]),
    byes: [...match.byes]
  }));
}

function sequentialPlan(carIds: readonly string[], matches: number): MatchPlan[] {
  return Array.from({ length: matches }, () => {
    const byeCount = carIds.length % 3 === 1 ? 1 : 0;
    const assigned = carIds.slice(0, carIds.length - byeCount);
    const groups: string[][] = [];
    for (let offset = 0; offset < assigned.length; offset += 3) {
      groups.push(assigned.slice(offset, offset + 3));
    }
    return { groups, byes: carIds.slice(carIds.length - byeCount) };
  });
}

function seededPlan(
  carIds: readonly string[],
  matches: number,
  restart: number,
  random: () => number
): MatchPlan[] {
  const circle = shuffled(carIds, random);
  return Array.from({ length: matches }, (_, matchIndex) => {
    const byeId = carIds.length % 3 === 1 ? circle[(matchIndex + restart) % circle.length]! : null;
    const available = circle.filter((id) => id !== byeId);
    const rotated = available.length === 0
      ? []
      : available.map((_, index) => available[(index + matchIndex) % available.length]!);
    const ordered = shuffled(rotated, random);
    const groups: string[][] = [];
    for (let offset = 0; offset < ordered.length; offset += 3) {
      groups.push(ordered.slice(offset, offset + 3));
    }
    return { groups, byes: byeId === null ? [] : [byeId] };
  });
}

function permutations(values: readonly string[]): string[][] {
  if (values.length <= 1) return [[...values]];
  const result: string[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const first = values[index]!;
    for (const tail of permutations([...values.slice(0, index), ...values.slice(index + 1)])) {
      result.push([first, ...tail]);
    }
  }
  return result;
}

function laneCost(
  orderedGroup: readonly string[],
  laneCounts: ReadonlyMap<string, readonly [number, number, number]>
): readonly [number, number, string] {
  let maximumSpread = 0;
  let squaredCounts = 0;
  for (let carIndex = 0; carIndex < orderedGroup.length; carIndex += 1) {
    const counts = [...laneCounts.get(orderedGroup[carIndex]!)!] as [number, number, number];
    counts[carIndex as 0 | 1 | 2] += 1;
    maximumSpread = Math.max(maximumSpread, range(counts));
    squaredCounts += counts.reduce((total, count) => total + count * count, 0);
  }
  return [maximumSpread, squaredCounts, JSON.stringify(orderedGroup)];
}

function assignLanes(plan: readonly MatchPlan[], carIds: readonly string[]): Heat[] {
  const laneCounts = new Map<string, [number, number, number]>(
    carIds.map((id) => [id, [0, 0, 0]])
  );
  const heats: Heat[] = [];
  plan.forEach((match, matchIndex) => {
    match.groups.forEach((group, heatIndex) => {
      const ordered = permutations(group).sort((left, right) => {
        const leftCost = laneCost(left, laneCounts);
        const rightCost = laneCost(right, laneCounts);
        for (let index = 0; index < leftCost.length; index += 1) {
          const comparison = comparePrimitive(leftCost[index]!, rightCost[index]!);
          if (comparison !== 0) return comparison;
        }
        return 0;
      })[0]!;
      ordered.forEach((id, lane) => {
        laneCounts.get(id)![lane as 0 | 1 | 2] += 1;
      });
      heats.push({
        id: `custom-m${matchIndex + 1}-h${heatIndex + 1}`,
        phase: "preliminary",
        matchNumber: matchIndex + 1,
        heatNumber: heatIndex + 1,
        lanes: [ordered[0] ?? null, ordered[1] ?? null, ordered[2] ?? null],
        status: "scheduled",
        winnerEntryId: null,
        laneTimesMs: [null, null, null],
        notes: ""
      });
    });
  });
  return heats;
}

function scoreHeats(heats: readonly Heat[], carIds: readonly string[]): ScheduleScore {
  const appearances = new Map(carIds.map((id) => [id, 0]));
  const laneCounts = new Map<string, [number, number, number]>(carIds.map((id) => [id, [0, 0, 0]]));
  const pairCounts = new Map<string, number>();
  const seenHeatIds = new Set<string>();
  const heatsByMatch = new Map<number, Heat[]>();
  let invalidHeatCount = 0;

  for (const heat of heats) {
    if (seenHeatIds.has(heat.id)) invalidHeatCount += 1;
    seenHeatIds.add(heat.id);
    const assigned = heat.lanes.filter((id): id is string => id !== null);
    if (assigned.length < 2 || assigned.length > 3 || new Set(assigned).size !== assigned.length) {
      invalidHeatCount += 1;
    }
    for (const id of assigned) {
      if (!appearances.has(id)) {
        invalidHeatCount += 1;
        continue;
      }
      appearances.set(id, appearances.get(id)! + 1);
    }
    heat.lanes.forEach((id, lane) => {
      if (id !== null && laneCounts.has(id)) laneCounts.get(id)![lane as 0 | 1 | 2] += 1;
    });
    for (let first = 0; first < assigned.length; first += 1) {
      for (let second = first + 1; second < assigned.length; second += 1) {
        const key = pairKey(assigned[first]!, assigned[second]!);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
    const matchHeats = heatsByMatch.get(heat.matchNumber) ?? [];
    matchHeats.push(heat);
    heatsByMatch.set(heat.matchNumber, matchHeats);
  }

  let consecutiveByePenalty = 0;
  let immediateRepeatPenalty = 0;
  let previousByes = new Set<string>();
  let previousPairs = new Set<string>();
  for (const [, matchHeats] of [...heatsByMatch].sort(([left], [right]) => left - right)) {
    const present = new Set<string>();
    const pairs = new Set<string>();
    for (const heat of matchHeats) {
      const assigned = heat.lanes.filter((id): id is string => id !== null);
      for (const id of assigned) {
        if (present.has(id)) invalidHeatCount += 1;
        present.add(id);
      }
      for (let first = 0; first < assigned.length; first += 1) {
        for (let second = first + 1; second < assigned.length; second += 1) {
          pairs.add(pairKey(assigned[first]!, assigned[second]!));
        }
      }
    }
    const byes = new Set(carIds.filter((id) => !present.has(id)));
    for (const id of byes) if (previousByes.has(id)) consecutiveByePenalty += 1;
    for (const pair of pairs) if (previousPairs.has(pair)) immediateRepeatPenalty += 1;
    previousByes = byes;
    previousPairs = pairs;
  }

  const pairFrequencies = [...pairCounts.values()];
  const weightedPairRepeatPenalty = pairFrequencies.reduce(
    (total, count) => total + Math.max(0, count - 1) + 4 * Math.max(0, count - 2),
    0
  );
  return [
    invalidHeatCount,
    range([...appearances.values()]),
    weightedPairRepeatPenalty,
    pairFrequencies.length === 0 ? 0 : Math.max(...pairFrequencies),
    Math.max(0, ...[...laneCounts.values()].map((counts) => range(counts))),
    consecutiveByePenalty,
    immediateRepeatPenalty,
    JSON.stringify(heats.map((heat) => heat.lanes))
  ];
}

function evaluate(plan: readonly MatchPlan[], carIds: readonly string[]): GeneratedSchedule {
  const heats = assignLanes(plan, carIds);
  return { heats, score: scoreHeats(heats, carIds) };
}

function assignedLocations(match: MatchPlan): Array<readonly [number, number]> {
  return match.groups.flatMap((group, groupIndex) =>
    group.map((_, carIndex) => [groupIndex, carIndex] as const)
  );
}

function mutatePlan(plan: MatchPlan[], random: () => number, iteration: number): void {
  const match = plan[Math.floor(random() * plan.length)]!;
  const locations = assignedLocations(match);
  if (match.byes.length === 1 && random() < 0.2) {
    const [groupIndex, carIndex] = locations[Math.floor(random() * locations.length)]!;
    const assigned = match.groups[groupIndex]![carIndex]!;
    match.groups[groupIndex]![carIndex] = match.byes[0]!;
    match.byes[0] = assigned;
    return;
  }

  const firstIndex = Math.floor(random() * locations.length);
  let secondIndex = Math.floor(random() * (locations.length - 1));
  if (secondIndex >= firstIndex) secondIndex += 1;
  const first = locations[firstIndex]!;
  const second = locations[secondIndex]!;
  if (iteration % 5 !== 4 || locations.length < 3) {
    const temporary = match.groups[first[0]]![first[1]]!;
    match.groups[first[0]]![first[1]] = match.groups[second[0]]![second[1]]!;
    match.groups[second[0]]![second[1]] = temporary;
    return;
  }

  let thirdIndex = Math.floor(random() * (locations.length - 2));
  const occupied = [firstIndex, secondIndex].sort((left, right) => left - right);
  if (thirdIndex >= occupied[0]!) thirdIndex += 1;
  if (thirdIndex >= occupied[1]!) thirdIndex += 1;
  const third = locations[thirdIndex]!;
  const temporary = match.groups[third[0]]![third[1]]!;
  match.groups[third[0]]![third[1]] = match.groups[second[0]]![second[1]]!;
  match.groups[second[0]]![second[1]] = match.groups[first[0]]![first[1]]!;
  match.groups[first[0]]![first[1]] = temporary;
}

function assertInputs(carIds: readonly string[], options: CustomScheduleOptions): void {
  if (carIds.length < 3 || carIds.length > 24) {
    throw new RangeError("Custom schedules require between 3 and 24 cars");
  }
  if (carIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new TypeError("Every car must have a non-empty stable string ID");
  }
  if (new Set(carIds).size !== carIds.length) {
    throw new TypeError("Car IDs must be unique");
  }
  if (!Number.isInteger(options.matches) || options.matches < 1 || options.matches > 10) {
    throw new RangeError("matches must be an integer from 1 through 10");
  }
  if (typeof options.seed !== "string") throw new TypeError("seed must be a string");
  for (const [name, value] of [
    ["restarts", options.restarts],
    ["iterationsPerRestart", options.iterationsPerRestart]
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }
}

export function generateCustomSchedule(
  carIds: readonly string[],
  options: CustomScheduleOptions
): GeneratedSchedule {
  assertInputs(carIds, options);
  const requestedRestarts = Math.min(options.restarts ?? DEFAULT_RESTARTS, MAX_RESTARTS);
  const requestedIterations = Math.min(
    options.iterationsPerRestart ?? DEFAULT_ITERATIONS_PER_RESTART,
    MAX_ITERATIONS_PER_RESTART
  );
  const unitSize = carIds.length * options.matches;
  const restarts = Math.min(requestedRestarts, Math.max(1, Math.floor(MAX_SEARCH_UNITS / unitSize)));
  const iterationsPerRestart = Math.min(
    requestedIterations,
    Math.max(1, Math.floor(MAX_SEARCH_UNITS / (unitSize * restarts)))
  );

  let best = evaluate(sequentialPlan(carIds, options.matches), carIds);
  for (let restart = 0; restart < restarts; restart += 1) {
    const random = mulberry32(seedToUint32(`${options.seed}\u0000${restart}`));
    let currentPlan = seededPlan(carIds, options.matches, restart, random);
    let current = evaluate(currentPlan, carIds);
    if (compareScores(current.score, best.score) < 0) best = current;

    for (let iteration = 0; iteration < iterationsPerRestart; iteration += 1) {
      const candidatePlan = clonePlan(currentPlan);
      mutatePlan(candidatePlan, random, iteration);
      const candidate = evaluate(candidatePlan, carIds);
      if (compareScores(candidate.score, current.score) <= 0) {
        currentPlan = candidatePlan;
        current = candidate;
      }
      if (compareScores(candidate.score, best.score) < 0) best = candidate;
    }
  }
  return best;
}
