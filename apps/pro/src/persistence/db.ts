import Dexie, { type Table } from "dexie";
import type { EventStateV1 } from "@rr3/domain";

export type LiveEventRecord = {
  id: "current";
  event: EventStateV1;
  revisionId: string;
  savedAt: string;
  summary: string;
};

export type SnapshotRecord = {
  id: string;
  sequence: number;
  timestamp: string;
  summary: string;
  eventId: string;
  event: EventStateV1;
};

export type PreferenceRecord = {
  key: string;
  value: string;
};

export class ProDatabase extends Dexie {
  liveEvents!: Table<LiveEventRecord, string>;
  snapshots!: Table<SnapshotRecord, string>;
  preferences!: Table<PreferenceRecord, string>;

  constructor(name = "rr3-pro") {
    super(name);
    this.version(1).stores({
      liveEvents: "id",
      snapshots: "id, sequence, timestamp, eventId",
      preferences: "key",
    });
    this.liveEvents = this.table("liveEvents");
    this.snapshots = this.table("snapshots");
    this.preferences = this.table("preferences");
  }
}

export function createProDatabase(name?: string): ProDatabase {
  return new ProDatabase(name);
}
