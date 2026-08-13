import "fake-indexeddb/auto";

import { useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEventJson, serializeEvent, type EventStateV1 } from "@rr3/domain";
import demoEvent from "../../../../fixtures/demo-event.json";
import { createProDatabase, type ProDatabase } from "../persistence/db";
import { EventRepository } from "../persistence/repository";
import {
  CommandAlreadyPendingError,
  createCommandDispatcher,
  type CommandReceipt,
} from "./commands";
import { EventProvider, useEventState } from "./EventProvider";

let database: ProDatabase;
let repository: EventRepository;
let databaseSequence = 0;

function eventFixture(): EventStateV1 {
  const parsed = parseEventJson(JSON.stringify(demoEvent));
  if (!parsed.ok) throw new Error("The shared demo fixture must remain valid");
  return parsed.data;
}

function bootstrapRevision() {
  return {
    commandId: "bootstrap",
    timestamp: "2026-08-14T00:00:00.000Z",
    summary: "Bootstrap event",
  };
}

beforeEach(() => {
  databaseSequence += 1;
  database = createProDatabase(`rr3-pro-commands-${databaseSequence}`);
  repository = new EventRepository(database);
});

afterEach(async () => {
  cleanup();
  database.close();
  await database.delete();
});

describe("event commands", () => {
  it("commits a shared-core winner command before publishing its exact receipt", async () => {
    await repository.save(eventFixture(), bootstrapRevision());
    const published: Array<{ event: EventStateV1; receipt: CommandReceipt }> = [];
    const dispatcher = createCommandDispatcher({
      repository,
      now: () => "2026-08-14T01:02:03.000Z",
      createId: () => "command-result-1",
      publish: (event, receipt) => published.push({ event, receipt }),
    });

    const receipt = await dispatcher.dispatch({
      type: "result.record-winner",
      heatId: "pre-m02-h03",
      carId: "car-03",
    });

    expect(receipt).toEqual({
      commandId: "command-result-1",
      timestamp: "2026-08-14T01:02:03.000Z",
      summary: "Recorded winner car-03 for heat pre-m02-h03.",
      affectedCarIds: ["car-03"],
      previousRanks: {
        "car-01": 1,
        "car-02": 5,
        "car-03": 5,
        "car-04": 3,
        "car-05": 4,
        "car-06": 5,
        "car-07": 2,
        "car-08": 5,
        "car-09": 5,
      },
      nextRanks: {
        "car-01": 1,
        "car-02": 6,
        "car-03": 4,
        "car-04": 3,
        "car-05": 4,
        "car-06": 6,
        "car-07": 2,
        "car-08": 6,
        "car-09": 6,
      },
      undoUntil: "2026-08-14T01:02:33.000Z",
    });
    const committed = await repository.load();
    expect(committed?.matches.find(({ id }) => id === "pre-m02-h03")).toMatchObject({
      status: "completed",
      winnerEntryId: "car-03",
    });
    expect(committed?.auditLog.at(-1)).toMatchObject({
      action: "result.recorded",
      timestamp: "2026-08-14T01:02:03.000Z",
    });
    expect(published).toEqual([{ event: committed, receipt }]);
  });

  it.each([
    [
      { type: "heat.cancel" as const, heatId: "pre-m01-h01", reason: "Track obstruction" },
      "heat.cancelled",
      "cancelled",
    ],
    [
      { type: "heat.mark-rerun" as const, heatId: "pre-m01-h01", reason: "False start" },
      "heat.rerun-marked",
      "rerun",
    ],
  ])("routes %s through shared core and audits it", async (command, action, status) => {
    await repository.save(eventFixture(), bootstrapRevision());
    const dispatcher = createCommandDispatcher({
      repository,
      now: () => "2026-08-14T01:00:00.000Z",
      createId: () => `command-${status}`,
    });

    const receipt = await dispatcher.dispatch(command);
    const committed = await repository.load();

    expect(committed?.matches.find(({ id }) => id === command.heatId)?.status).toBe(status);
    expect(committed?.auditLog.at(-1)?.action).toBe(action);
    expect(receipt.affectedCarIds).toEqual(["car-01", "car-02", "car-03"]);
    expect(receipt.undoUntil).toBe("2026-08-14T01:00:30.000Z");
  });

  it("initializes a fresh store from a validated replacement command", async () => {
    const dispatcher = createCommandDispatcher({
      repository,
      now: () => "2026-08-14T01:00:00.000Z",
      createId: () => "command-import",
    });

    const receipt = await dispatcher.dispatch({
      type: "event.replace",
      event: eventFixture(),
      summary: "Imported Solo event",
    });

    expect(receipt.previousRanks).toEqual({});
    expect(receipt.undoUntil).toBeNull();
    expect((await repository.load())?.event.id).toBe("event-demo-nine-car");
  });

  it("rejects a duplicate submission while a command transaction is pending", async () => {
    await repository.save(eventFixture(), bootstrapRevision());
    const dispatcher = createCommandDispatcher({
      repository,
      now: () => "2026-08-14T01:00:00.000Z",
      createId: () => "command-pending",
    });
    const command = {
      type: "result.record-winner" as const,
      heatId: "pre-m02-h03",
      carId: "car-03",
    };

    const first = dispatcher.dispatch(command);
    await expect(dispatcher.dispatch(command)).rejects.toBeInstanceOf(CommandAlreadyPendingError);
    await expect(first).resolves.toMatchObject({ commandId: "command-pending" });
  });

  it("does not publish or alter live bytes when the transaction fails", async () => {
    await repository.save(eventFixture(), bootstrapRevision());
    const before = serializeEvent((await repository.load())!);
    const publish = vi.fn();
    database.snapshots.hook("creating", () => {
      throw new Error("Synthetic commit failure");
    });
    const dispatcher = createCommandDispatcher({
      repository,
      now: () => "2026-08-14T01:00:00.000Z",
      createId: () => "command-fails",
      publish,
    });

    await expect(
      dispatcher.dispatch({
        type: "result.record-winner",
        heatId: "pre-m02-h03",
        carId: "car-03",
      }),
    ).rejects.toThrow("Synthetic commit failure");

    expect(publish).not.toHaveBeenCalled();
    expect(serializeEvent((await repository.load())!)).toBe(before);
  });
});

