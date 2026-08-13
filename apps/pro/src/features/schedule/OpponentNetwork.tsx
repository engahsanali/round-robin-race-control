import type { PairDatum } from "./PairMatrix";

type OpponentNetworkProps = {
  pairs: readonly PairDatum[];
  carNames: ReadonlyMap<string, string>;
};

export function OpponentNetwork({ pairs, carNames }: OpponentNetworkProps) {
  const repeated = pairs.filter(({ frequency }) => frequency > 1).length;
  const carIds = [...carNames.keys()];
  const positions = new Map(carIds.map((carId, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, carIds.length) - Math.PI / 2;
    return [carId, { x: 160 + Math.cos(angle) * 118, y: 150 + Math.sin(angle) * 112 }] as const;
  }));
  const description = `Opponent network: ${pairs.length} pair connections; ${repeated === 0 ? "no repeated pair" : `${repeated} repeated pairs`}.`;

  return (
    <section className="fairness-panel" aria-labelledby="opponent-network-title">
      <h4 id="opponent-network-title">Opponent network</h4>
      <svg className="opponent-network" viewBox="0 0 320 300" role="img" aria-label={description}>
        <title>{description}</title>
        {pairs.map((pair) => {
          const first = positions.get(pair.firstId);
          const second = positions.get(pair.secondId);
          if (!first || !second) return null;
          return <line key={pair.key} id={`pair-${collisionSafeId(pair.key)}`} data-pair-key={pair.key} x1={first.x} y1={first.y} x2={second.x} y2={second.y} className={pair.frequency > 1 ? "network-repeat" : "network-single"} />;
        })}
        {carIds.map((carId) => {
          const position = positions.get(carId)!;
          return <g key={carId} id={`node-${collisionSafeId(carId)}`} transform={`translate(${position.x} ${position.y})`}><circle r="17" /><text textAnchor="middle" dy="4">{shortName(carNames.get(carId) ?? carId)}</text></g>;
        })}
      </svg>
      <p className="feature-note">Every line is keyed by the complete encoded pair IDs, so punctuation in business IDs cannot merge two connections.</p>
    </section>
  );
}

function collisionSafeId(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shortName(name: string): string {
  const match = name.match(/\d+/);
  return match ? match[0] : name.slice(0, 3);
}
