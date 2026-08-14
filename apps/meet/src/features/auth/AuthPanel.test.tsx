import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthPanel } from "./AuthPanel";
import { AuthBoundary, useMeetSession, type AuthEvent, type AuthPort, type MeetSession, type MeetSessionContextValue } from "../../app/AuthBoundary";

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

  it("leaves recovery after a successful password update and USER_UPDATED event", async () => {
    const session: MeetSession = { user: { id: "user-1", email: "marshal@example.com" } };
    let notify: ((event: AuthEvent, session: MeetSession | null) => void) | undefined;
    const auth: AuthPort = {
      getSession: async () => ({ session }),
      onAuthStateChange: (callback) => { notify = callback; return () => undefined; },
      exchangeCodeForSession: async () => ({ session }),
      signUp: async () => ({ session: null, confirmationPending: true }),
      signIn: async () => ({ session }),
      signOut: async () => undefined,
      requestPasswordRecovery: async () => undefined,
      updatePassword: async () => { notify?.("USER_UPDATED", session); },
    };
    function RecoveryGate() {
      const state = useMeetSession();
      if (state.loading) return <p>Loading</p>;
      if (state.recoveryMode || !state.session) return <AuthPanel authState={state} />;
      return <h2>Organisation workspace</h2>;
    }
    render(<AuthBoundary auth={auth}><RecoveryGate /></AuthBoundary>);
    expect(await screen.findByRole("heading", { name: /organisation workspace/i })).not.toBeNull();
    act(() => notify?.("PASSWORD_RECOVERY", session));
    expect(screen.getByRole("heading", { name: /choose a new password/i })).not.toBeNull();
    await userEvent.type(screen.getByLabelText(/^password$/i), "Replacement!23");
    await userEvent.click(screen.getByRole("button", { name: /choose a new password/i }));
    expect(await screen.findByRole("heading", { name: /organisation workspace/i })).not.toBeNull();
  });
});
