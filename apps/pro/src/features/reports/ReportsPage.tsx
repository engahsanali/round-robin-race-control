import { useEffect, useRef, useState } from "react";
import { buildAuditRows, buildFeesRows, buildRegistrationRows, buildResultsRows, buildStandingsRows, parseEventJson, serializeEvent, toCsv, type EventStateV1 } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import { ReplayTimeline } from "../history/ReplayTimeline";

export type EventPackFile = { name: string; type: string; text: string };
const CREDIT = "Made by Cesar Lacsamana and Ahsan Ali";

export function buildEventPack(event: EventStateV1): EventPackFile[] {
  return [
    { name: "event.json", type: "application/json", text: serializeEvent(event) },
    { name: "registration.csv", type: "text/csv", text: toCsv(buildRegistrationRows(event)) },
    { name: "accounts.csv", type: "text/csv", text: toCsv(buildFeesRows(event)) },
    { name: "results.csv", type: "text/csv", text: toCsv(buildResultsRows(event)) },
    { name: "standings-preliminary.csv", type: "text/csv", text: toCsv(buildStandingsRows(event, "preliminary")) },
    { name: "standings-finals.csv", type: "text/csv", text: toCsv(buildStandingsRows(event, "final")) },
    { name: "audit.csv", type: "text/csv", text: toCsv(buildAuditRows(event)) },
    { name: "summary.txt", type: "text/plain", text: `${event.event.name}\n${event.event.date} · ${event.event.venue}\nStatus: ${event.event.resultSeal}\nCars: ${event.entries.length}\nPreliminary heats: ${event.matches.length}\nFinal heats: ${event.finals.length}\n\n${CREDIT}\n` },
  ];
}

export function ReportsPage() {
  const context = useOptionalEventState(); const heading = useRef<HTMLHeadingElement>(null); const [pack, setPack] = useState<EventPackFile[]>([]); const [importText, setImportText] = useState(""); const [message, setMessage] = useState(""); const state = context?.state ?? null;
  useEffect(() => { heading.current?.focus(); }, []);
  if (!context || !state) return <section className="page-frame"><h2 ref={heading} tabIndex={-1} id="page-title">Reports</h2><p>No event is loaded.</p></section>;
  const prepare = () => { const files = buildEventPack(state); setPack(files); for (const file of files) download(file); setMessage(`Prepared ${files.length} deterministic Event Pack files.`); };
  const importEvent = async () => { const parsed = parseEventJson(importText); if (!parsed.ok) { setMessage("Import rejected; the current event was not changed."); return; } try { await context.importEventJson(importText, "Imported cross-edition event JSON"); setMessage("Imported compatible event JSON atomically."); } catch { setMessage("Import rejected; the current event was not changed."); } };
  return <section className="page-frame reports-page" aria-labelledby="page-title"><p className="eyebrow">Portable event evidence</p><h2 ref={heading} tabIndex={-1} id="page-title">Reports</h2><section className="feature-panel" aria-label="Event Pack"><h3>Event Pack</h3><p>One local action prepares compatible JSON, safe CSVs, and a human-readable summary.</p><div className="action-row"><button type="button" onClick={prepare}>Prepare Event Pack</button><button type="button" className="quiet-action" onClick={() => window.print()}>Print event report</button></div>{pack.length ? <ul aria-label="Event Pack files">{pack.map((file) => <li key={file.name}><button type="button" className="download-link" onClick={() => download(file)}>Download {file.name}</button> · {new Blob([file.text]).size} bytes</li>)}</ul> : null}</section><section className="share-card" aria-label="Share card preview"><p className="eyebrow">Local share preview</p><h3>{state.event.name}</h3><p>{state.event.date} · {state.event.venue}</p><p>{state.event.resultSeal === "official" ? "Official results" : "Race event"} · RR · 3</p><p>{CREDIT}</p><button type="button" onClick={() => download({ name: "share-card.svg", type: "image/svg+xml", text: shareCardSvg(state) })}>Download share card</button></section><section className="feature-panel" aria-label="Cross-edition transfer"><h3>Cross-edition transfer</h3><p>Paste a schema-version-1 Solo or Pro event. Validation is atomic.</p><label>Compatible event JSON<textarea rows={7} value={importText} onChange={(change) => setImportText(change.target.value)} /></label><button type="button" onClick={() => void importEvent()}>Import compatible event</button></section><ReplayTimeline />{message ? <p role="status">{message}</p> : null}</section>;
}

function download(file: EventPackFile) { if (typeof URL.createObjectURL !== "function") return; const url = URL.createObjectURL(new Blob([file.text], { type: `${file.type};charset=utf-8` })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }
function shareCardSvg(event: EventStateV1): string { const esc = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" role="img" aria-label="${esc(event.event.name)} share card"><rect width="1200" height="630" fill="#081116"/><text x="70" y="100" fill="#50e3ff" font-size="38">RR · 3</text><text x="70" y="250" fill="white" font-size="72">${esc(event.event.name)}</text><text x="70" y="340" fill="#b6c4cc" font-size="34">${esc(event.event.date)} · ${esc(event.event.venue)}</text><text x="70" y="560" fill="#b9ff47" font-size="28">${CREDIT}</text></svg>`; }
