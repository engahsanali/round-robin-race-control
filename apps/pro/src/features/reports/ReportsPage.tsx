import { useEffect, useRef, useState } from "react";
import { buildAuditRows, buildFeesRows, buildRegistrationRows, buildResultsRows, parseEventJson, serializeEvent, toCsv, type CsvRow, type EventStateV1 } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import { ReplayTimeline } from "../history/ReplayTimeline";
import { buildProjectedStandingsRows } from "../standings/rankingProjection";

export type EventPackFile = { name: string; type: string; text: string };
const CREDIT = "Made by Cesar Lacsamana and Ahsan Ali";

export function buildEventPack(event: EventStateV1): EventPackFile[] {
  const registrationRows = buildRegistrationRows(event);
  const accountRows = buildFeesRows(event);
  const scheduleRows = buildScheduleRows(event);
  const resultRows = buildResultsRows(event);
  const preliminaryRows = buildProjectedStandingsRows(event, "preliminary");
  const finalRows = buildProjectedStandingsRows(event, "final");
  const auditRows = buildAuditRows(event);
  const summary = `${event.event.name}\n${event.event.date} · ${event.event.venue}\nStatus: ${event.event.resultSeal}\nCars: ${event.entries.length}\nPreliminary heats: ${event.matches.length}\nFinal heats: ${event.finals.length}\n\n${CREDIT}\n`;
  return [
    { name: "event.json", type: "application/json", text: serializeEvent(event) },
    { name: "registration.csv", type: "text/csv", text: toCsv(registrationRows) },
    { name: "accounts.csv", type: "text/csv", text: toCsv(accountRows) },
    { name: "schedule.csv", type: "text/csv", text: toCsv(scheduleRows) },
    { name: "results.csv", type: "text/csv", text: toCsv(resultRows) },
    { name: "standings-preliminary.csv", type: "text/csv", text: toCsv(preliminaryRows) },
    { name: "standings-finals.csv", type: "text/csv", text: toCsv(finalRows) },
    { name: "audit.csv", type: "text/csv", text: toCsv(auditRows) },
    { name: "summary.txt", type: "text/plain", text: summary },
    { name: "printable-report.html", type: "text/html", text: buildPrintableReport(event, { registrationRows, accountRows, scheduleRows, resultRows, preliminaryRows, finalRows, auditRows }) },
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

function buildScheduleRows(event: EventStateV1): CsvRow[] {
  return [
    ["Heat ID", "Phase", "Match", "Heat", "Lane 1", "Lane 2", "Lane 3", "Status"],
    ...[...event.matches, ...event.finals].map((heat): CsvRow => [
      heat.id, heat.phase, heat.matchNumber, heat.heatNumber, ...heat.lanes, heat.status,
    ]),
  ];
}

function buildPrintableReport(
  event: EventStateV1,
  tables: {
    registrationRows: CsvRow[];
    accountRows: CsvRow[];
    scheduleRows: CsvRow[];
    resultRows: CsvRow[];
    preliminaryRows: CsvRow[];
    finalRows: CsvRow[];
    auditRows: CsvRow[];
  },
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(event.event.name)} — Printable event report</title><style>body{font-family:system-ui,sans-serif;margin:2rem;color:#111}table{width:100%;border-collapse:collapse;margin-block:1rem 2rem}th,td{border:1px solid #777;padding:.35rem;text-align:left}h2{break-before:page}footer{margin-top:2rem;font-weight:700}@media print{body{margin:0.5in}button{display:none}}</style></head><body><header><h1>Printable event report — ${escapeHtml(event.event.name)}</h1><p>${escapeHtml(event.event.date)} · ${escapeHtml(event.event.venue)} · ${escapeHtml(event.event.resultSeal)}</p></header>${htmlTable("Registration", tables.registrationRows)}${htmlTable("Accounts", tables.accountRows)}${htmlTable("Schedule and results", tables.scheduleRows)}${htmlTable("Official result detail", tables.resultRows)}${htmlTable("Preliminary standings", tables.preliminaryRows)}${htmlTable("Final standings", tables.finalRows)}${htmlTable("Audit history", tables.auditRows)}<footer>${CREDIT}</footer></body></html>`;
}

function htmlTable(title: string, rows: CsvRow[]): string {
  const [headers = [], ...body] = rows;
  return `<section><h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map((cell) => `<th scope="col">${escapeHtml(String(cell ?? ""))}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell, index) => `${index === 0 ? '<th scope="row">' : "<td>"}${escapeHtml(String(cell ?? ""))}${index === 0 ? "</th>" : "</td>"}`).join("")}</tr>`).join("")}</tbody></table></section>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
