import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthPanel } from "./AuthPanel";
import type { MeetSessionContextValue } from "../../app/AuthBoundary";

function authState(recoveryMode: boolean): MeetSessionContextValue {
  return {
    session: recoveryMode ? { user: { id: "user-1", email: "marshal@example.com" } } : null,
    loading: false,
    recoveryMode,
    message: null,
    controller: {
      signUp: vi.fn(), signIn: vi.fn(), requestRecovery: vi.fn(), signOut: vi.fn(),
      updatePassword: vi.fn(async () => ({ kind: "password-updated" as const })),
    },
  };
}

describe("AuthPanel recovery state", () => {
  it("reacts to PASSWORD_RECOVERY after mount and completes the update-password flow", async () => {
    const initial = authState(false);
    const recovering = authState(true);
    const { rerender } = render(<AuthPanel authState={initial} />);
    expect(screen.getByRole("heading", { name: /sign in/i })).not.toBeNull();
    rerender(<AuthPanel authState={recovering} />);
    expect(screen.getByRole("heading", { name: /choose a new password/i })).not.toBeNull();
    await userEvent.type(screen.getByLabelText(/^password$/i), "Replacement!23");
    await userEvent.click(screen.getByRole("button", { name: /choose a new password/i }));
    await waitFor(() => expect(recovering.controller.updatePassword).toHaveBeenCalledWith("Replacement!23"));
    expect(screen.getByRole("status").textContent).toMatch(/password updated/i);
  });
});
