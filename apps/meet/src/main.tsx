import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MeetBootstrap, type OfficialRuntime } from "./features/demo/MeetBootstrap";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Meet application root is missing");

async function loadOfficialRuntime(): Promise<OfficialRuntime> {
  const [{ createMeetClients }, { MeetBackupRepository }] = await Promise.all([
    import("./data/supabase"),
    import("./data/meetBackupRepository"),
  ]);
  const clients = createMeetClients(import.meta.env as Record<string, unknown>);
  if (!clients.ok) return clients;
  return { ok: true, repository: clients.repository, auth: clients.auth, backupRepository: new MeetBackupRepository(clients.data) };
}

createRoot(root).render(
  <StrictMode>
    <MeetBootstrap search={window.location.search} loadOfficialRuntime={loadOfficialRuntime} />
  </StrictMode>,
);
