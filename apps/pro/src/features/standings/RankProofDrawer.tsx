import { useEffect, useRef } from "react";
import { explainRank, type RankedStanding } from "@rr3/domain";

type RankProofDrawerProps = {
  carLabel: string;
  carId: string;
  rankings: readonly RankedStanding[];
  returnFocus: HTMLButtonElement | null;
  onClose(): void;
};

export function RankProofDrawer({ carLabel, carId, rankings, returnFocus, onClose }: RankProofDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const proof = explainRank(carId, rankings);
  const labels = new Map(rankings.map((row) => [row.carId, `Car ${row.carNumber}`]));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
    closeRef.current?.focus();
    return () => {
      try { if (dialog.open) dialog.close(); } catch { dialog.removeAttribute("open"); }
    };
  }, []);

  const dismiss = () => {
    const dialog = dialogRef.current;
    try { dialog?.close(); } catch { dialog?.removeAttribute("open"); }
    onClose();
    returnFocus?.focus();
  };

  return (
    <dialog
      ref={dialogRef}
      className="rank-proof-drawer"
      aria-labelledby="rank-proof-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <p className="eyebrow">Auditable ranking proof</p>
      <h3 id="rank-proof-title">Why {carLabel} is ranked here</h3>
      <p>{humanizeProof(proof.summary, labels)}</p>
      {proof.tiedWithCarIds.length ? <p>Tied with: {proof.tiedWithCarIds.map((id) => labels.get(id) ?? id).join(", ")}.</p> : null}
      <table aria-label={`${carLabel} tie-break proof`}>
        <thead><tr><th>Configured tie-break</th><th>Value</th><th>Competitive</th><th>Outcome</th></tr></thead>
        <tbody>
          {proof.comparisons.map(({ key, value, competitive, resolved }) => (
            <tr key={key}>
              <th scope="row">{key}</th>
              <td>{value ?? "not available"}</td>
              <td>{competitive ? "Competitive" : "Decision required"}</td>
              <td>{resolved ? "Resolved position" : "Did not resolve"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button ref={closeRef} type="button" onClick={dismiss}>Close rank proof</button>
    </dialog>
  );
}

function humanizeProof(summary: string, labels: ReadonlyMap<string, string>): string {
  let result = summary;
  for (const [id, label] of labels) result = result.replaceAll(id, label);
  return result;
}
