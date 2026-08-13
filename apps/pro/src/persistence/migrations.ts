import type { EventRepository, RecoveryExport } from "./repository";

export type DestructiveMigrationPlan = {
  sourceVersion: number;
  targetVersion: number;
  requiresRecoveryDownload: true;
  authorized: boolean;
  recovery: RecoveryExport;
};

export async function prepareDestructiveMigration(
  repository: EventRepository,
  targetVersion: number,
  options: { userInitiated: boolean },
): Promise<DestructiveMigrationPlan> {
  if (!options.userInitiated) {
    throw new Error("A destructive migration requires explicit user interaction");
  }
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new Error("Migration target version must be a positive integer");
  }
  const recovery = await repository.exportBeforeMigration();
  if (targetVersion <= recovery.sourceVersion) {
    throw new Error("Destructive migration target must be newer than the source version");
  }
  return {
    sourceVersion: recovery.sourceVersion,
    targetVersion,
    requiresRecoveryDownload: true,
    authorized: false,
    recovery,
  };
}

export function authorizeDestructiveMigration(
  plan: DestructiveMigrationPlan,
  options: { recoveryDownloaded: boolean },
): DestructiveMigrationPlan {
  if (!options.recoveryDownloaded) {
    throw new Error("A recovery download is required before destructive migration");
  }
  return { ...plan, authorized: true };
}
