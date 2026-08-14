import { useEffect, useState } from "react";
import { buildMeetEventPack, type MeetEventPackFile, type MeetReportAudience, type PortableHostedMeetBundle } from "@rr3/meet-domain";
import { WorkbookDialog } from "../workbook/WorkbookDialog";

export function MeetReports({ open, bundle, onClose, onDownload, onPrint }: {
  open: boolean;
  bundle: PortableHostedMeetBundle;
  onClose(): void;
  onDownload?(file: MeetEventPackFile): void;
  onPrint?(html: string): void;
}) {
  const [audience, setAudience] = useState<MeetReportAudience>("operations");
  const [files, setFiles] = useState<MeetEventPackFile[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!open) { setFiles([]); setError(""); } }, [open]);
  if (!open) return null;
  const build = async () => {
    setPending(true); setError("");
    try {
      setFiles(await buildMeetEventPack(bundle, { audience, exportedAt: bundle.state.meet.updatedAt, applicationVersion: "0.1.0" }));
    } catch {
      setFiles([]); setError("The event pack could not be built from the current validated meet.");
    } finally { setPending(false); }
  };
  const download = (file: MeetEventPackFile) => {
    if (onDownload) { onDownload(file); return; }
    const url = URL.createObjectURL(new Blob([file.text], { type: `${file.type};charset=utf-8` }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click(); URL.revokeObjectURL(url);
  };
  const print = () => {
    const html = files.find((file) => file.name === "printable-report.html")?.text;
    if (!html) return;
    if (onPrint) { onPrint(html); return; }
    const frame = document.createElement("iframe"); frame.hidden = true; document.body.append(frame);
    frame.contentDocument?.open(); frame.contentDocument?.write(html); frame.contentDocument?.close();
    frame.contentWindow?.focus(); frame.contentWindow?.print(); frame.remove();
  };
  return <WorkbookDialog title="Meet reports and Event Pack" onClose={onClose}>
    <p>Build a complete, deterministic meet pack for officials or a privacy-filtered public copy.</p>
    <fieldset className="report-audience"><legend>Report audience</legend>
      <label><input type="radio" name="report-audience" checked={audience === "operations"} onChange={() => { setAudience("operations"); setFiles([]); }} /> Operations pack</label>
      <label><input type="radio" name="report-audience" checked={audience === "public"} onChange={() => { setAudience("public"); setFiles([]); }} /> Public pack</label>
    </fieldset>
    {audience === "public" ? <p role="note" className="safe-notice">The public pack excludes email, phone, actor, reason, before and after values. It never includes invitations, membership security events or the recovery backup.</p> : <p role="note" className="safe-notice">Operations packs include the validated recovery backup and accountability fields. Share only with authorised officials.</p>}
    <button type="button" disabled={pending} onClick={() => void build()}>{pending ? "Building Event Pack…" : `Build ${audience} Event Pack`}</button>
    {error ? <p role="alert">{error}</p> : null}
    {files.length ? <section aria-label={`${audience} Event Pack files`} className="report-files">
      <div className="table-scroll"><table><thead><tr><th scope="col">File</th><th scope="col">MIME type</th><th scope="col">Bytes</th></tr></thead><tbody>{files.map((file) => <tr key={file.name}><th scope="row">{file.name}</th><td>{file.type}</td><td>{new TextEncoder().encode(file.text).byteLength}</td></tr>)}</tbody></table></div>
      <div className="dialog-actions"><button type="button" onClick={() => files.forEach(download)}>Download {files.length} {audience} files</button><button type="button" className="quiet-action" onClick={print}>Print {audience} report</button></div>
    </section> : null}
    <p className="print-credit">Made by Cesar Lacsamana and Ahsan Ali</p>
  </WorkbookDialog>;
}
