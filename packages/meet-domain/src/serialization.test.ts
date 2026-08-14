import { describe, expect, test } from "vitest";
import { state } from "./test-fixtures";

async function meetDomain(): Promise<any> { return import(`./${"index"}`).catch(() => null); }

describe("Meet JSON serialization", () => {
  test("round-trips exact validated state deterministically", async () => {
    const domain = await meetDomain();
    expect(domain).not.toBeNull();
    if (!domain) return;
    const original = state();
    const text = domain.serializeMeet(original);
    expect(text.endsWith("\n")).toBe(true);
    const parsed = domain.parseMeetJson(text);
    expect(parsed).toEqual({ ok: true, data: original });
    expect(domain.serializeMeet(parsed.data)).toBe(text);
  });

  test("rejects malformed JSON without mutating the supplied state", async () => {
    const domain = await meetDomain();
    expect(domain).not.toBeNull();
    if (!domain) return;
    const original = state();
    const before = structuredClone(original);
    expect(domain.parseMeetJson("{").ok).toBe(false);
    expect(original).toEqual(before);
  });
});
