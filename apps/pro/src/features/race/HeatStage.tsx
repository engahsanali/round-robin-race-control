import type { EventStateV1, Heat } from "@rr3/domain";

type HeatStageProps = {
  heat: Heat;
  event: EventStateV1;
  pendingLane: number | null;
  times: [string, string, string];
  onChooseLane(lane: number): void;
  onTime(lane: number, value: string): void;
};

export function HeatStage({ heat, event, pendingLane, times, onChooseLane, onTime }: HeatStageProps) {
  return (
    <section className="heat-stage" aria-label="Current heat">
      <div className="heat-title"><p className="eyebrow">Current heat</p><h3>Match {heat.matchNumber} · Heat {heat.heatNumber}</h3><span className={`heat-status heat-${heat.status}`}>{heat.status}</span></div>
      <div className="lane-grid">
        {heat.lanes.map((carId, laneIndex) => {
          const entry = event.entries.find(({ id }) => id === carId);
          if (!carId || !entry) return <div className="lane-card lane-empty" key={laneIndex}>Lane {laneIndex + 1} empty</div>;
          const lane = laneIndex + 1;
          return (
            <article className={`lane-card${pendingLane === lane ? " lane-selected" : ""}`} key={carId}>
              <p>Lane {lane}</p><h4>Car {entry.carNumber}</h4><p>{entry.name}</p>
              <button type="button" aria-pressed={pendingLane === lane} onClick={() => onChooseLane(lane)}>Lane {lane} · Car {entry.carNumber} wins</button>
              {event.settings.enableTiming ? <label>Lane {lane} time in seconds<input type="number" min="0" step="0.001" inputMode="decimal" value={times[laneIndex]} onChange={(change) => onTime(lane, change.target.value)} /></label> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
