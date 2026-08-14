import { describe, expect, it } from "vitest";
import { makeMeet } from "../../test/workbookFixtures";
import {
  buildScheduleCandidate,
  parseRegistrationPaste,
  registrationRows,
  selectBracketView,
} from "./workbookModel";

describe("Meet workbook model", () => {
  it("keeps car numbers bracket-scoped and rejects a duplicate inside one bracket", () => {
    const meet = makeMeet(2, 3);
    meet.brackets[1]!.event.entries[0]!.carNumber = meet.brackets[0]!.event.entries[0]!.carNumber;
    expect(registrationRows(meet.brackets[0]!)).toHaveLength(3);
    expect(registrationRows(meet.brackets[1]!)).toHaveLength(3);
    const parsed = parseRegistrationPaste("7\tCesar\tComet\n7\tAhsan\tNova");
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0]).toMatch(/duplicate car number/i);
  });

  it("parses a complete bulk paste atomically and reports row-specific errors", () => {
    const valid = parseRegistrationPaste("7\tCesar\tComet\n8\tAhsan\tNova");
    expect(valid.ok).toBe(true);
    expect(valid.rows).toHaveLength(2);
    const invalid = parseRegistrationPaste("nope\t\tComet\n8\tAhsan");
    expect(invalid.ok).toBe(false);
    expect(invalid.rows).toHaveLength(0);
    expect(invalid.errors).toEqual(expect.arrayContaining([expect.stringMatching(/row 1/i), expect.stringMatching(/row 2/i)]));
  });

  it("uses exact presets only for matching 9/12/15 counts and real custom quality otherwise", () => {
    const nine = makeMeet(1, 9).brackets[0]!;
    const preset = buildScheduleCandidate(nine, { seed: "ignored", rounds: 4 });
    expect(preset.source).toBe("Template 9 preset");
    expect(preset.heats).toHaveLength(12);
    expect(preset.quality.opponentRepeatExcess).toBe(0);

    const custom = buildScheduleCandidate(makeMeet(1, 8).brackets[0]!, { seed: "proof-seed", rounds: 4 });
    expect(custom.source).toBe("Deterministic custom optimiser");
    expect(custom.seed).toBe("proof-seed");
    expect(custom.quality.opponentRepeatExcess).toBeGreaterThanOrEqual(custom.quality.lowerBound);
    expect(custom.quality.maxPairFrequency).toBeGreaterThan(0);
  });

  it("does not assign a competitive rank before an official result", () => {
    const view = selectBracketView(makeMeet(1, 3).brackets[0]!);
    expect(view.standings.every((row) => row.rank === null)).toBe(true);
    expect(view.currentHeat).toBeNull();
    expect(view.winner).toBeNull();
  });
});
