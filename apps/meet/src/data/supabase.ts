import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateMeetEnvironment, type AuthEvent, type AuthPort, type MeetEnvironment, type MeetSession } from "../app/AuthBoundary";
import { MeetRepository, type ConnectionStatus, type DataPort, type PortError, type QueryRequest, type RealtimeRequest } from "./meetRepository";

type PublicClient = SupabaseClient<Record<string, unknown>>;

export type MeetClientResult =
  | { ok: false; message: string }
  | { ok: true; auth: AuthPort; data: DataPort; repository: MeetRepository };

export function createMeetClients(environment: Record<string, unknown>): MeetClientResult {
  const parsed = validateMeetEnvironment(environment);
  if (!parsed.ok) return parsed;
  const client = createConfiguredSupabaseClient(parsed.value);
  const auth = new SupabaseAuthPort(client);
  const data = new SupabaseDataPort(client);
  return { ok: true, auth, data, repository: new MeetRepository(data) };
}

export function createConfiguredSupabaseClient(environment: MeetEnvironment): PublicClient {
  return createClient<Record<string, unknown>>(environment.url, environment.publishableKey, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "rr3-meet-auth",
    },
    global: { headers: { "X-Client-Info": "round-robin-race-control-meet" } },
  });
}

export class SupabaseAuthPort implements AuthPort {
  constructor(private readonly client: PublicClient) {}

  async getSession(): Promise<{ session: MeetSession | null }> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw new Error("Authentication session is unavailable.");
    return { session: toMeetSession(data.session) };
  }

  onAuthStateChange(callback: (event: AuthEvent, session: MeetSession | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      const mapped = mapAuthEvent(event);
      if (mapped) callback(mapped, toMeetSession(session));
    });
    return () => data.subscription.unsubscribe();
  }

  async exchangeCodeForSession(code: string): Promise<{ session: MeetSession | null }> {
    const { data, error } = await this.client.auth.exchangeCodeForSession(code);
    if (error) throw new Error("Authentication link is invalid or expired.");
    return { session: toMeetSession(data.session) };
  }

  async signUp(email: string, password: string, displayName: string, redirectTo: string) {
    const { data, error } = await this.client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, data: { display_name: displayName } } });
    if (error) throw new Error("Account creation failed.");
    return { session: toMeetSession(data.session), confirmationPending: data.session === null };
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error("Sign in failed.");
    return { session: toMeetSession(data.session) };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw new Error("Sign out failed.");
  }

  async requestPasswordRecovery(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error("Password recovery could not be requested.");
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw new Error("Password update failed.");
  }
}

export class SupabaseDataPort implements DataPort {
  constructor(private readonly client: PublicClient) {}

  async query<T>(request: QueryRequest): Promise<{ data: T[] | null; error: PortError | null }> {
    let query = this.client.from(request.table).select(request.columns ?? "*");
    for (const [column, value] of Object.entries(request.filters)) {
      query = Array.isArray(value) ? query.in(column, [...value]) : value === null ? query.is(column, null) : query.eq(column, value);
    }
    for (const ordering of request.order ?? []) query = query.order(ordering.column, { ascending: ordering.ascending ?? true });
    if (request.signal) query = query.abortSignal(request.signal);
    const { data, error } = await query;
    return { data: data as T[] | null, error: error ? { message: error.message, code: error.code } : null };
  }

  async rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: PortError | null }> {
    const callable = this.client as unknown as {
      rpc(functionName: string, functionArgs: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
    };
    const { data, error } = await callable.rpc(name, args);
    return { data: data as T | null, error: error ? { message: error.message, code: error.code } : null };
  }

  subscribe(request: RealtimeRequest, onInvalidate: () => void, onStatus?: (status: ConnectionStatus) => void): () => void {
    const channel = this.client.channel(request.channel);
    for (const target of request.targets) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: target.table, filter: target.filter }, onInvalidate);
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus?.("connected");
      else if (status === "CHANNEL_ERROR") onStatus?.("error");
      else if (status === "TIMED_OUT") onStatus?.("offline");
      else if (status === "CLOSED") onStatus?.("offline");
      else onStatus?.("connecting");
    });
    return () => { void this.client.removeChannel(channel); };
  }
}

function toMeetSession(session: { user: { id: string; email?: string } } | null): MeetSession | null {
  return session ? { user: { id: session.user.id, ...(session.user.email ? { email: session.user.email } : {}) } } : null;
}

function mapAuthEvent(event: string): AuthEvent | null {
  if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return event;
  return null;
}
