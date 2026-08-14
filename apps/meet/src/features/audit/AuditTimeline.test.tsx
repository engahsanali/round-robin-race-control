import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AuditTimeline } from "./AuditTimeline";

describe("AuditTimeline", () => {
  it("searches actor, action, reason and safe before/after values", async () => {
    render(<AuditTimeline events={[
      { id: "audit-1", timestamp: "2026-08-14T10:00:00Z", actorId: "marshal-1", action: "heat.winner_corrected", entityType: "heat", entityId: "heat-1", reason: "Camera review", before: { winner: "<b>car-1</b>" }, after: { winner: "car-2" } },
      { id: "audit-2", timestamp: "2026-08-14T09:00:00Z", actorId: "organiser-2", action: "meet.saved", entityType: "meet", entityId: "meet-1", reason: null, before: {}, after: { name: "Friday" } },
    ]} />);
    expect(screen.getByRole("feed", { name: /audit timeline/i }).children).toHaveLength(2);
    await userEvent.type(screen.getByRole("searchbox", { name: /search audit/i }), "camera");
    expect(screen.getByRole("feed", { name: /audit timeline/i }).children).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /show change details/i }));
    expect(screen.getByText(/<b>car-1<\/b>/).tagName).toBe("PRE");
    expect(document.querySelector("b")).toBeNull();
  });
});
