import type { StoragePersistenceStatus } from "../../persistence/repository";

type RecoveryPanelProps = {
  persistenceStatus: StoragePersistenceStatus;
  snapshotCount: number;
  portableBackupStatus: "not-downloaded" | "downloaded";
};

const persistenceLabels: Record<StoragePersistenceStatus, string> = {
  "not-requested": "not requested",
  granted: "granted",
  denied: "denied",
  unavailable: "unavailable",
};

export function RecoveryPanel({
  persistenceStatus,
  snapshotCount,
  portableBackupStatus,
}: RecoveryPanelProps) {
  return (
    <section className="feature-panel recovery-panel" aria-label="Recovery confidence">
      <p className="eyebrow">Local recovery</p>
      <h3>Recovery confidence</h3>
      <ul className="fact-list">
        <li>Storage persistence: {persistenceLabels[persistenceStatus]}</li>
        <li>{snapshotCount === 0 ? "No local revisions yet" : `${snapshotCount} local revision${snapshotCount === 1 ? "" : "s"} available`}</li>
        <li>Portable backup: {portableBackupStatus === "downloaded" ? "downloaded this session" : "not downloaded in this session"}</li>
      </ul>
      <p className="feature-note">
        Local revisions help recover changes in this browser. Downloaded JSON is the durable portable copy.
      </p>
    </section>
  );
}
