import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SaveStatus } from "./SaveStatus";

describe("SaveStatus", () => {
  it("announces combined connection, pending save, conflict, queued and advisory state", () => {
    render(<SaveStatus connection="reconnecting" save="saving" pendingCount={2} dirtyCount={3} queued conflict="Another official changed this record." advisory="Committed; refresh needed" lastSyncedAt="2026-08-14T10:00:00Z" />);
    const status = screen.getByRole("status", { name: /workspace status/i });
    expect(status.textContent).toContain("Reconnecting");
    expect(status.textContent).toContain("Saving 2 changes");
    expect(status.textContent).toContain("3 unsaved forms");
    expect(status.textContent).toContain("Remote update queued");
    expect(status.textContent).toContain("Another official changed");
    expect(status.textContent).toContain("Committed; refresh needed");
  });
});
