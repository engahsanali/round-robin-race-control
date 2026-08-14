import { useEffect, useState, type FormEvent } from "react";
import type { MeetSessionContextValue } from "../../app/AuthBoundary";

type AuthMode = "signin" | "signup" | "recovery" | "update-password";

export function AuthPanel({ authState }: { authState: MeetSessionContextValue }) {
  const [mode, setMode] = useState<AuthMode>(authState.recoveryMode ? "update-password" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<string | null>(authState.message);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authState.recoveryMode) setMode("update-password");
  }, [authState.recoveryMode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      if (mode === "signup") {
        const result = await authState.controller.signUp(email, password, displayName);
        setStatus(result.kind === "confirmation-pending" ? "Check your email to verify the account, then return here to sign in." : "Signed in securely.");
      } else if (mode === "signin") {
        await authState.controller.signIn(email, password);
        setStatus("Signed in securely.");
      } else if (mode === "recovery") {
        await authState.controller.requestRecovery(email);
        setStatus("If the account exists, a recovery email has been sent.");
      } else {
        await authState.controller.updatePassword(password);
        setStatus("Password updated. You can continue to the official workspace.");
        setMode("signin");
      }
    } catch {
      setStatus("The account operation could not be completed. Check the details or request a fresh recovery link.");
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "signup" ? "Create your Meet account" : mode === "recovery" ? "Recover your account" : mode === "update-password" ? "Choose a new password" : "Sign in to Meet Edition";
  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <p className="eyebrow">Secure hosted race control</p>
      <h2 id="auth-title">{title}</h2>
      <form onSubmit={(event) => void submit(event)}>
        {mode === "signup" ? <label><span>Display name</span><input autoComplete="name" required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label> : null}
        {mode !== "update-password" ? <label><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label> : null}
        {mode !== "recovery" ? <label><span>Password</span><input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label> : null}
        <button type="submit" disabled={busy}>{busy ? "Working…" : title}</button>
      </form>
      <div className="auth-links">
        {mode !== "signin" ? <button type="button" className="text-button" onClick={() => setMode("signin")}>Back to sign in</button> : null}
        {mode === "signin" ? <><button type="button" className="text-button" onClick={() => setMode("signup")}>Create account</button><button type="button" className="text-button" onClick={() => setMode("recovery")}>Forgot password?</button></> : null}
      </div>
      {status ? <p role="status" className="auth-status">{status}</p> : null}
    </section>
  );
}
