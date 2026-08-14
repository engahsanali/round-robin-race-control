import { describe, expect, it, vi } from "vitest";
import {
  createAuthController,
  processAuthCallback,
  validateMeetEnvironment,
  type AuthPort,
} from "./AuthBoundary";

function fakeAuth(): AuthPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getSession: async () => ({ session: null }),
    onAuthStateChange: () => () => calls.push("unsubscribe"),
    exchangeCodeForSession: async (code) => { calls.push(`exchange:${code}`); return { session: { user: { id: "u1", email: "operator@example.com" } } }; },
    signUp: async () => ({ session: null, confirmationPending: true }),
    signIn: async () => ({ session: { user: { id: "u1", email: "operator@example.com" } } }),
    signOut: async () => { calls.push("signout"); },
    requestPasswordRecovery: async () => { calls.push("recovery"); },
    updatePassword: async () => { calls.push("password"); },
  };
}

describe("Meet authentication boundary", () => {
  it("accepts only the public URL and publishable key", () => {
    expect(validateMeetEnvironment({ VITE_SUPABASE_URL: "https://demo.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" })).toEqual({
      ok: true,
      value: { url: "https://demo.supabase.co", publishableKey: "sb_publishable_example" },
    });
    expect(validateMeetEnvironment({ VITE_SUPABASE_URL: "https://demo.supabase.co", VITE_SUPABASE_ANON_KEY: "legacy" })).toEqual({ ok: false, message: expect.stringMatching(/publishable/i) });
    expect(validateMeetEnvironment({ VITE_SUPABASE_URL: "https://demo.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "not-a-publishable-key" })).toEqual({ ok: false, message: expect.stringMatching(/publishable/i) });
    expect(validateMeetEnvironment({ VITE_SUPABASE_URL: "ftp://localhost:54321", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" }).ok).toBe(false);
    expect(validateMeetEnvironment({ VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" }).ok).toBe(true);
  });

  it("scrubs a root PKCE code before exactly one exchange", async () => {
    const auth = fakeAuth();
    const replaced: string[] = [];
    const result = await processAuthCallback(
      "https://meet.example/?code=one-time-code",
      "https://meet.example",
      (url) => replaced.push(url),
      auth,
    );
    expect(replaced).toEqual(["/"]);
    expect(auth.calls).toEqual(["exchange:one-time-code"]);
    expect(result.kind).toBe("exchanged");
  });

  it("scrubs but never exchanges callback material away from the root", async () => {
    const auth = fakeAuth();
    const replaced: string[] = [];
    const result = await processAuthCallback("https://meet.example/unsafe?code=secret", "https://meet.example", (url) => replaced.push(url), auth);
    expect(replaced).toEqual(["/unsafe"]);
    expect(auth.calls).toEqual([]);
    expect(result.kind).toBe("ignored");
  });

  it("scrubs root callback errors and reports expired links without exchanging", async () => {
    const auth = fakeAuth();
    const replaced: string[] = [];
    const result = await processAuthCallback("https://meet.example/?error=access_denied&error_code=otp_expired", "https://meet.example", (url) => replaced.push(url), auth);
    expect(replaced).toEqual(["/"]);
    expect(result).toEqual({ kind: "expired", message: expect.stringMatching(/expired/i) });
    expect(auth.calls).toEqual([]);
  });

  it("exposes signup, verification, login, logout and recovery lifecycles without logging secrets", async () => {
    const auth = fakeAuth();
    const logger = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const controller = createAuthController(auth, () => "https://meet.example/");
    expect((await controller.signUp("new@example.com", "Password!23", "New User")).kind).toBe("confirmation-pending");
    expect((await controller.signIn("operator@example.com", "Password!23")).kind).toBe("authenticated");
    expect((await controller.requestRecovery("operator@example.com")).kind).toBe("recovery-sent");
    expect((await controller.updatePassword("Replacement!23")).kind).toBe("password-updated");
    await controller.signOut();
    expect(auth.calls).toEqual(["recovery", "password", "signout"]);
    expect(logger).not.toHaveBeenCalled();
    logger.mockRestore();
  });
});