function ProviderProbe() {
  const {
    state,
    loading,
    persistenceStatus,
    dispatchEventCommand,
    requestPersistentStorage,
  } = useEventState();
  const [receipt, setReceipt] = useState("");

  if (loading) return <p>Loading local event</p>;
  return (
    <section>
      <p>Event: {state?.event.name ?? "none"}</p>
      <p>Winner: {state?.matches.find(({ id }) => id === "pre-m02-h03")?.winnerEntryId ?? "none"}</p>
      <p>Storage: {persistenceStatus}</p>
      <p>Receipt: {receipt}</p>
      <button
        type="button"
        onClick={() => {
          void dispatchEventCommand({
            type: "result.record-winner",
            heatId: "pre-m02-h03",
            carId: "car-03",
          }).then((result) => setReceipt(result.summary));
        }}
      >
        Record winner
      </button>
      <button type="button" onClick={() => void requestPersistentStorage()}>Persist storage</button>
    </section>
  );
}

describe("EventProvider", () => {
  it("loads local state, publishes only committed commands, and exposes persistence status", async () => {
    await repository.save(eventFixture(), bootstrapRevision());
    const persist = vi.fn(async () => true);
    repository = new EventRepository(database, { storageManager: { persist } });
    const published = vi.fn();
    const user = userEvent.setup();

    render(
      <EventProvider
        repository={repository}
        now={() => "2026-08-14T01:00:00.000Z"}
        createId={() => "provider-command"}
        publishCommittedEvent={published}
      >
        <ProviderProbe />
      </EventProvider>,
    );

    expect(screen.getByText("Loading local event")).toBeTruthy();
    await screen.findByText("Event: Nine-Car Community Demo");
    expect(screen.getByText("Storage: not-requested")).toBeTruthy();
    expect(persist).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Record winner" }));
    await screen.findByText("Winner: car-03");
    expect(screen.getByText(/Receipt: Recorded winner car-03/)).toBeTruthy();
    expect(published).toHaveBeenCalledTimes(1);
    expect((await repository.load())?.matches.find(({ id }) => id === "pre-m02-h03")?.winnerEntryId).toBe(
      "car-03",
    );

    await user.click(screen.getByRole("button", { name: "Persist storage" }));
    await waitFor(() => expect(screen.getByText("Storage: granted")).toBeTruthy());
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("does not publish a failed provider command", async () => {
    await repository.save(eventFixture(), bootstrapRevision());
    database.snapshots.hook("creating", () => {
      throw new Error("Provider transaction failed");
    });
    const published = vi.fn();
    let dispatch: ReturnType<typeof useEventState>["dispatchEventCommand"] | undefined;

    function CaptureDispatch() {
      dispatch = useEventState().dispatchEventCommand;
      return null;
    }

    render(
      <EventProvider repository={repository} publishCommittedEvent={published}>
        <CaptureDispatch />
      </EventProvider>,
    );
    await waitFor(() => expect(dispatch).toBeTypeOf("function"));

    await act(async () => {
      await expect(
        dispatch!({
          type: "result.record-winner",
          heatId: "pre-m02-h03",
          carId: "car-03",
        }),
      ).rejects.toThrow("Provider transaction failed");
    });
    expect(published).not.toHaveBeenCalled();
  });
});
