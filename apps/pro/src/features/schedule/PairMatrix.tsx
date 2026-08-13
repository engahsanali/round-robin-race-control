import { useMemo, useState } from "react";

export type PairDatum = {
  key: string;
  firstId: string;
  secondId: string;
  firstName: string;
  secondName: string;
  frequency: number;
};

type PairMatrixProps = {
  pairs: readonly PairDatum[];
};

type PairFilter = "all" | "repeated" | "single";

export function PairMatrix({ pairs }: PairMatrixProps) {
  const [filter, setFilter] = useState<PairFilter>("all");
  const filtered = useMemo(() => pairs.filter((pair) => {
    if (filter === "repeated") return pair.frequency > 1;
    if (filter === "single") return pair.frequency === 1;
    return true;
  }), [filter, pairs]);

  return (
    <section className="fairness-panel" aria-labelledby="pair-matrix-title">
      <div className="fairness-heading">
        <div><p className="eyebrow">Opponent frequency</p><h4 id="pair-matrix-title">Pair matrix</h4></div>
        <label>Opponent pair filter
          <select value={filter} onChange={(event) => setFilter(event.target.value as PairFilter)}>
            <option value="all">All meetings</option>
            <option value="repeated">Repeated pairs only</option>
            <option value="single">Single meetings only</option>
          </select>
        </label>
      </div>
      <div className="pair-matrix-grid" role="img" aria-label={`${pairs.length} opponent pair frequencies; darker cells mean more meetings`}>
        {filtered.map((pair) => (
          <span
            key={pair.key}
            className={`pair-cell pair-frequency-${Math.min(pair.frequency, 4)}`}
            title={`${pair.firstName} and ${pair.secondName}: ${pair.frequency}`}
          >{pair.frequency}</span>
        ))}
      </div>
      <div className="schedule-table-scroll">
        <table aria-label="Opponent pair frequency">
          <thead><tr><th scope="col">First car</th><th scope="col">Second car</th><th scope="col">Meetings</th><th scope="col">Repeat excess</th></tr></thead>
          <tbody>
            {filtered.map((pair) => <tr key={pair.key}><th scope="row">{pair.firstName}</th><td>{pair.secondName}</td><td>{pair.frequency}</td><td>{Math.max(0, pair.frequency - 1)}</td></tr>)}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? <p>No opponent pairs match this filter.</p> : null}
    </section>
  );
}
