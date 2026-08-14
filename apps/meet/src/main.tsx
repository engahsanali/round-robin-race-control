import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MeetApp } from "./app/MeetApp";
import { createMeetClients } from "./data/supabase";
import "./styles/global.css";

const clients = createMeetClients(import.meta.env as Record<string, unknown>);
const root = document.getElementById("root");
if (!root) throw new Error("Meet application root is missing");

createRoot(root).render(
  <StrictMode>
    <MeetApp productionRepository={clients.ok ? clients.repository : null} auth={clients.ok ? clients.auth : null} />
  </StrictMode>,
);
