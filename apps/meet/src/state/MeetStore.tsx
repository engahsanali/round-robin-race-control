import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { MeetStateV1 } from "@rr3/meet-domain";
import type { CommandReceipt, ConnectionStatus, OrganisationRole } from "../data/meetRepository";

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
  connectionStatus: ConnectionStatus;
  saveStatus: SaveStatus;
  lastSyncedAt: string | null;
  pendingRequestIds: readonly string[];
  advisory: string | null;
  error: string | null;
  formDirty: boolean;
  remoteUpdatePending: boolean;
};

export type MeetStoreAction =
  | { type: "workspace.selected"; workspace: WorkspaceMode }
  | { type: "organisation.selected"; organisationId: string | null; role: OrganisationRole | null }
  | { type: "meet.selected"; meetId: string | null }
  | { type: "snapshot.loaded"; snapshot: MeetStateV1; syncedAt: string }
  | { type: "realtime.snapshot"; snapshot: MeetStateV1; syncedAt: string }
  | { type: "connection.changed"; status: ConnectionStatus }
  | { type: "form.dirty"; dirty: boolean }
  | { type: "remote-update.dismissed" }
  | { type: "command.started"; requestId: string }
  | { type: "command.succeeded"; requestId: string; advisory: string | null }
  | { type: "command.failed"; requestId: string; message: string }
  | { type: "session.cleared" };

export function createInitialMeetStoreState(): MeetStoreState {
  return {
    workspace: "official", selectedOrganisationId: null, selectedMeetId: null, role: null,
    snapshot: null, connectionStatus: "offline", saveStatus: "idle", lastSyncedAt: null,
    pendingRequestIds: [], advisory: null, error: null, formDirty: false, remoteUpdatePending: false,
  };
}

export function meetStoreReducer(state: MeetStoreState, action: MeetStoreAction): MeetStoreState {
  switch (action.type) {
    case "workspace.selected":
      return { ...createInitialMeetStoreState(), workspace: action.workspace };
    case "organisation.selected":
      return { ...state, selectedOrganisationId: action.organisationId, role: action.role, selectedMeetId: null, snapshot: null, remoteUpdatePending: false };
    case "meet.selected":
      return { ...state, selectedMeetId: action.meetId, snapshot: null, remoteUpdatePending: false };
    case "snapshot.loaded":
      return { ...state, snapshot: action.snapshot, lastSyncedAt: action.syncedAt, remoteUpdatePending: false, error: null };
    case "realtime.snapshot":
      if (state.formDirty) return { ...state, remoteUpdatePending: true, lastSyncedAt: action.syncedAt };
      return { ...state, snapshot: action.snapshot, lastSyncedAt: action.syncedAt, remoteUpdatePending: false, error: null };
    case "connection.changed":
      return { ...state, connectionStatus: action.status };
    case "form.dirty":
      return { ...state, formDirty: action.dirty };
    case "remote-update.dismissed":
      return { ...state, remoteUpdatePending: false };
    case "command.started":
      if (state.pendingRequestIds.includes(action.requestId)) return state;
      return { ...state, pendingRequestIds: [...state.pendingRequestIds, action.requestId], saveStatus: "saving", advisory: null, error: null };
    case "command.succeeded":
      return { ...state, pendingRequestIds: state.pendingRequestIds.filter((id) => id !== action.requestId), saveStatus: "saved", advisory: action.advisory, error: null };
    case "command.failed":
      return { ...state, pendingRequestIds: state.pendingRequestIds.filter((id) => id !== action.requestId), saveStatus: "error", error: action.message };
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

export async function dispatchStoreCommand<T>(
  state: MeetStoreState,
  dispatch: Dispatch<MeetStoreAction>,
  requestId: string,
  command: () => Promise<CommandReceipt<T>>,
): Promise<CommandReceipt<T> | { ok: false; kind: "duplicate"; requestId: string; statePreserved: true; message: string }> {
  if (state.pendingRequestIds.includes(requestId)) return { ok: false, kind: "duplicate", requestId, statePreserved: true, message: "This command is already pending." };
  dispatch({ type: "command.started", requestId });
  const receipt = await command();
  if (receipt.ok) dispatch({ type: "command.succeeded", requestId, advisory: receipt.advisory?.message ?? null });
  else dispatch({ type: "command.failed", requestId, message: receipt.message });
  return receipt;
}

type MeetStoreContextValue = {
  state: MeetStoreState;
  dispatch: Dispatch<MeetStoreAction>;
  capabilities: RoleCapabilities;
};

const MeetStoreContext = createContext<MeetStoreContextValue | null>(null);

export function MeetStoreProvider({ children, initialState }: { children: ReactNode; initialState?: MeetStoreState }) {
  const [state, dispatch] = useReducer(meetStoreReducer, initialState ?? createInitialMeetStoreState());
  const capabilities = useMemo(() => roleCapabilities(state.role), [state.role]);
  const value = useMemo(() => ({ state, dispatch, capabilities }), [state, capabilities]);
  return <MeetStoreContext.Provider value={value}>{children}</MeetStoreContext.Provider>;
}

export function useMeetStore(): MeetStoreContextValue {
  const value = useContext(MeetStoreContext);
  if (!value) throw new Error("useMeetStore must be used inside MeetStoreProvider");
  return value;
}
