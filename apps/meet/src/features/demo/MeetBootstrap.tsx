import { lazy, Suspense, useEffect, useState } from "react";
import type { AuthPort } from "../../app/AuthBoundary";
import type { MeetRepository } from "../../data/meetRepository";
import type { MeetBackupRepository } from "../../data/meetBackupRepository";
import { DemoWorkspace } from "./DemoWorkspace";

export type OfficialRuntime =
  | { ok: false; message: string }
  | { ok: true; repository: MeetRepository; auth: AuthPort; backupRepository: MeetBackupRepository };

const OfficialMeetApp = lazy(async () => {
  const module = await import("../../app/MeetApp");
  return { default: module.MeetApp };
});

export function MeetBootstrap({ search, loadOfficialRuntime }: { search: string; loadOfficialRuntime(): Promise<OfficialRuntime> }) {
  const startsInDemo = new URLSearchParams(search).get("demo") === "1";
  const [mode, setMode] = useState<"choose" | "demo" | "official">(startsInDemo ? "demo" : "choose");
  const [runtime, setRuntime] = useState<Extract<OfficialRuntime, { ok: true }> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (mode !== "official" || runtime) return;
    let active = true; setLoading(true); setError("");
    void loadOfficialRuntime().then((result) => {
      if (!active) return;
      if (!result.ok) { setError(result.message); setMode("choose"); }
      else setRuntime(result);
    }).catch(() => { if (active) { setError("Official environment unavailable"); setMode("choose"); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadOfficialRuntime, mode, runtime]);
  if (mode === "demo") return <DemoWorkspace onExit={() => setMode("choose")} />;
  if (mode === "official" && runtime) return <Suspense fallback={<p role="status">Opening official workspace…</p>}><OfficialMeetApp productionRepository={runtime.repository} auth={runtime.auth} backupRepository={runtime.backupRepository} /></Suspense>;
  return <div className="meet-app bootstrap-page"><a href="#main-content" className="skip-link">Skip to Meet choices</a><header className="brand-header"><span className="product-mark" aria-hidden="true">RR · 3</span><div><p className="edition-label">Hosted Meet Edition</p><h1>Round Robin Race Control</h1></div></header><main id="main-content"><section className="bootstrap-card" aria-labelledby="bootstrap-heading"><p className="eyebrow">Safe startup</p><h2 id="bootstrap-heading">Choose how to open Meet Edition</h2><p>The local demonstration never constructs an account, database, RPC or realtime client. Official mode loads the secure hosted runtime only after you choose it.</p><div className="bootstrap-actions"><button type="button" onClick={() => setMode("demo")}>Explore local read-only demo</button><button type="button" disabled={loading} onClick={() => setMode("official")}>{loading ? "Loading official workspace…" : "Open official workspace"}</button></div>{error ? <p role="alert" className="safe-notice">{error}</p> : null}</section></main><footer><p>Made by Cesar Lacsamana and Ahsan Ali</p><p>No advertising trackers.</p></footer></div>;
}
