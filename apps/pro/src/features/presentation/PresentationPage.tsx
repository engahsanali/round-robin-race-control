import { useEffect, useRef, useState } from "react";
import { useOptionalOfficialEventState } from "../../state/EventProvider";
import { createSpectatorSnapshot, subscribeToSpectatorSnapshots, type SpectatorSnapshot } from "./eventChannel";

const panels = ["race", "standings", "notices"] as const;

export function PresentationPage() {
  const official = useOptionalOfficialEventState();
  const [snapshot, setSnapshot] = useState<SpectatorSnapshot | null>(() => official?.state ? createSpectatorSnapshot(official.state) : null);
  const [paused, setPaused] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(10);
  const [panel, setPanel] = useState(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (official?.state) setSnapshot(createSpectatorSnapshot(official.state));
  }, [official?.state]);
  useEffect(() => subscribeToSpectatorSnapshots(setSnapshot), []);
  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => setPanel((current) => (current + 1) % panels.length), intervalSeconds * 1_000);
    return () => window.clearInterval(timer);
  }, [intervalSeconds, paused]);

  const move = (direction: number) => setPanel((current) => (current + direction + panels.length) % panels.length);
  return (
    <section className="page-frame presentation-board" aria-label="Spectator Board">
      <p className="eyebrow">Read-only projector surface</p><h2 id="page-title">Spectator Board</h2>
      <p className="page-intro">Live sync works only between same-origin tabs in this same browser and device, not cloud or cross-device sync.</p>
      <div className="presentation-controls" aria-label="Presentation rotation controls">
        <button type="button" onClick={() => move(-1)}>Previous presentation panel</button>
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "Resume rotation" : "Pause rotation"}</button>
        <button type="button" onClick={() => move(1)}>Next presentation panel</button>
        <label>Rotation interval<select value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))}><option value="5">5 seconds</option><option value="10">10 seconds</option><option value="20">20 seconds</option></select></label>
      </div>
      <p role="status" aria-label="Rotation status">Rotation {paused ? "paused" : `running every ${intervalSeconds} seconds`} · {panels[panel]} panel</p>
      {!snapshot ? <div className="empty-panel" role="note"><strong>Waiting for a validated live event</strong><p>Open Race Command in another tab in this browser.</p></div> : <Board snapshot={snapshot} panel={panels[panel]!} />}
    </section>
  );
}

function Board({ snapshot, panel }: { snapshot: SpectatorSnapshot; panel: typeof panels[number] }) {
  const seal = snapshot.event.resultSeal === "official" ? "Official" : snapshot.event.resultSeal === "provisional" ? "Provisional" : "Live draft";
  return (
    <div className="spectator-surface" aria-live="polite">
      <header><div><p className="eyebrow">{seal}</p><h3>{snapshot.event.name}</h3><p>{snapshot.event.venue}</p></div><time dateTime={snapshot.updatedAt}>Updated {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour12: false })}</time></header>
      {panel === "race" ? <section className="spectator-race"><HeatFact title="Current" heat={snapshot.current} /><HeatFact title="Next" heat={snapshot.next} /><HeatFact title="Latest result" heat={snapshot.latest} /></section> : null}
      <table aria-label="Live standings"><thead><tr><th>Rank</th><th>Car</th><th>Driver</th><th>Wins</th></tr></thead><tbody>{snapshot.standings.map((row) => <tr key={row.carId}><td>{row.rank ?? "—"}</td><th scope="row">Car {row.carNumber} · {row.carName}</th><td>{row.participantName}</td><td>{row.wins}</td></tr>)}</tbody></table>
      {panel === "notices" ? <section><h4>Race notices</h4>{snapshot.notices.length ? <ul>{snapshot.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul> : <p>No race notices.</p>}</section> : null}
    </div>
  );
}

function HeatFact({ title, heat }: { title: string; heat: SpectatorSnapshot["current"] }) {
  return <article className="spectator-fact"><h4>{title}</h4>{heat ? <><p>{heat.label} · {heat.status}</p><p>{heat.winner ? `${title} · ${heat.winner}` : heat.lanes.map(({ lane, carNumber }) => `Lane ${lane} Car ${carNumber}`).join(" · ")}</p></> : <p>None</p>}</article>;
}
