import type { CommandReceipt } from "../../state/commands";

type ResultReceiptProps = { receipt: CommandReceipt; description: string; undoable: boolean; onUndo(): void; pending: boolean };

export function ResultReceipt({ receipt, description, undoable, onUndo, pending }: ResultReceiptProps) {
  const changes = receipt.affectedCarIds.flatMap((carId) => {
    const before = receipt.previousRanks[carId] ?? null;
    const after = receipt.nextRanks[carId] ?? null;
    return before === after ? [] : [`${carId}: ${before ?? "unranked"} → ${after ?? "unranked"}`];
  });
  return (
    <section className="result-receipt" aria-label="Result receipt">
      <p className="eyebrow">Committed result</p><h3>{description}</h3>
      <p>{receipt.timestamp.slice(11, 19)} UTC · {receipt.commandId}</p>
      <p>{changes.length ? `Standing changes: ${changes.join("; ")}` : "Standings checked; no rank movement."}</p>
      {undoable ? <button type="button" onClick={onUndo} disabled={pending}>Undo this result</button> : null}
    </section>
  );
}
