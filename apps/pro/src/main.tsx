import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { createProDatabase } from "./persistence/db";
import { EventRepository } from "./persistence/repository";
import { EventProvider } from "./state/EventProvider";
import "./styles/tokens.css";
import "./styles/global.css";

const root = document.getElementById("root");
const repository = new EventRepository(createProDatabase());

if (!root) {
  throw new Error("Application root is unavailable.");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <EventProvider repository={repository}>
        <App />
      </EventProvider>
    </BrowserRouter>
  </StrictMode>,
);
