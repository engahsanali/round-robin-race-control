import type { Heat, ScheduleQualityReport } from "./types";

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function pairKey(first: string, second: string): string {
  return [first, second].sort().join("::");
}

function range(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

export function analyseSchedule(heats: readonly Heat[], activeCarIds: readonly string[]): ScheduleQualityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const appearances = emptyRecord<number>();
  const laneCounts = emptyRecord<[number, number, number]>();
  const byeCounts = emptyRecord<number>();
  const twoCarHeatCounts = emptyRecord<number>();
  const pairCounts = emptyRecord<number>();
  const activeIds = new Set<string>();

  for (const carId of activeCarIds) {
    if (activeIds.has(carId)) {
      errors.push(`Active car ID ${carId} appears more than once`);
      continue;
    }
    activeIds.add(carId);
    appearances[carId] = 0;
    laneCounts[carId] = [0, 0, 0];
    byeCounts[carId] = 0;
    twoCarHeatCounts[carId] = 0;
  }

  const seenHeatIds = new Set<string>();
  for (const heat of heats) {
    if (seenHeatIds.has(heat.id)) {
      errors.push(`Duplicate heat ID: ${heat.id}`);
    }
    seenHeatIds.add(heat.id);

    const assigned = heat.lanes.filter((carId): carId is string => carId !== null);
    const distinctAssigned = new Set(assigned);
    if (distinctAssigned.size !== assigned.length) {
      errors.push(`A car is assigned more than once in heat ${heat.id}`);
    }
    for (const carId of distinctAssigned) {
      if (!activeIds.has(carId)) {
        errors.push(`Heat ${heat.id} references unknown active car ${carId}`);
      }
    }
    if (heat.winnerEntryId !== null && !distinctAssigned.has(heat.winnerEntryId)) {
      errors.push(`Heat ${heat.id} winner must be assigned to a lane`);
    }

    const activeAssigned = [...distinctAssigned].filter((carId) => activeIds.has(carId));
    const activeAssignedSet = new Set(activeAssigned);
    for (const carId of activeIds) {
      if (!activeAssignedSet.has(carId)) byeCounts[carId]! += 1;
    }
    if (activeAssigned.length === 2) {
      for (const carId of activeAssigned) twoCarHeatCounts[carId]! += 1;
    }
    heat.lanes.forEach((carId, lane) => {
      if (carId !== null && activeIds.has(carId)) {
        appearances[carId]! += 1;
        laneCounts[carId]![lane as 0 | 1 | 2] += 1;
      }
    });
    for (let firstIndex = 0; firstIndex < activeAssigned.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < activeAssigned.length; secondIndex += 1) {
        const key = pairKey(activeAssigned[firstIndex]!, activeAssigned[secondIndex]!);
        pairCounts[key] = (pairCounts[key] ?? 0) + 1;
      }
    }
  }

  const totalByes = Object.values(byeCounts).reduce((sum, count) => sum + count, 0);
  if (totalByes > 0) warnings.push(`Schedule contains ${totalByes} bye assignment(s)`);
  const totalTwoCarParticipations = Object.values(twoCarHeatCounts).reduce((sum, count) => sum + count, 0);
  if (totalTwoCarParticipations > 0) warnings.push("Schedule contains two-car heat participation");

  const pairFrequencies = Object.values(pairCounts);
  const repeatedOpponentCount = pairFrequencies.filter((count) => count > 1).length;
  const maximumPairFrequency = pairFrequencies.length === 0 ? 0 : Math.max(...pairFrequencies);
  const appearanceImbalance = range(Object.values(appearances));
  const maximumLaneSpread = Math.max(0, ...Object.values(laneCounts).map((counts) => range(counts)));

  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "valid-with-warnings" : "valid",
    errors,
    warnings,
    appearances,
    laneCounts,
    pairCounts,
    repeatedOpponentCount,
    maximumPairFrequency,
    appearanceImbalance,
    maximumLaneSpread,
    byeCounts,
    twoCarHeatCounts
  };
}
