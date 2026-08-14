import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminDashboard } from "./AdminDashboard";

const overview = { activeMeetCount: 4, runningMeetCount: 2, staleAdvancementCount: 1, unresolvedTieCount: 3, recentActivity: [{ id: "audit-1", meetId: "meet-1", action: "advancement.confirmed", actorId: "owner-1", occurredAt: "2026-08-14T10:00:00Z" }] };
const security = [{ id: "security-1", organisationId: "org-1", actorId: "owner-1", subjectUserId: "viewer-1", eventType: "membership.removed", occurredAt: "2026-08-14T09:00:00Z", metadata: { reason: "Left team" } }];

describe("AdminDashboard", () => {
  it("shows operational and security facts only to owner/admin roles", () => {
    const { rerender } = render(<AdminDashboard role="owner" overview={overview} securityEvents={security} />);
    expect(screen.getByText("4")).not.toBeNull();
    expect(screen.getByText(/membership.removed/i)).not.toBeNull();
    rerender(<AdminDashboard role="organiser" overview={overview} securityEvents={security} />);
    expect(screen.queryByText(/membership.removed/i)).toBeNull();
    expect(screen.queryByRole("heading", { name: /admin dashboard/i })).toBeNull();
  });
});
