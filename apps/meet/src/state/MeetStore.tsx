import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { MeetStateV1 } from "@rr3/meet-domain";
import type { CommandReceipt, ConnectionStatus, HostedMeetBundle, OrganisationRole, RepositoryFailureKind } from "../data/meetRepository";

export type WorkspaceMode = "official" | "demo";
export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type RoleCapabilities = {
  manageTeam: boolean;
  configureMeet: boolean;
  recordResults: boolean;
  confirmAdvancement: boolean;
  read: boolean;
  export: boolean;
};

export type MeetStoreState = {
  workspace: WorkspaceMode;
  selectedOrganisationId: string | null;
  selectedMeetId: string | null;
  role: OrganisationRole | null;
  snapshot: MeetStateV1 | null;
  bundle: HostedMeetBundle | null;
  connectionStatus: ConnectionStatus;
  saveStatus: SaveStatus;
  lastSyncedAt: string | null;
  pendingRequestIds: readonly string[];
  advisory: string | null;
  error: string | null;
  formDirty: boolean;
  queuedRemoteBundle: HostedMeetBundle | null;
  conflict: { kind: "dirty-realtime" | "optimistic"; message: string } | null;
};

export type MeetStoreAction =
  | { type: "workspace.selected"; workspace: WorkspaceMode }
  | { type: "organisation.selected"; organisationId: string | null; role: OrganisationRole | null }
  | { type: "meet.selected"; meetId: string | null }
  | { type: "snapshot.loaded"; snapshot: MeetStateV1; syncedAt: string }
  | { type: "realtime.snapshot"; snapshot: MeetStateV1; syncedAt: string }
  | { type: "bundle.loaded"; bundle: HostedMeetBundle; syncedAt: string }
  | { type: "realtime.bundle"; bundle: HostedMeetBundle; syncedAt: string }
  | { type: "connection.changed"; status: ConnectionStatus }
  | { type: "form.dirty"; dirty: boolean }
  | { type: "remote-update.applied" }
  | { type: "command.started"; requestId: string }
  | { type: "command.succeeded"; requestId: string; advisory: string | null }
  | { type: "command.failed"; requestId: string; message: string; kind?: RepositoryFailureKind }
  | { type: "session.cleared" };

export function createInitialMeetStoreState(options: {
  workspace?: WorkspaceMode;
  organisationId?: string | null;
  role?: OrganisationRole | null;
} = {}): MeetStoreState {
  return {
    workspace: options.workspace ?? "official", selectedOrganisationId: options.organisationId ?? null, selectedMeetId: null, role: options.role ?? null,
    snapshot: null, bundle: null, connectionStatus: "offline", saveStatus: "idle", lastSyncedAt: null,
    pendingRequestIds: [], advisory: null, error: null, formDirty: false, queuedRemoteBundle: null, conflict: null,
  };
}

export function meetStoreReducer(state: MeetStoreState, action: MeetStoreAction): MeetStoreState {
  switch (action.type) {
    case "workspace.selected":
      return { ...createInitialMeetStoreState(), workspace: action.workspace };
    case "organisation.selected":
      return { ...state, selectedOrganisationId: action.organisationId, role: action.role, selectedMeetId: null, snapshot: null, bundle: null, queuedRemoteBundle: null, conflict: null };
    case "meet.selected":
      return { ...state, selectedMeetId: action.meetId, snapshot: null, bundle: null, queuedRemoteBundle: null, conflict: null };
    case "snapshot.loaded":
      return { ...state, snapshot: action.snapshot, bundle: { state: action.snapshot, history: { snapshots: [], selections: [] }, heatVersions: {} }, lastSyncedAt: action.syncedAt, queuedRemoteBundle: null, conflict: null, error: null };
    case "realtime.snapshot":
      if (state.formDirty) return { ...state, queuedRemoteBundle: { state: action.snapshot, history: { snapshots: [], selections: [] }, heatVersions: {} }, conflict: { kind: "dirty-realtime", message: "A remote update is waiting while this form has unsaved changes." }, lastSyncedAt: action.syncedAt };
      return { ...state, snapshot: action.snapshot, bundle: { state: action.snapshot, history: { snapshots: [], selections: [] }, heatVersions: {} }, lastSyncedAt: action.syncedAt, queuedRemoteBundle: null, conflict: null, error: null };
    case "bundle.loaded":
      return { ...state, bundle: action.bundle, snapshot: action.bundle.state, lastSyncedAt: action.syncedAt, queuedRemoteBundle: null, conflict: null, error: null };
    case "realtime.bundle":
      if (state.formDirty) return { ...state, queuedRemoteBundle: action.bundle, conflict: { kind: "dirty-realtime", message: "A remote update is waiting while this form has unsaved changes." }, lastSyncedAt: action.syncedAt };
      return { ...state, bundle: action.bundle, snapshot: action.bundle.state, lastSyncedAt: action.syncedAt, queuedRemoteBundle: null, conflict: null, error: null };
    case "connection.changed":
      return { ...state, connectionStatus: action.status };
    case "form.dirty":
      return { ...state, formDirty: action.dirty };
    case "remote-update.applied":
      if (!state.queuedRemoteBundle) return state;
      return { ...state, bundle: state.queuedRemoteBundle, snapshot: state.queuedRemoteBundle.state, queuedRemoteBundle: null, conflict: null, formDirty: false, error: null };
    case "command.started":
      if (state.pendingRequestIds.includes(action.requestId)) return state;
      return { ...state, pendingRequestIds: [...state.pendingRequestIds, action.requestId], saveStatus: "saving", advisory: null, error: null };
    case "command.succeeded":
      return { ...state, pendingRequestIds: state.pendingRequestIds.filter((id) => id !== action.requestId), saveStatus: state.pendingRequestIds.some((id) => id !== action.requestId) ? "saving" : "saved", advisory: action.advisory, error: null };
    case "command.failed":
      return { ...state, pendingRequestIds: state.pendingRequestIds.filter((id) => id !== action.requestId), saveStatus: "error", error: action.message, conflict: action.kind === "conflict" ? { kind: "optimistic", message: action.message } : state.conflict };
    case "session.cleared":
      return createInitialMeetStoreState();
  }
}

