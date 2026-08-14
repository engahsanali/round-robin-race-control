import { describe, expect, test } from "vitest";
import { bracket, state } from "./test-fixtures";

async function meetDomain(): Promise<any> {
  return import(`./${"index"}`).catch(() => null);
}


describe("MeetStateV1 schema", () => {
  test("supports fifteen independent brackets and allows repeated numbers only across brackets", async () => {
    const domain = await meetDomain();
    expect(domain).not.toBeNull();
    if (!domain) return;
    const brackets = Array.from({ length: 15 }, (_, index) => bracket(`q${index + 1}`, "qualifier", [{ id: `car-${index + 1}`, number: 7 }]));
    expect(domain.validateMeetState(state(brackets)).success).toBe(true);
  });

  test("rejects duplicate active car numbers inside one bracket", async () => {
    const domain = await meetDomain();
    expect(domain).not.toBeNull();
    if (!domain) return;
    const result = domain.validateMeetState(state([bracket("q1", "qualifier", [{ id: "a", number: 7 }, { id: "b", number: 7 }])]));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue: { code: string }) => issue.code === "duplicate_active_car_number")).toBe(true);
  });

  test("rejects cyclic and backwards advancement graphs", async () => {
    const domain = await meetDomain();
    expect(domain).not.toBeNull();
    if (!domain) return;
    const result = domain.validateMeetState({ ...state([bracket("q", "qualifier"), bracket("f", "final")]), advancementRules: [
      { id: "q-f", version: 1, sourceBracketId: "q", destinationBracketIds: ["f"], topN: 1, destinationCapacity: 9, destinationOrder: ["f"], status: "active" },
      { id: "f-q", version: 1, sourceBracketId: "f", destinationBracketIds: ["q"], topN: 1, destinationCapacity: 9, destinationOrder: ["q"], status: "active" }
    ] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue: { code: string }) => issue.code === "advancement_cycle" || issue.code === "invalid_stage_order")).toBe(true);
  });

  test("bounds bracket collections and import shape", async () => {
    const domain = await meetDomain();
    expect(domain).not.toBeNull();
    if (!domain) return;
    expect(domain.validateMeetState(state(Array.from({ length: 101 }, (_, index) => bracket(`q${index}`, "qualifier")))).success).toBe(false);
    const dangerous = JSON.stringify(state()).replace("{", '{"__proto__":{},');
    expect(domain.parseMeetJson(dangerous).ok).toBe(false);
  });
});
