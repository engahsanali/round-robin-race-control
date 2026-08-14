import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeamDrawer, type TeamActions } from "./TeamDrawer";

const members = [
  { userId: "u-owner", role: "owner" as const, displayName: "Owner One", email: "owner@example.com" },
  { userId: "u-viewer", role: "viewer" as const, displayName: "Viewer Two", email: null },
];

function actions(): TeamActions {
  return { createInvitation: vi.fn(), revokeInvitation: vi.fn(), removeMember: vi.fn() };
}

describe("TeamDrawer", () => {
  it("shows management controls only to owner/admin and filters locally", async () => {
    const teamActions = actions();
    const { rerender } = render(<TeamDrawer role="owner" members={members} actions={teamActions} />);
    expect(screen.getByRole("button", { name: /create invitation/i })).not.toBeNull();
    await userEvent.type(screen.getByRole("searchbox"), "viewer");
    expect(screen.queryByText("Owner One")).toBeNull();
    expect(screen.getByText("Viewer Two")).not.toBeNull();
    rerender(<TeamDrawer role="organiser" members={members} actions={teamActions} />);
    expect(screen.queryByRole("button", { name: /create invitation/i })).toBeNull();
    expect(screen.getByText(/organiser/i)).not.toBeNull();
  });

  it("requires a reason and explicit confirmation before removal", async () => {
    const teamActions = actions();
    render(<TeamDrawer role="owner" members={members} actions={teamActions} />);
    await userEvent.click(screen.getByRole("button", { name: /remove viewer two/i }));
    expect(screen.getByRole("button", { name: /confirm removal/i }).hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText(/reason/i), "No longer on the officiating team");
    await userEvent.click(screen.getByRole("button", { name: /confirm removal/i }));
    expect(teamActions.removeMember).toHaveBeenCalledWith("u-viewer", "No longer on the officiating team");
  });
});
