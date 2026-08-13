import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEventJson, serializeEvent, type EventStateV1 } from "@rr3/domain";
import demoEvent from "../../../../fixtures/demo-event.json";
import { createProDatabase, type ProDatabase } from "./db";
import {
  EventRepository,
  EventRepositoryValidationError,
  type StoragePersistenceStatus,
} from "./repository";
import { authorizeDestructiveMigration, prepareDestructiveMigration } from "./migrations";

let database: ProDatabase;
let repository: EventRepository;
let databaseSequence = 0;

function eventFixture(): EventStateV1 {
  const parsed = parseEventJson(JSON.stringify(demoEvent));
  if (!parsed.ok) throw new Error("The shared demo fixture must remain valid");
  return parsed.data;
}

function revision(sequence: number, summary = `Revision ${sequence}`) {
  return {
    commandId: `command-${sequence}`,
    timestamp: `2026-08-14T00:${String(sequence).padStart(2, "0")}:00.000Z`,
    summary,
  };
}

beforeEach(() => {
  databaseSequence += 1;
  database = createProDatabase(`rr3-pro-repository-${databaseSequence}`);
  repository = new EventRepository(database);
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe("EventRepository", () => {
  it("starts empty without manufacturing a demo or persistence claim", async () => {
    await expect(repository.load()).resolves.toBeNull();
    await expect(repository.listSnapshots()).resolves.toEqual([]);
    await expect(repository.getStoragePersistenceStatus()).resolves.toBe("not-requested");
  });

  it("atomically saves the validated live event and ordered revision metadata", async () => {
    const event = eventFixture();

    const saved = await repository.save(event, revision(1, "Imported Solo event"));

    expect(saved).toMatchObject({
      id: "command-1",
      sequence: 1,
      timestamp: "2026-08-14T00:01:00.000Z",
      summary: "Imported Solo event",
      eventId: "event-demo-nine-car",
    });
    expect(await repository.load()).toEqual(event);
    expect(await repository.listSnapshots()).toEqual([saved]);
    expect((await repository.load())?.participants.map(({ id }) => id)).toEqual(
      event.participants.map(({ id }) => id),
    );
  });

  it("caps revision history at the newest 50 snapshots", async () => {
    for (let sequence = 1; sequence <= 55; sequence += 1) {
      const event = eventFixture();
      event.event.name = `Revision ${sequence}`;
      await repository.save(event, revision(sequence));
    }

    const snapshots = await repository.listSnapshots();
    expect(snapshots).toHaveLength(50);
    expect(snapshots[0]).toMatchObject({ id: "command-55", sequence: 55 });
    expect(snapshots.at(-1)).toMatchObject({ id: "command-6", sequence: 6 });
    expect((await repository.load())?.event.name).toBe("Revision 55");
  });

  it("rejects invalid candidates before a transaction and preserves live bytes", async () => {
    await repository.save(eventFixture(), revision(1));
    const before = serializeEvent((await repository.load())!);
    const invalid = eventFixture();
    invalid.entries[1]!.carNumber = invalid.entries[0]!.carNumber;

    await expect(repository.save(invalid, revision(2))).rejects.toBeInstanceOf(
      EventRepositoryValidationError,
    );
    expect(serializeEvent((await repository.load())!)).toBe(before);
    expect(await repository.listSnapshots()).toHaveLength(1);
  });

  it("rolls back both live and snapshot writes when the transaction fails", async () => {
    await repository.save(eventFixture(), revision(1));
    const before = serializeEvent((await repository.load())!);
    const beforeSnapshots = await repository.listSnapshots();
    const failSnapshot = () => {
      throw new Error("Synthetic snapshot write failure");
    };
    database.snapshots.hook("creating", failSnapshot);

    const candidate = eventFixture();
    candidate.event.name = "Must not survive";
    await expect(repository.save(candidate, revision(2))).rejects.toThrow(
      "Synthetic snapshot write failure",
    );

    expect(serializeEvent((await repository.load())!)).toBe(before);
    expect(await repository.listSnapshots()).toEqual(beforeSnapshots);
  });

  it("imports and exports schema-compatible Solo JSON without changing stable IDs", async () => {
    const imported = await repository.importJson(serializeEvent(eventFixture()), revision(1));

    expect(imported.eventId).toBe("event-demo-nine-car");
    const exported = await repository.exportJson();
    expect(exported).toBe(serializeEvent(eventFixture()));
    expect(JSON.parse(exported).entries.map(({ id }: { id: string }) => id)).toEqual(
      eventFixture().entries.map(({ id }) => id),
    );
  });

  it("leaves the live event byte-equivalent after an invalid import", async () => {
    await repository.save(eventFixture(), revision(1));
    const before = serializeEvent((await repository.load())!);

    await expect(repository.importJson("{not-json", revision(2))).rejects.toBeInstanceOf(
      EventRepositoryValidationError,
    );

    expect(serializeEvent((await repository.load())!)).toBe(before);
    expect(await repository.listSnapshots()).toHaveLength(1);
  });

  it("previews a historical snapshot and requires confirmation before restoring it", async () => {
    const original = eventFixture();
    original.event.name = "Original event";
    await repository.save(original, revision(1));
    const changed = eventFixture();
    changed.event.name = "Changed event";
    await repository.save(changed, revision(2));

    const preview = await repository.previewRestore("command-1");
    expect(preview).toMatchObject({
      snapshotId: "command-1",
      currentRevisionId: "command-2",
      summary: "Revision 1",
    });
    expect(preview.event.event.name).toBe("Original event");
    await expect(
      repository.restore("command-1", { ...revision(3, "Restored original"), confirmed: false }),
    ).rejects.toThrow("Restore confirmation is required");
    expect((await repository.load())?.event.name).toBe("Changed event");

    await repository.restore("command-1", {
      ...revision(3, "Restored original"),
      confirmed: true,
    });
    expect((await repository.load())?.event.name).toBe("Original event");
    expect((await repository.listSnapshots())[0]).toMatchObject({
      id: "command-3",
      summary: "Restored original",
    });
  });

  it.each([
    [true, "granted"],
    [false, "denied"],
  ] as const)(
    "requests persistent storage only after interaction and records %s as %s",
    async (persistResult, expectedStatus) => {
      const persist = vi.fn(async () => persistResult);
      repository = new EventRepository(database, { storageManager: { persist } });

      await expect(repository.requestPersistentStorage({ userInitiated: false })).rejects.toThrow(
        "user interaction",
      );
      expect(persist).not.toHaveBeenCalled();
      await expect(repository.requestPersistentStorage({ userInitiated: true })).resolves.toBe(
        expectedStatus,
      );
      expect(persist).toHaveBeenCalledTimes(1);
      expect(await repository.getStoragePersistenceStatus()).toBe(expectedStatus);
    },
  );

  it("reports persistence as unavailable when the browser API is absent", async () => {
    repository = new EventRepository(database, { storageManager: null });

    const status: StoragePersistenceStatus = await repository.requestPersistentStorage({
      userInitiated: true,
    });

    expect(status).toBe("unavailable");
    expect(await repository.getStoragePersistenceStatus()).toBe("unavailable");
  });

  it("requires an explicit recovery download before authorizing a destructive migration", async () => {
    await repository.save(eventFixture(), revision(1));

    await expect(
      prepareDestructiveMigration(repository, 2, { userInitiated: false }),
    ).rejects.toThrow("user interaction");

    const plan = await prepareDestructiveMigration(repository, 2, { userInitiated: true });
    expect(plan).toMatchObject({
      sourceVersion: 1,
      targetVersion: 2,
      requiresRecoveryDownload: true,
      authorized: false,
    });
    expect(plan.recovery.blob).toBeInstanceOf(Blob);
    expect(plan.recovery.blob.size).toBeGreaterThan(100);
    expect(JSON.parse(plan.recovery.json).event.id).toBe("event-demo-nine-car");
    expect(() =>
      authorizeDestructiveMigration(plan, { recoveryDownloaded: false }),
    ).toThrow("recovery download");
    expect(authorizeDestructiveMigration(plan, { recoveryDownloaded: true }).authorized).toBe(true);
  });
});
