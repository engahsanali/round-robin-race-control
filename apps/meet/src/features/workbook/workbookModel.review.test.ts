import { describe, expect, it } from "vitest";
import { makeMeet } from "../../test/workbookFixtures";
import { parseRegistrationPaste, validateSetupGraph } from "./workbookModel";

describe("workbook review regressions", () => {
  it("groups multiple cars under stable participant identity and rejects the whole invalid candidate", () => {
    const text = "7\tCesar\tComet\tcesar@example.com\n8\tCesar\tNova\tcesar@example.com";
    const first = parseRegistrationPaste(text);
    const second = parseRegistrationPaste(text);
    expect(first.ok).toBe(true);
    expect(first.rows[0]?.participantId).toBe(first.rows[1]?.participantId);
    expect(first.rows.map((row) => row.participantId)).toEqual(second.rows.map((row) => row.participantId));
    expect(first.rows.map((row) => row.carId)).toEqual(second.rows.map((row) => row.carId));
    expect(parseRegistrationPaste(`${text}\nnope\tBroken\tCar`).rows).toEqual([]);
  });

  it("rejects self, backward and cyclic progression before an RPC", () => {
    const meet = makeMeet(3, 3);
    meet.brackets[0]!.stage = "qualifier";
    meet.brackets[1]!.stage = "semifinal";
    meet.brackets[2]!.stage = "final";
    meet.advancementRules = [{ id: crypto.randomUUID(), sourceBracketId: meet.brackets[2]!.id, destinationBracketIds: [meet.brackets[0]!.id], destinationOrder: [meet.brackets[0]!.id], topN: 3, destinationCapacity: 6, status: "active" }];
    expect(validateSetupGraph(meet)).toEqual(expect.arrayContaining([expect.stringMatching(/forward/i)]));
    meet.advancementRules[0] = { ...meet.advancementRules[0]!, sourceBracketId: meet.brackets[0]!.id, destinationBracketIds: [meet.brackets[0]!.id], destinationOrder: [meet.brackets[0]!.id] };
    expect(validateSetupGraph(meet)).toEqual(expect.arrayContaining([expect.stringMatching(/itself/i)]));
  });
});
