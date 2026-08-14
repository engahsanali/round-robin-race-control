import { useMemo } from "react";
import type { WorkbookActions } from "../workbook/WorkbookWorkspace";
import { WorkbookWorkspace } from "../workbook/WorkbookWorkspace";
import { MeetProviders } from "../../app/MeetProviders";
import { createDemoMeetBundle } from "./demoMeet";

const CREATOR_CREDIT = "Made by Cesar Lacsamana and Ahsan Ali";

export function DemoWorkspace({ onExit }: { onExit(): void }) {
  const bundle = useMemo(createDemoMeetBundle, []);
  return <div className="meet-app demo-mode">
    <a href="#main-content" className="skip-link">Skip to Meet workspace</a>
    <header className="brand-header"><span className="product-mark" aria-hidden="true">RR · 3</span><div><p className="edition-label">Demo workspace · read-only</p><h1>Round Robin Race Control</h1></div><span className="hosted-pill">Local · no account calls</span></header>
    <main id="main-content" className="demo-workspace"><p className="demo-scenario-note" role="note"><strong>Tie decision scenario:</strong> Qualifier 1 has four cars level at the three-car cutoff; officials would resolve it before advancement.</p><MeetProviders workspace="demo" selected={{ id: "demo", name: "Demo organisation", slug: "demo", role: "viewer", version: 1 }}><WorkbookWorkspace meet={bundle.state} heatVersions={bundle.heatVersions} advancementHistory={bundle.history} reportBundle={bundle} role="viewer" readOnly actions={readOnlyActions()} onSignOut={onExit} /></MeetProviders></main>
    <footer><p>{CREATOR_CREDIT}</p><p>Operational tracking only · no advertising trackers.</p></footer>
  </div>;
}

function readOnlyActions(): WorkbookActions {
  const denied = async () => ({ ok: false, message: "Demo mode is read-only." });
  return { saveSetup: denied, saveRegistration: denied, activateSchedule: denied, confirmWinner: denied, correctWinner: denied, confirmAdvancement: denied, replaceAdvancement: denied };
}
