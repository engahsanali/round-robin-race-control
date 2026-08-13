import rawSchedules from "../../../fixtures/schedules.json";

import type { Heat, SchedulePreset } from "./types";

const presetDefinitions = {
  template9: { key: "template9", entrantCount: 9, phase: "preliminary", matches: rawSchedules.template9 as SchedulePreset["matches"] },
  template12: { key: "template12", entrantCount: 12, phase: "preliminary", matches: rawSchedules.template12 as SchedulePreset["matches"] },
  template15: { key: "template15", entrantCount: 15, phase: "preliminary", matches: rawSchedules.template15 as SchedulePreset["matches"] },
  finals15: { key: "finals15", entrantCount: 15, phase: "final", matches: rawSchedules.finals15 as SchedulePreset["matches"] }
} as const satisfies Record<SchedulePreset["key"], SchedulePreset>;

function clonePreset(preset: SchedulePreset): SchedulePreset {
  return {
    ...preset,
    matches: preset.matches.map((match) => match.map((lanes) => [...lanes] as [number, number, number]))
  };
}

export function getPreset(key: SchedulePreset["key"]): SchedulePreset {
  return clonePreset(presetDefinitions[key]);
}

export function mapPresetToCars(preset: SchedulePreset, orderedCarIds: readonly string[]): Heat[] {
  if (orderedCarIds.length !== preset.entrantCount) {
    throw new RangeError(`Preset ${preset.key} requires exactly ${preset.entrantCount} car IDs`);
  }
  if (orderedCarIds.some((carId) => carId.trim().length === 0)) {
    throw new TypeError("Car IDs must be non-empty strings");
  }
  if (new Set(orderedCarIds).size !== orderedCarIds.length) {
    throw new TypeError("Car IDs must be unique");
  }
  for (const match of preset.matches) {
    for (const slots of match) {
      for (const slot of slots) {
        if (!Number.isInteger(slot) || slot < 1 || slot > preset.entrantCount) {
          throw new RangeError(`Preset ${preset.key} contains an invalid slot: ${slot}`);
        }
      }
    }
  }

  return preset.matches.flatMap((match, matchIndex) =>
    match.map((slots, heatIndex) => ({
      id: `preset-${preset.key}-match-${matchIndex + 1}-heat-${heatIndex + 1}`,
      phase: preset.phase,
      matchNumber: matchIndex + 1,
      heatNumber: heatIndex + 1,
      lanes: slots.map((slot) => orderedCarIds[slot - 1]!) as [string, string, string],
      status: "scheduled",
      winnerEntryId: null,
      laneTimesMs: [null, null, null],
      notes: ""
    }))
  );
}

function freezePreset(preset: SchedulePreset): SchedulePreset {
  const snapshot = clonePreset(preset);
  for (const match of snapshot.matches) {
    for (const slots of match) Object.freeze(slots);
    Object.freeze(match);
  }
  Object.freeze(snapshot.matches);
  return Object.freeze(snapshot);
}

export const schedulePresets: Readonly<Record<SchedulePreset["key"], SchedulePreset>> = Object.freeze({
  template9: freezePreset(presetDefinitions.template9),
  template12: freezePreset(presetDefinitions.template12),
  template15: freezePreset(presetDefinitions.template15),
  finals15: freezePreset(presetDefinitions.finals15)
});
