import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type MeetUser = { id: string; email?: string };
export type MeetSession = { user: MeetUser };
export type AuthEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "PASSWORD_RECOVERY" | "TOKEN_REFRESHED" | "USER_UPDATED";

export interface AuthPort {
  getSession(): Promise<{ session: MeetSession | null }>;
  onAuthStateChange(callback: (event: AuthEvent, session: MeetSession | null) => void): () => void;
  exchangeCodeForSession(code: string): Promise<{ session: MeetSession | null }>;
  signUp(email: string, password: string, displayName: string, redirectTo: string): Promise<{ session: MeetSession | null; confirmationPending: boolean }>;
  signIn(email: string, password: string): Promise<{ session: MeetSession | null }>;
  signOut(): Promise<void>;
  requestPasswordRecovery(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
}

export type MeetEnvironment = { url: string; publishableKey: string };
export type EnvironmentResult = { ok: true; value: MeetEnvironment } | { ok: false; message: string };

const forbiddenEnvironmentNames = [
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
] as const;

export function validateMeetEnvironment(environment: Record<string, unknown>): EnvironmentResult {
  if (forbiddenEnvironmentNames.some((name) => typeof environment[name] === "string" && environment[name] !== "")) {
    return { ok: false, message: "Meet Edition requires a browser-safe Supabase publishable key." };
  }
  const url = environment.VITE_SUPABASE_URL;
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== "string" || typeof publishableKey !== "string" || !publishableKey.startsWith("sb_publishable_")) {
    return { ok: false, message: "Meet Edition requires a Supabase URL and publishable key." };
  }
  try {
    const parsed = new URL(url);
    const exactLocalHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !exactLocalHttp) throw new Error("unsafe protocol");
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("unsafe URL");
    return { ok: true, value: { url: parsed.origin, publishableKey } };
  } catch {
    return { ok: false, message: "The configured Supabase URL is invalid." };
  }
}

export type CallbackResult =
  | { kind: "none" }
  | { kind: "ignored" }
  | { kind: "exchanged"; session: MeetSession | null }
  | { kind: "expired"; message: string };

export async function processAuthCallback(
  href: string,
  allowedOrigin: string,
  replaceHistory: (rootRelativeUrl: string) => void,
  auth: AuthPort,
): Promise<CallbackResult> {
  let callback: URL;
  try {
    callback = new URL(href);
  } catch {
    return { kind: "ignored" };
  }
  if (callback.origin !== allowedOrigin) return { kind: "ignored" };
  const hasSensitiveMaterial = callback.searchParams.has("code") || callback.searchParams.has("error") || callback.searchParams.has("error_code") || callback.hash.length > 0;
  if (!hasSensitiveMaterial) return { kind: "none" };
  const cleanPath = callback.pathname || "/";
  replaceHistory(cleanPath);
  const code = callback.searchParams.get("code");
  if (callback.pathname !== "/" || !code) {
    const errorCode = callback.searchParams.get("error_code");
    return errorCode ? { kind: "expired", message: "This authentication link is invalid or expired." } : { kind: "ignored" };
  }
  try {
    const exchanged = await auth.exchangeCodeForSession(code);
    return { kind: "exchanged", session: exchanged.session };
  } catch {
    return { kind: "expired", message: "This authentication link is invalid or expired." };
  }
}

type AuthOperation =
  | { kind: "confirmation-pending" }
  | { kind: "authenticated"; session: MeetSession }
  | { kind: "recovery-sent" }
  | { kind: "password-updated" };

export function createAuthController(auth: AuthPort, rootUrl: () => string) {
  return {
    async signUp(email: string, password: string, displayName: string): Promise<AuthOperation> {
      const result = await auth.signUp(email.trim(), password, displayName.trim(), rootUrl());
      if (result.session) return { kind: "authenticated", session: result.session };
      return { kind: "confirmation-pending" };
    },
    async signIn(email: string, password: string): Promise<AuthOperation> {
      const result = await auth.signIn(email.trim(), password);
      if (!result.session) throw new Error("Sign in did not create a session.");
      return { kind: "authenticated", session: result.session };
    },
    async requestRecovery(email: string): Promise<AuthOperation> {
      await auth.requestPasswordRecovery(email.trim(), rootUrl());
      return { kind: "recovery-sent" };
    },
    async updatePassword(password: string): Promise<AuthOperation> {
      await auth.updatePassword(password);
      return { kind: "password-updated" };
    },
    signOut: () => auth.signOut(),
  };
}

export type MeetSessionContextValue = {
  session: MeetSession | null;
  loading: boolean;
  recoveryMode: boolean;
  message: string | null;
  controller: ReturnType<typeof createAuthController>;
};

const MeetSessionContext = createContext<MeetSessionContextValue | null>(null);

export function AuthBoundary({ auth, children }: { auth: AuthPort; children: ReactNode }) {
  const [session, setSession] = useState<MeetSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const callbackStarted = useRef(false);
  const rootUrl = useMemo(() => () => `${window.location.origin}/`, []);
  const controller = useMemo(() => createAuthController(auth, rootUrl), [auth, rootUrl]);

  useEffect(() => {
    let active = true;
    const unsubscribe = auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      if (event === "SIGNED_OUT") setRecoveryMode(false);
    });
    const bootstrap = async () => {
      if (!callbackStarted.current) {
        callbackStarted.current = true;
        const callback = await processAuthCallback(
          window.location.href,
          window.location.origin,
          (url) => window.history.replaceState(null, "", url),
          auth,
        );
        if (!active) return;
        if (callback.kind === "expired") setMessage(callback.message);
        if (callback.kind === "exchanged") setSession(callback.session);
      }
      const current = await auth.getSession();
      if (!active) return;
      setSession(current.session);
      setLoading(false);
    };
    void bootstrap().catch(() => {
      if (!active) return;
      setMessage("Authentication is temporarily unavailable.");
      setLoading(false);
    });
    return () => { active = false; unsubscribe(); };
  }, [auth]);

  const value = useMemo(() => ({ session, loading, recoveryMode, message, controller }), [session, loading, recoveryMode, message, controller]);
  return <MeetSessionContext.Provider value={value}>{children}</MeetSessionContext.Provider>;
}

export function useMeetSession(): MeetSessionContextValue {
  const value = useContext(MeetSessionContext);
  if (!value) throw new Error("useMeetSession must be used inside AuthBoundary");
  return value;
}
