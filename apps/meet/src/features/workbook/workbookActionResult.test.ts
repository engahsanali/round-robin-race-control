import { describe, expect, it, vi } from "vitest";
import { finishCommittedWorkbookAction } from "./workbookActionResult";

describe("committed workbook action results", () => {
  it("keeps committed success while warning that a failed reload left a stale view", async () => {
    const result = await finishCommittedWorkbookAction(
      { ok: true, message: "Saved", advisory: null },
      vi.fn(async () => false),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/committed/i);
    expect(result.message).toMatch(/refresh|latest view|stale/i);
  });
});
