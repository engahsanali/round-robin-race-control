import { useEffect, useRef, useState } from "react";
import { useSanitizedDiagnostics } from "../../app/diagnostics";
import { RELEASE_VERSION } from "../../app/release";
import { useOptionalEventState } from "../../state/EventProvider";

type NetworkState = "Online" | "Offline";

function readNetworkState(): NetworkState {
  return navigator.onLine ? "Online" : "Offline";
}

export function DiagnosticsPage() {
  const eventState = useOptionalEventState();
  const diagnostics = useSanitizedDiagnostics();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [network, setNetwork] = useState<NetworkState>(readNetworkState);
  const [persistenceMessage, setPersistenceMessage] = useState("");

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    const online = () => setNetwork("Online");
    const offline = () => setNetwork("Offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    void fetch(`/manifest.webmanifest?diagnostic=${Date.now()}`, { cache: "no-store" })
      .then(() => setNetwork(readNetworkState()))
      .catch(() => setNetwork("Offline"));
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  async function requestPersistence() {
    if (!eventState) return;
    const result = await eventState.requestPersistentStorage();
    setPersistenceMessage(`Persistent storage request: ${result}.`);
  }

  const capabilities = [
    ["IndexedDB", "indexedDB" in window ? "available" : "unavailable"],
    ["Service worker", "serviceWorker" in navigator ? "available" : "unavailable"],
    ["BroadcastChannel", "BroadcastChannel" in window ? "available" : "unavailable"],
    ["Wake Lock", "wakeLock" in navigator ? "available" : "unavailable"],
  ] as const;

  return (
    <section className="page-frame diagnostics-page" aria-labelledby="page-title">
      <p className="eyebrow">Local health</p>
      <h2 ref={headingRef} id="page-title" tabIndex={-1}>Diagnostics</h2>
      <p className="page-intro">Inspect this browser’s local release, recovery, and offline capabilities without transmitting event data.</p>

      <section className="feature-panel" aria-label="Release identity">
        <h3>Release identity</h3>
        <dl className="diagnostic-list">
          <div><dt>Product</dt><dd>Round Robin Race Control Pro</dd></div>
          <div><dt>Version</dt><dd>Version {RELEASE_VERSION}</dd></div>
          <div><dt>Schema</dt><dd>Event schema version 1</dd></div>
          <div><dt>Network</dt><dd><span role="status" aria-label="Network status">{network}</span></dd></div>
        </dl>
      </section>

      <section className="feature-panel" aria-label="Local capability checks">
        <h3>Local capability checks</h3>
        <table>
          <caption>Browser APIs used for local-first race control</caption>
          <tbody>{capabilities.map(([name, status]) => <tr key={name}><th scope="row">{name}</th><td>{status}</td></tr>)}</tbody>
        </table>
        <p>Storage persistence: {eventState?.persistenceStatus ?? "unavailable"}. Local revisions: {eventState?.snapshots.length ?? 0}.</p>
        <button type="button" onClick={() => void requestPersistence()} disabled={!eventState}>Request persistent local storage</button>
        <p role="status">{persistenceMessage}</p>
      </section>

      <section className="feature-panel" aria-label="Sanitized application diagnostics">
        <h3>Sanitized application diagnostics</h3>
        <p>Unexpected failures are kept in memory for this session as sanitized messages, never raw stack traces or event payloads.</p>
        {diagnostics.length ? (
          <ol>{diagnostics.map((item) => <li key={item.id}><time dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleTimeString()}</time> — {item.message}</li>)}</ol>
        ) : <p>No unexpected application failures recorded this session.</p>}
      </section>

      <p className="feature-note">Local event data stays on this device. This page checks only the same-origin app manifest for shell availability and sends no telemetry.</p>
    </section>
  );
}
