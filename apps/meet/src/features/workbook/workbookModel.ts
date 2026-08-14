import {
  analyseSchedule,
  calculateRankings,
  calculateStandings,
  getPreset,
  mapPresetToCars,
  type Heat,
  type ScheduleQualityReport,
} from "@rr3/domain";
import { generateCustomSchedule } from "@rr3/scheduler";
import type { BracketState } from "@rr3/meet-domain";

export type RegistrationDraft = {
  participantId: string;
  participantName: string;
  email: string;
  phone: string;
  notes: string;
  carId: string;
  carNumber: number;
  carName: string;
  active: boolean;
};

export type RegistrationParse = { ok: boolean; rows: RegistrationDraft[]; errors: string[] };
export type ScheduleCandidate = {
  source: string;
  seed: string;
  heats: Heat[];
  quality: {
    opponentRepeatExcess: number;
    lowerBound: number;
    gap: number;
    maxPairFrequency: number;
    maxCarRepeatBurden: number;
    laneSpread: number;
    provenOptimal: boolean;
    status: ScheduleQualityReport["status"];
  };
};

export function registrationRows(bracket: BracketState): RegistrationDraft[] {
  const participantById = new Map(bracket.event.participants.map((participant) => [participant.id, participant]));
  return bracket.event.entries.map((car) => {
    const participant = participantById.get(car.participantId);
    if (!participant) throw new Error(`Car ${car.id} has no participant`);
    return {
      participantId: participant.id,
      participantName: participant.name,
      email: participant.email,
      phone: participant.phone,
      notes: participant.notes,
      carId: car.id,
      carNumber: car.carNumber,
      carName: car.name,
      active: car.active,
    };
  });
}

export function parseRegistrationPaste(value: string): RegistrationParse {
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const rows: RegistrationDraft[] = [];
  const errors: string[] = [];
  const numbers = new Set<number>();
  lines.forEach((line, index) => {
    const [numberText = "", participantName = "", carName = "", email = "", phone = "", notes = ""] = line.split("\t").map((cell) => cell.trim());
    const carNumber = Number(numberText);
    if (!Number.isSafeInteger(carNumber) || carNumber < 1 || carNumber > 999_999) errors.push(`Row ${index + 1}: car number must be 1–999999.`);
    if (!participantName) errors.push(`Row ${index + 1}: participant name is required.`);
    if (!carName) errors.push(`Row ${index + 1}: car name is required.`);
    if (numbers.has(carNumber)) errors.push(`Row ${index + 1}: duplicate car number ${carNumber} in this bracket.`);
    numbers.add(carNumber);
    rows.push({
      participantId: crypto.randomUUID(), participantName, email, phone, notes,
      carId: crypto.randomUUID(), carNumber, carName, active: true,
    });
  });
  return errors.length > 0 || rows.length === 0
    ? { ok: false, rows: [], errors: errors.length ? errors : ["Paste at least one tab-separated row."] }
    : { ok: true, rows, errors: [] };
}

function qualityView(quality: ScheduleQualityReport): ScheduleCandidate["quality"] {
  return {
    opponentRepeatExcess: quality.repeatedOpponentCount,
    lowerBound: quality.repeatExcessLowerBound,
    gap: quality.repeatExcessGap,
    maxPairFrequency: quality.maximumPairFrequency,
    maxCarRepeatBurden: quality.worstPerCarRepeatBurden,
    laneSpread: quality.maximumLaneSpread,
    provenOptimal: quality.opponentQualityStatus === "certified-optimal",
    status: quality.status,
  };
}

export function buildScheduleCandidate(bracket: BracketState, options: { seed: string; rounds: number }): ScheduleCandidate {
  const cars = bracket.event.entries.filter((entry) => entry.active).slice().sort((a, b) => a.carNumber - b.carNumber || a.id.localeCompare(b.id));
  if (cars.length < 3) throw new Error("At least three active cars are required to generate a schedule.");
  const presetKey = cars.length === 9 ? "template9" : cars.length === 12 ? "template12" : cars.length === 15 ? (bracket.stage === "final" ? "finals15" : "template15") : null;
  if (presetKey) {
    const preset = getPreset(presetKey);
    const heats: Heat[] = mapPresetToCars(preset, cars.map((car) => car.id)).map((heat, index) => ({ ...heat, id: deterministicUuid(`${bracket.id}:${presetKey}:${index}`), phase: bracket.stage === "final" ? "final" as const : "preliminary" as const }));
    return { source: `${presetKey === "finals15" ? "Finals 15" : `Template ${cars.length}`} preset`, seed: `${bracket.id}:${presetKey}`, heats, quality: qualityView(analyseSchedule(heats, cars.map((car) => car.id))) };
  }
  const generated = generateCustomSchedule(cars.map((car) => car.id), { matches: options.rounds, seed: options.seed });
  const heats = generated.heats.map((heat, index) => ({ ...heat, id: deterministicUuid(`${bracket.id}:${options.seed}:${index}`), phase: bracket.stage === "final" ? "final" as const : "preliminary" as const }));
  return { source: "Deterministic custom optimiser", seed: options.seed, heats, quality: qualityView(analyseSchedule(heats, cars.map((car) => car.id))) };
}

export function selectBracketView(bracket: BracketState) {
  const phase = bracket.stage === "final" ? "final" : "preliminary";
  const heats = phase === "final" ? bracket.event.finals : bracket.event.matches;
  const standings = calculateRankings(calculateStandings(bracket.event, phase), bracket.event.settings);
  const pending = heats.filter((heat) => heat.status === "scheduled" || heat.status === "rerun");
  const complete = heats.filter((heat) => heat.status === "completed").length;
  const winner = heats.length > 0 && complete === heats.length ? standings.find((row) => row.rank === 1 && !row.isTied) ?? null : null;
  return { standings, currentHeat: pending[0] ?? null, nextHeat: pending[1] ?? null, complete, total: heats.length, winner };
}

export function schedulePayload(candidate: ScheduleCandidate) {
  return {
    seed: candidate.seed,
    quality: {
      opponentRepeatExcess: candidate.quality.opponentRepeatExcess,
      lowerBound: candidate.quality.lowerBound,
      maxPairFrequency: candidate.quality.maxPairFrequency,
      maxCarRepeatBurden: candidate.quality.maxCarRepeatBurden,
      laneSpread: candidate.quality.laneSpread,
      provenOptimal: candidate.quality.provenOptimal,
    },
    heats: candidate.heats.map((heat) => ({ id: heat.id, roundNumber: heat.matchNumber, heatNumber: heat.heatNumber, phase: heat.phase, lanes: heat.lanes.filter((id): id is string => id !== null) })),
  };
}

function deterministicUuid(input: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    first = Math.imul(first ^ input.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ (input.charCodeAt(index) + index), 0x85ebca6b);
  }
  const hex = `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}${((first ^ second) >>> 0).toString(16).padStart(8, "0")}${(Math.imul(first, second) >>> 0).toString(16).padStart(8, "0")}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
