import { useEffect, useRef } from "react";
import { explainRank, type RankedStanding } from "@rr3/domain";

type RankProofDrawerProps = { carLabel: string; carId: string; rankings: readonly RankedStanding[]; onClose(): void };

export function RankProofDrawer({ carLabel, carId, rankings, onClose }: RankProofDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const proof = explainRank(carId, rankings);
  const ranked = rankings.find((row) => row.carId === carId)!;
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div className="drawer-backdrop">
      <section className="rank-proof-drawer" role="dialog" aria-modal="true" aria-labelledby="rank-proof-title">
        <p className="eyebrow">Auditable ranking proof</p><h3 id="rank-proof-title">Why {carLabel} is ranked here</h3>
        <p>{proof.summary}</p>
        <table aria-label={`${carLabel} tie-break proof`}><thead><tr><th>Configured tie-break</th><th>Value</th><th>Outcome</th></tr></thead><tbody>{ranked.tieBreaks.map(({ key, value, resolved }) => <tr key={key}><th scope="row">{key}</th><td>{value ?? "not available"}</td><td>{resolved ? "Resolved position" : "Did not resolve"}</td></tr>)}</tbody></table>
        <button ref={closeRef} type="button" onClick={onClose}>Close rank proof</button>
      </section>
    </div>
  );
}
