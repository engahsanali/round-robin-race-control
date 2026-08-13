import type { ScheduleQualityReport } from "@rr3/domain";

type LaneBalanceChartProps = {
  quality: ScheduleQualityReport;
  carNames: ReadonlyMap<string, string>;
};

export function LaneBalanceChart({ quality, carNames }: LaneBalanceChartProps) {
  const carIds = [...carNames.keys()];
  return (
    <section className="fairness-panel" aria-labelledby="lane-balance-title">
      <h4 id="lane-balance-title">Lane, appearance, and bye balance</h4>
      <div className="lane-bars" role="img" aria-label={`Lane balance; maximum lane spread ${quality.maximumLaneSpread}`}>
        {carIds.map((carId) => {
          const counts = quality.laneCounts[carId] ?? [0, 0, 0];
          const total = Math.max(1, counts.reduce((sum, count) => sum + count, 0));
          return <div className="lane-bar" key={carId} aria-hidden="true"><span style={{ flex: counts[0] / total }} /><span style={{ flex: counts[1] / total }} /><span style={{ flex: counts[2] / total }} /></div>;
        })}
      </div>
      <div className="schedule-table-scroll">
        <table aria-label="Lane balance data">
          <thead><tr><th scope="col">Car</th><th scope="col">Appearances</th><th scope="col">Lane 1</th><th scope="col">Lane 2</th><th scope="col">Lane 3</th><th scope="col">Spread</th><th scope="col">Byes</th><th scope="col">Two-car heats</th></tr></thead>
          <tbody>{carIds.map((carId) => {
            const counts = quality.laneCounts[carId] ?? [0, 0, 0];
            const spread = Math.max(...counts) - Math.min(...counts);
            return <tr key={carId}><th scope="row">{carNames.get(carId)}</th><td>{quality.appearances[carId] ?? 0}</td><td>{counts[0]}</td><td>{counts[1]}</td><td>{counts[2]}</td><td>{spread}</td><td>{quality.byeCounts[carId] ?? 0}</td><td>{quality.twoCarHeatCounts[carId] ?? 0}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <p>Maximum lane spread {quality.maximumLaneSpread}</p>
    </section>
  );
}
