import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeMeetBackup } from "@rr3/meet-domain";
import type { MeetBackupRepository } from "../../data/meetBackupRepository";
import { createDemoMeetBundle } from "../demo/demoMeet";
import { BackupDrawer } from "./BackupDrawer";

function repository(overrides: Record<string, unknown> = {}): MeetBackupRepository {
  return {
    exportBackup: async () => ({ ok: true, value: "{\"backup\":true}\n" }),
    listRevisions: async () => [], previewRevision: async () => ({ revisionId: "revision-1", meetId: "meet-1", sourceMeetVersion: 4, manifest: { bracketCount: 7, carCount: 66 } }),
    importAsNewMeet: async (_organisationId: string, _text: string, _reason: string, _confirmed: boolean, requestId: string) => ({ ok: true, value: { meetId: "imported-meet", sourceRevisionId: "source", version: 1 }, requestId }),
    restoreRevisionAsNewMeet: async (_organisationId: string, _revisionId: string, _reason: string, _confirmed: boolean, requestId: string) => ({ ok: true, value: { meetId: "restored-meet", sourceRevisionId: "revision-1", version: 1 }, requestId }),
    ...overrides,
  } as unknown as MeetBackupRepository;
}

describe("BackupDrawer", () => {
  afterEach(() => vi.restoreAllMocks());
  it("downloads a deterministic validated backup through the hosted adapter", async () => {
    const exportBackup = vi.fn(async () => ({ ok: true as const, value: "{\"portable\":true}\n" }));
    const download = vi.fn();
    const bundle = createDemoMeetBundle();
    render(<BackupDrawer open organisationId="org-1" bundle={bundle} repository={repository({ exportBackup })} onClose={() => undefined} onImported={() => undefined} onDownload={download} />);
    await userEvent.click(screen.getByRole("button", { name: /download current meet backup/i }));
    expect(exportBackup).toHaveBeenCalledWith("org-1", bundle.state.meet.id, 8, { exportedAt: bundle.state.meet.updatedAt, applicationVersion: "0.1.0" });
    expect(download).toHaveBeenCalledWith({ name: "demo-championship-meet-2026-08-14-v8.rr3-meet-backup.json", type: "application/json", text: "{\"portable\":true}\n" });
  });

  it("revokes the backup object URL and reports failure when the browser download click throws", async () => {
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const createUrl = vi.fn(() => "blob:backup"); const revokeUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
    try {
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("blocked download"); });
      render(<BackupDrawer open organisationId="org-1" bundle={createDemoMeetBundle()} repository={repository()} onClose={() => undefined} onImported={() => undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /download current meet backup/i })).catch(() => undefined);
      expect(createUrl).toHaveBeenCalledOnce();
      expect(revokeUrl).toHaveBeenCalledWith("blob:backup");
      expect((await screen.findByRole("alert")).textContent).toMatch(/download could not start/i);
    } finally {
      createDescriptor ? Object.defineProperty(URL, "createObjectURL", createDescriptor) : delete (URL as unknown as Record<string, unknown>).createObjectURL;
      revokeDescriptor ? Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor) : delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    }
  });

  it("rejects a tampered import during preview and preserves the current meet", async () => {
    const bundle = createDemoMeetBundle();
    const before = JSON.stringify(bundle);
    const adapter = repository({ importAsNewMeet: vi.fn() });
    render(<BackupDrawer open organisationId="org-1" bundle={bundle} repository={adapter} onClose={() => undefined} onImported={() => undefined} />);

    await userEvent.upload(screen.getByLabelText(/choose meet backup or compatible event json/i), new File(["{bad json"], "tampered.json", { type: "application/json" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not valid json/i);
    expect(screen.queryByRole("button", { name: /import as new meet/i })).toBeNull();
    expect(adapter.importAsNewMeet).not.toHaveBeenCalled();
    expect(JSON.stringify(bundle)).toBe(before);
  });

  it("previews counts and warnings, then imports a validated file only as a new meet with reason and confirmation", async () => {
    const source = createDemoMeetBundle();
    const text = await serializeMeetBackup(source, { exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" });
    const importAsNewMeet = vi.fn(async (_organisationId: string, _portable: string, _reason: string, _confirmed: boolean, requestId: string) => ({ ok: true as const, value: { meetId: "new-meet", sourceRevisionId: "source", version: 1 }, requestId }));
    const dirty = vi.fn();
    const imported = vi.fn();
    render(<BackupDrawer open organisationId="org-1" bundle={source} repository={repository({ importAsNewMeet })} onDirtyChange={dirty} onClose={() => undefined} onImported={imported} />);

    await userEvent.upload(screen.getByLabelText(/choose meet backup or compatible event json/i), new File([text], "meet.json", { type: "application/json" }));
    const preview = await screen.findByRole("region", { name: /import preview/i });
    expect(preview.textContent).toMatch(/7 brackets.*66 cars/i);
    expect(preview.textContent).toMatch(/creates a new meet/i);
    expect(dirty).toHaveBeenLastCalledWith("backup:import", true);
    const importButton = within(preview).getByRole("button", { name: /import as new meet/i });
    expect(importButton.hasAttribute("disabled")).toBe(true);
    await userEvent.type(within(preview).getByLabelText(/import reason/i), "Verified recovery rehearsal");
    await userEvent.click(within(preview).getByRole("checkbox", { name: /create a separate new meet/i }));
    await userEvent.click(importButton);

    expect(importAsNewMeet).toHaveBeenCalledWith("org-1", expect.any(String), "Verified recovery rehearsal", true, expect.any(String));
    expect(imported).toHaveBeenCalledWith("new-meet");
    expect(dirty).toHaveBeenLastCalledWith("backup:import", false);
  });

  it("shows revision source version and requires a reasoned confirmed restore copy", async () => {
    const restore = vi.fn(async (_organisationId: string, _revisionId: string, _reason: string, _confirmed: boolean, requestId: string) => ({ ok: true as const, value: { meetId: "restored-meet", sourceRevisionId: "revision-1", version: 1 }, requestId }));
    const adapter = repository({
      listRevisions: async () => [{ id: "revision-1", organisationId: "org-1", meetId: "meet-1", sequence: 3, kind: "manual", sourceMeetVersion: 4, label: "Before finals", reason: "Safety checkpoint", payloadSha256: "a".repeat(64), createdBy: "official", createdAt: "2026-08-14T11:00:00Z" }],
      previewRevision: async () => ({ revisionId: "revision-1", meetId: "meet-1", sourceMeetVersion: 4, manifest: { bracketCount: 6, carCount: 60, heatCount: 8, ruleCount: 5, auditEventCount: 1 } }),
      restoreRevisionAsNewMeet: restore,
    });
    render(<BackupDrawer open organisationId="org-1" bundle={createDemoMeetBundle()} repository={adapter} onClose={() => undefined} onImported={() => undefined} />);
    const review = await screen.findByRole("button", { name: /review restore before finals/i });
    await userEvent.click(review);
    const preview = await screen.findByRole("region", { name: /revision restore preview/i });
    expect(document.activeElement).toBe(preview);
    expect(preview.textContent).toMatch(/source meet version 4/i);
    expect(preview.textContent).toMatch(/Brackets.*6.*-1 from current/i);
    expect(preview.textContent).toMatch(/Cars.*60.*-6 from current/i);
    expect(preview.textContent).toMatch(/Heats.*8.*-1 from current/i);
    await userEvent.tab();
    expect(document.activeElement).toBe(within(preview).getByLabelText(/restore reason/i));
    await userEvent.type(within(preview).getByLabelText(/restore reason/i), "Create a rerun copy after appeal");
    await userEvent.click(within(preview).getByRole("checkbox", { name: /restore into a separate new meet/i }));
    await userEvent.click(within(preview).getByRole("button", { name: /restore as new meet/i }));
    expect(restore).toHaveBeenCalledWith("org-1", "revision-1", "Create a rerun copy after appeal", true, expect.any(String));
    await waitFor(() => expect(document.activeElement).toBe(review));
  });

  it("returns focus to the reviewed revision when its restore preview is cancelled", async () => {
    const adapter = repository({ listRevisions: async () => [{ id: "revision-1", organisationId: "org-1", meetId: "meet-1", sequence: 3, kind: "manual", sourceMeetVersion: 4, label: "Before finals", reason: "Safety checkpoint", payloadSha256: "a".repeat(64), createdBy: "official", createdAt: "2026-08-14T11:00:00Z" }] });
    render(<BackupDrawer open organisationId="org-1" bundle={createDemoMeetBundle()} repository={adapter} onClose={() => undefined} onImported={() => undefined} />);
    const review = await screen.findByRole("button", { name: /review restore before finals/i });
    await userEvent.click(review);
    await userEvent.click(await screen.findByRole("button", { name: /cancel revision restore/i }));
    expect(screen.queryByRole("region", { name: /revision restore preview/i })).toBeNull();
    expect(document.activeElement).toBe(review);
  });
});
