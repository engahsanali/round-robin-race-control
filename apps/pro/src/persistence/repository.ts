import {
  parseEventJson,
  serializeEvent,
  validateEventState,
  type EventStateV1,
  type ValidationIssue,
} from "@rr3/domain";
import type { ProDatabase, SnapshotRecord } from "./db";

const LIVE_EVENT_ID = "current";
const PERSISTENCE_PREFERENCE_KEY = "storage-persistence";
const MAX_SNAPSHOTS = 50;

export type RevisionInput = {
  commandId: string;
  timestamp: string;
  summary: string;
};

export type SnapshotMetadata = {
  id: string;
  sequence: number;
  timestamp: string;
  summary: string;
  eventId: string;
};

export type RestorePreview = {
  snapshotId: string;
  currentRevisionId: string | null;
  timestamp: string;
  summary: string;
  event: EventStateV1;
};

export type StoragePersistenceStatus = "not-requested" | "granted" | "denied" | "unavailable";

export type RecoveryExport = {
  fileName: string;
  mimeType: "application/json";
  sourceVersion: number;
  json: string;
  blob: Blob;
};

type StorageManagerLike = {
  persist(): Promise<boolean>;
};

type EventRepositoryOptions = {
  storageManager?: StorageManagerLike | null;
};

export class EventRepositoryValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[]) {
    super(message);
    this.name = "EventRepositoryValidationError";
    this.issues = issues.map((issue) => ({ ...issue, path: [...issue.path] }));
  }
}

export class EventRepository {
  readonly database: ProDatabase;
  private readonly storageManager: StorageManagerLike | null;

  constructor(database: ProDatabase, options: EventRepositoryOptions = {}) {
    this.database = database;
    if (Object.prototype.hasOwnProperty.call(options, "storageManager")) {
      this.storageManager = options.storageManager ?? null;
    } else {
      const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
      this.storageManager = storage && typeof storage.persist === "function"
        ? { persist: () => storage.persist() }
        : null;
    }
  }

  async load(): Promise<EventStateV1 | null> {
    const record = await this.database.liveEvents.get(LIVE_EVENT_ID);
    if (!record) return null;
    return cloneValidatedEvent(record.event, "Stored live event is invalid");
  }

  async save(candidate: EventStateV1, revision: RevisionInput): Promise<SnapshotMetadata> {
    const event = cloneValidatedEvent(candidate, "Event candidate is invalid");
    const metadata = validateRevisionInput(revision);

    return this.database.transaction(
      "rw",
      this.database.liveEvents,
      this.database.snapshots,
      async () => {
        const latest = await this.database.snapshots.orderBy("sequence").last();
        const sequence = (latest?.sequence ?? 0) + 1;
        const snapshot: SnapshotRecord = {
          id: metadata.commandId,
          sequence,
          timestamp: metadata.timestamp,
          summary: metadata.summary,
          eventId: event.event.id,
          event: structuredClone(event),
        };

        await this.database.snapshots.add(snapshot);
        await this.database.liveEvents.put({
          id: LIVE_EVENT_ID,
          event: structuredClone(event),
          revisionId: snapshot.id,
          savedAt: snapshot.timestamp,
          summary: snapshot.summary,
        });

        const snapshotCount = await this.database.snapshots.count();
        const excess = snapshotCount - MAX_SNAPSHOTS;
        if (excess > 0) {
          const oldestKeys = await this.database.snapshots.orderBy("sequence").limit(excess).primaryKeys();
          await this.database.snapshots.bulkDelete(oldestKeys);
        }

        return toSnapshotMetadata(snapshot);
      },
    );
  }

  async listSnapshots(): Promise<SnapshotMetadata[]> {
    const records = await this.database.snapshots.orderBy("sequence").reverse().toArray();
    return records.map(toSnapshotMetadata);
  }

