import { describe, expect, it } from "vitest";

import schedules from "../../../fixtures/schedules.json";
import { getPreset, mapPresetToCars, schedulePresets } from "./presets";

const PRESET_KEYS = ["template9", "template12", "template15", "finals15"] as const;

const EXPECTED_MATCH_COUNTS = {
  template9: 4,
  template12: 5,
  template15: 6,
  finals15: 5
} as const;

const EXPECTED_HEAT_COUNTS = {
  template9: 12,
  template12: 20,
  template15: 30,
  finals15: 25
} as const;

describe("fixed schedule presets", () => {
  it.each(PRESET_KEYS)("keeps %s exactly equal to its canonical fixture", (key) => {
    const preset = getPreset(key);

    expect(preset.matches).toEqual(schedules[key]);
    expect(preset.matches).toHaveLength(EXPECTED_MATCH_COUNTS[key]);
    expect(preset.matches.flat()).toHaveLength(EXPECTED_HEAT_COUNTS[key]);
  });

  it.each(PRESET_KEYS)("gives every car one distinct three-lane heat in each %s match", (key) => {
    const preset = getPreset(key);

    for (const match of preset.matches) {
      expect(match.flat()).toHaveLength(preset.entrantCount);
      expect(new Set(match.flat()).size).toBe(preset.entrantCount);
      for (const lanes of match) {
        expect(lanes).toHaveLength(3);
        expect(new Set(lanes).size).toBe(3);
      }
    }
  });

  it.each(PRESET_KEYS)("maps every %s fixture heat to ordered stable car IDs with unique IDs", (key) => {
    const preset = getPreset(key);
    const carIds = Array.from({ length: preset.entrantCount }, (_, index) => `car-${index + 1}`);

    const heats = mapPresetToCars(preset, carIds);

    expect(heats).toHaveLength(schedules[key].flat().length);
    expect(new Set(heats.map((heat) => heat.id)).size).toBe(heats.length);
    expect(heats.every((heat) => heat.phase === preset.phase)).toBe(true);
    expect(heats.every((heat) => heat.status === "scheduled" && heat.winnerEntryId === null)).toBe(true);
    expect(heats.map((heat) => heat.lanes)).toEqual(
      schedules[key].flat().map((lanes) => lanes.map((slot) => carIds[slot - 1]))
    );
    expect(Object.values(
      heats.flatMap((heat) => heat.lanes).reduce<Record<string, number>>((counts, carId) => {
        if (carId === null) throw new Error("A fixed preset heat must map every lane");
        counts[carId] = (counts[carId] ?? 0) + 1;
        return counts;
      }, {})
    )).toEqual(Array.from({ length: preset.entrantCount }, () => EXPECTED_MATCH_COUNTS[key]));
  });

  it("maps the six-match 15-car preliminary template without an empty seventh match", () => {
    const preset = getPreset("template15");
    const heats = mapPresetToCars(preset, Array.from({ length: 15 }, (_, index) => `car-${index + 1}`));

    expect([...new Set(heats.map((heat) => heat.matchNumber))]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(heats.some((heat) => heat.matchNumber === 7)).toBe(false);
  });

  it("rejects a car list that cannot map the preset slots", () => {
    expect(() => mapPresetToCars(getPreset("template9"), ["car-1", "car-2"])).toThrow(/9/);
    expect(() => mapPresetToCars(getPreset("template9"), Array.from({ length: 9 }, () => "car-1"))).toThrow(/unique/i);
  });

  it.each([0, 10, 1.5])("rejects a preset slot outside its integer entrant range: %s", (invalidSlot) => {
    const preset = getPreset("template9");
    preset.matches[0]![0]![0] = invalidSlot;

    expect(() => mapPresetToCars(preset, Array.from({ length: 9 }, (_, index) => `car-${index + 1}`))).toThrow(/slot/i);
  });

  it("exposes frozen schedule presets without sharing mutable backing arrays", () => {
    expect(Object.isFrozen(schedulePresets)).toBe(true);
    expect(Object.isFrozen(schedulePresets.template9)).toBe(true);
    expect(Object.isFrozen(schedulePresets.template9.matches)).toBe(true);
    expect(Object.isFrozen(schedulePresets.template9.matches[0])).toBe(true);
    expect(Object.isFrozen(schedulePresets.template9.matches[0]![0])).toBe(true);
    expect(() => { schedulePresets.template9.matches[0]![0]![0] = 9; }).toThrow();
    expect(getPreset("template9").matches[0]![0]![0]).toBe(1);
  });
});
