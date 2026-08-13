import "fake-indexeddb/auto";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateEventState, type EventStateV1 } from "@rr3/domain";
import demoEventJson from "../../../../../fixtures/demo-event.json";
import { createProDatabase, type ProDatabase } from "../../persistence/db";
import { EventRepository } from "../../persistence/repository";
import { EventProvider } from "../../state/EventProvider";
import { WhatIfSandbox } from "./WhatIfSandbox";

let database: ProDatabase;
let repository: EventRepository;
let sequence = 0;

function fixture(): EventStateV1 {
  const result = validateEventState(structuredClone(demoEventJson));
  if (!result.success) throw new Error("Demo must validate");
  return result.data;
}

beforeEach(async () => {
  sequence += 1;
  database = createProDatabase(`rr3-pro-what-if-${sequence}`);
  repository = new EventRepository(database);
  await repository.save(fixture(), { commandId: `what-if-${sequence}`, timestamp: "2026-08-14T08:00:00.000Z", summary: "What-if fixture" });
});

afterEach(async () => { cleanup(); database.close(); await database.delete(); });

describe("WhatIfSandbox", () => {
  it("projects shared-command rankings from a deep clone and resets without persistence or audit mutation", async () => {
    const user = userEvent.setup();
    render(<EventProvider repository={repository}><WhatIfSandbox /></EventProvider>);
    await screen.findByRole("heading", { name: "What-if Sandbox" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Hypothetical heat" }), "pre-m02-h03");
    await user.selectOptions(screen.getByRole("combobox", { name: "Hypothetical winner" }), "car-06");
    await user.click(screen.getByRole("button", { name: "Run what-if" }));

    const result = screen.getByRole("region", { name: "What-if — not official" });
    expect(result.textContent).toMatch(/What-if — not official/);
    expect(within(result).getByRole("row", { name: /Car 6/ }).textContent).toMatch(/1 win/);
    const stored = await repository.load();
    expect(stored?.matches.find(({ id }) => id === "pre-m02-h03")?.status).toBe("scheduled");
    expect(stored?.auditLog).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Reset what-if" }));
    expect(screen.queryByRole("region", { name: "What-if — not official" })).toBeNull();
  });
});