  async previewRestore(snapshotId: string): Promise<RestorePreview> {
    const snapshot = await this.requireSnapshot(snapshotId);
    const current = await this.database.liveEvents.get(LIVE_EVENT_ID);
    return {
      snapshotId: snapshot.id,
      currentRevisionId: current?.revisionId ?? null,
      timestamp: snapshot.timestamp,
      summary: snapshot.summary,
      event: cloneValidatedEvent(snapshot.event, "Stored snapshot is invalid"),
    };
  }

  async restore(
    snapshotId: string,
    options: RevisionInput & { confirmed: boolean },
  ): Promise<SnapshotMetadata> {
    if (!options.confirmed) throw new Error("Restore confirmation is required");
    const snapshot = await this.requireSnapshot(snapshotId);
    return this.save(snapshot.event, options);
  }

  async importJson(text: string, revision: RevisionInput): Promise<SnapshotMetadata> {
    const result = parseEventJson(text);
    if (!result.ok) {
      throw new EventRepositoryValidationError("Imported event is invalid", result.issues);
    }
    return this.save(result.data, revision);
  }

  async exportJson(): Promise<string> {
    const event = await this.load();
    if (!event) throw new Error("No live event is available to export");
    return serializeEvent(event);
  }

  async exportBeforeMigration(): Promise<RecoveryExport> {
    const event = await this.load();
    if (!event) throw new Error("No live event is available for migration recovery");
    const json = serializeEvent(event);
    const safeEventId = event.event.id.replaceAll(/[^a-zA-Z0-9_-]+/g, "-");
    return {
      fileName: `rr3-${safeEventId}-before-migration-v${event.version}.json`,
      mimeType: "application/json",
      sourceVersion: event.version,
      json,
      blob: new Blob([json], { type: "application/json" }),
    };
  }

  async getStoragePersistenceStatus(): Promise<StoragePersistenceStatus> {
    const record = await this.database.preferences.get(PERSISTENCE_PREFERENCE_KEY);
    return isStoragePersistenceStatus(record?.value) ? record.value : "not-requested";
  }

  async requestPersistentStorage(options: { userInitiated: boolean }): Promise<StoragePersistenceStatus> {
    if (!options.userInitiated) {
      throw new Error("Persistent storage may be requested only after user interaction");
    }

    let status: StoragePersistenceStatus;
    if (!this.storageManager) {
      status = "unavailable";
    } else {
      try {
        status = await this.storageManager.persist() ? "granted" : "denied";
      } catch {
        status = "unavailable";
      }
    }
    await this.database.preferences.put({ key: PERSISTENCE_PREFERENCE_KEY, value: status });
    return status;
  }

  private async requireSnapshot(snapshotId: string): Promise<SnapshotRecord> {
    const snapshot = await this.database.snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`Unknown snapshot ID: ${snapshotId}`);
    return snapshot;
  }
}

function cloneValidatedEvent(input: unknown, message: string): EventStateV1 {
  const result = validateEventState(input);
  if (!result.success) throw new EventRepositoryValidationError(message, result.issues);
  return structuredClone(result.data);
}

function validateRevisionInput(revision: RevisionInput): RevisionInput {
  const commandId = revision.commandId.trim();
  const timestamp = revision.timestamp.trim();
  const summary = revision.summary.trim();
  if (!commandId) throw new Error("Revision command ID is required");
  if (!timestamp) throw new Error("Revision timestamp is required");
  if (!summary) throw new Error("Revision summary is required");
  return { commandId, timestamp, summary };
}

function toSnapshotMetadata(snapshot: SnapshotRecord): SnapshotMetadata {
  return {
    id: snapshot.id,
    sequence: snapshot.sequence,
    timestamp: snapshot.timestamp,
    summary: snapshot.summary,
    eventId: snapshot.eventId,
  };
}

function isStoragePersistenceStatus(value: unknown): value is StoragePersistenceStatus {
  return value === "not-requested" || value === "granted" || value === "denied" || value === "unavailable";
}
