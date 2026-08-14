import type { ConnectionStatus } from "../../data/meetRepository";
import type { SaveStatus as SaveState } from "../../state/MeetStore";

export function SaveStatus({ connection, save, pendingCount, dirtyCount, queued, conflict, advisory, lastSyncedAt }: { connection: ConnectionStatus; save: SaveState; pendingCount: number; dirtyCount: number; queued: boolean; conflict: string | null; advisory: string | null; lastSyncedAt: string | null }) {
  const connectionLabel = connection === "connected" ? "Connected" : connection === "reconnecting" ? "Reconnecting" : connection === "connecting" ? "Connecting" : connection === "offline" ? "Offline" : "Connection error";
  const saveLabel = save === "saving" ? `Saving ${pendingCount} change${pendingCount === 1 ? "" : "s"}` : save === "saved" ? "Saved" : save === "error" ? "Save error" : "No pending save";
  return <div role="status" aria-label="Workspace status" aria-live="polite" className="save-status"><span>{connectionLabel}</span><span>{saveLabel}</span>{dirtyCount ? <span>{dirtyCount} unsaved form{dirtyCount === 1 ? "" : "s"}</span> : null}{queued ? <strong>Remote update queued</strong> : null}{conflict ? <strong>{conflict}</strong> : null}{advisory ? <span>{advisory}</span> : null}{lastSyncedAt ? <time dateTime={lastSyncedAt}>Synced {new Date(lastSyncedAt).toLocaleTimeString()}</time> : null}</div>;
}