export function roleCapabilities(role: OrganisationRole | null): RoleCapabilities {
  const admin = role === "owner" || role === "admin";
  const organiser = admin || role === "organiser";
  const marshal = organiser || role === "marshal";
  return { manageTeam: admin, configureMeet: organiser, recordResults: marshal, confirmAdvancement: organiser, read: role !== null, export: role !== null };
}

export type StoreCommandReceipt<T> = CommandReceipt<T> | { ok: false; kind: "duplicate"; requestId: string; statePreserved: true; message: string };
export type StoreCommandRunner = <T>(requestId: string, command: () => Promise<CommandReceipt<T>>) => Promise<StoreCommandReceipt<T>>;

export function createStoreCommandRunner(dispatch: Dispatch<MeetStoreAction>): StoreCommandRunner {
  const pending = new Set<string>();
  return async <T,>(requestId: string, command: () => Promise<CommandReceipt<T>>): Promise<StoreCommandReceipt<T>> => {
    if (pending.has(requestId)) return { ok: false, kind: "duplicate", requestId, statePreserved: true, message: "This command is already pending." };
    pending.add(requestId);
    dispatch({ type: "command.started", requestId });
    try {
      const receipt = await command();
      if (receipt.ok) dispatch({ type: "command.succeeded", requestId, advisory: receipt.advisory?.message ?? null });
      else dispatch({ type: "command.failed", requestId, message: receipt.message, kind: receipt.kind });
      return receipt;
    } catch {
      const receipt = { ok: false, kind: "network", requestId, statePreserved: true, message: "The hosted service is unreachable. Your current view was preserved." } as const;
      dispatch({ type: "command.failed", requestId, message: receipt.message, kind: receipt.kind });
      return receipt;
    } finally {
      pending.delete(requestId);
    }
  };
}

type MeetStoreContextValue = {
  state: MeetStoreState;
  dispatch: Dispatch<MeetStoreAction>;
  capabilities: RoleCapabilities;
  runCommand: StoreCommandRunner;
};

const MeetStoreContext = createContext<MeetStoreContextValue | null>(null);

export function MeetStoreProvider({ children, initialState }: { children: ReactNode; initialState?: MeetStoreState }) {
  const [state, dispatch] = useReducer(meetStoreReducer, initialState ?? createInitialMeetStoreState());
  const capabilities = useMemo(() => roleCapabilities(state.role), [state.role]);
  const runCommand = useMemo(() => createStoreCommandRunner(dispatch), [dispatch]);
  const value = useMemo(() => ({ state, dispatch, capabilities, runCommand }), [state, capabilities, runCommand]);
  return <MeetStoreContext.Provider value={value}>{children}</MeetStoreContext.Provider>;
}

export function useMeetStore(): MeetStoreContextValue {
  const value = useContext(MeetStoreContext);
  if (!value) throw new Error("useMeetStore must be used inside MeetStoreProvider");
  return value;
}
