import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AdvancementHistory } from "../../data/meetRepository";
import { makeMeet } from "../../test/workbookFixtures";
import { AdvancementPanel, type AdvancementCommitInput } from "./AdvancementPanel";
import { confirmAdvancementPure } from "@rr3/meet-domain";

function progression(topN = 3, destinations = 1) {
  const meet = makeMeet(destinations + 1, 3);
  const source = meet.brackets[0]!;
  const targets = meet.brackets.slice(1);
  targets.forEach((target, index) => { target.stage = "final"; target.name = `Final ${index + 1}`; target.event.entries = []; target.event.participants = []; });
  source.event.matches = [{
    id: "heat-source", phase: "preliminary", matchNumber: 1, heatNumber: 1,
    lanes: [source.event.entries[0]!.id, source.event.entries[1]!.id, source.event.entries[2]!.id],
    status: "completed", winnerEntryId: source.event.entries[0]!.id, laneTimesMs: [1000, 1100, 1200], notes: "",
  }];
  meet.advancementRules = [{
    id: "rule-source", version: 7, sourceBracketId: source.id,
    destinationBracketIds: targets.map((target) => target.id), destinationOrder: targets.map((target) => target.id),
    topN, destinationCapacity: 6, status: "active",
  }];
  return meet;
}

const emptyHistory: AdvancementHistory = { snapshots: [], selections: [] };

describe("AdvancementPanel", () => {
  it("shows safe read-only current, superseded and stale advancement history with placements", () => {
    const meet = progression(3);
    const source = meet.brackets[0]!;
    const destination = meet.brackets[1]!;
    const selected = source.event.entries[0]!;
    const history: AdvancementHistory = {
      snapshots: [
        { id: "snapshot-old", ruleId: "rule-source", sourceBracketId: source.id, sourceResultVersion: 1, stale: true, replacedBySnapshotId: "snapshot-current", confirmedBy: "official-1", reason: "Result appealed <script>alert(1)</script>", confirmedAt: "2026-08-14T09:00:00Z" },
        { id: "snapshot-current", ruleId: "rule-source", sourceBracketId: source.id, sourceResultVersion: 2, stale: false, replacedBySnapshotId: null, confirmedBy: "official-2", reason: "Finish-line review", confirmedAt: "2026-08-14T10:00:00Z" },
      ],
      selections: [
        { id: "selection-old", snapshotId: "snapshot-old", ruleId: "rule-source", sourceBracketId: source.id, sourceCarId: selected.id, destinationBracketId: destination.id, destinationCarId: null, rank: 1 },
        { id: "selection-current", snapshotId: "snapshot-current", ruleId: "rule-source", sourceBracketId: source.id, sourceCarId: selected.id, destinationBracketId: destination.id, destinationCarId: null, rank: 1 },
      ],
    };
    render(<AdvancementPanel meet={meet} history={history} canManage={false} onCommit={async () => ({ ok: false, message: "Read-only" })} />);

    const summary = screen.getByRole("region", { name: /qualifier 1 advancement history/i });
    expect(summary.textContent).toMatch(/Current.*Finish-line review/i);
    expect(summary.textContent).toMatch(/Superseded.*stale.*Result appealed <script>alert\(1\)<\/script>/i);
    expect(summary.textContent).toMatch(/Qualifier 1.*#1.*Car 1.*rank 1.*Final 1/i);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a versioned automatic preview and explicitly confirms balanced destination placements", async () => {
    const meet = progression(3, 2);
    const commits: AdvancementCommitInput[] = [];
    render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onCommit={async (input) => { commits.push(input); return { ok: true, message: "Confirmed" }; }} />);

    const rule = screen.getByRole("article", { name: /qualifier 1 advancement/i });
    expect(rule.textContent).toContain("Source version1");
    expect(rule.textContent).toContain("Rule version7");
    expect(rule.textContent).toContain("Ready");
    await userEvent.click(within(rule).getByRole("button", { name: /review advancement/i }));
    const dialog = screen.getByRole("dialog", { name: /confirm advancement/i });
    expect(within(dialog).getAllByText(/Final 1|Final 2/).length).toBeGreaterThanOrEqual(3);
    await userEvent.click(within(dialog).getByRole("button", { name: /^confirm advancement$/i }));

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ ruleId: "rule-source", sourceResultVersion: 1, expectedVersion: 7, mode: "confirm", reason: null });
    expect(commits[0]?.selections.map((selection) => selection.destinationBracketId)).toEqual([
      meet.brackets[1]!.id, meet.brackets[2]!.id, meet.brackets[1]!.id,
    ]);
  });

  it("locks automatic qualifiers and requires the exact tied-cutoff choice plus a trimmed reason", async () => {
    const meet = progression(2);
    const onCommit = vi.fn(async () => ({ ok: true, message: "Confirmed" }));
    render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onCommit={onCommit} />);
    expect(screen.getByText(/Tie decision · 1 place remains/i)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /review advancement/i }));
    const dialog = screen.getByRole("dialog", { name: /resolve tied cutoff/i });
    expect(within(dialog).getByText(/1 automatic qualifier locked/i)).not.toBeNull();
    const confirm = within(dialog).getByRole("button", { name: /confirm advancement/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await userEvent.click(within(dialog).getAllByRole("checkbox")[0]!);
    await userEvent.type(within(dialog).getByLabelText(/decision reason/i), "  Cutoff playoff result  ");
    expect(confirm.hasAttribute("disabled")).toBe(false);
    await userEvent.click(confirm);
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ reason: "Cutoff playoff result", selections: expect.arrayContaining([expect.objectContaining({ rank: 2 })]) }));
  });

  it("defers a tie without mutating and blocks disabled, stale and capacity-conflicted rules", async () => {
    const meet = progression(2);
    const onCommit = vi.fn();
    render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: /review advancement/i }));
    await userEvent.click(screen.getByRole("button", { name: /defer for playoff/i }));
    expect(onCommit).not.toHaveBeenCalled();

    meet.advancementRules[0]!.status = "disabled";
    const { rerender } = render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onCommit={onCommit} />);
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /review advancement/i }).at(-1)?.hasAttribute("disabled")).toBe(true);
    rerender(<AdvancementPanel meet={{ ...meet, advancementRules: [{ ...meet.advancementRules[0]!, status: "active", destinationCapacity: 0 }] }} history={emptyHistory} canManage onCommit={onCommit} />);
    expect(screen.getByText(/Capacity conflict/i)).not.toBeNull();
  });

  it("requires reasoned replacement for a confirmed or stale snapshot and links its source bracket", async () => {
    const meet = progression(3);
    const rule = meet.advancementRules[0]!;
    const source = meet.brackets[0]!;
    meet.advancementSnapshots = [{ id: "snapshot-current", ruleId: rule.id, sourceBracketId: source.id, sourceResultVersion: source.version, selections: [], confirmedBy: "official", reason: null, confirmedAt: "2026-08-14T10:00:00Z", stale: true }];
    const history: AdvancementHistory = { snapshots: [{ id: "snapshot-current", ruleId: rule.id, sourceBracketId: source.id, sourceResultVersion: source.version, stale: true, replacedBySnapshotId: null, confirmedBy: "official", reason: null, confirmedAt: "2026-08-14T10:00:00Z" }], selections: [] };
    const navigate = vi.fn();
    render(<AdvancementPanel meet={meet} history={history} canManage onNavigateBracket={navigate} onCommit={async () => ({ ok: true, message: "Reconfirmed" })} />);
    expect(screen.getByText(/Upstream stale/i)).not.toBeNull();
    await userEvent.click(screen.getByRole("link", { name: /open qualifier 1/i }));
    expect(navigate).toHaveBeenCalledWith(source.id);
    await userEvent.click(screen.getByRole("button", { name: /review and reconfirm/i }));
    const replace = screen.getByRole("button", { name: /replace advancement/i });
    expect(replace.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText(/reconfirmation reason/i), "Upstream result corrected");
    expect(replace.hasAttribute("disabled")).toBe(false);
  });

  it("submits a reasoned replacement against the exact current snapshot", async () => {
    const initial = progression(3);
    const meet = confirmAdvancementPure(initial, "rule-source", { actorId: "official", confirmedAt: "2026-08-14T10:00:00Z" });
    const snapshot = meet.advancementSnapshots[0]!;
    const history: AdvancementHistory = { snapshots: [{ id: snapshot.id, ruleId: snapshot.ruleId, sourceBracketId: snapshot.sourceBracketId, sourceResultVersion: snapshot.sourceResultVersion, stale: false, replacedBySnapshotId: null, confirmedBy: snapshot.confirmedBy, reason: snapshot.reason, confirmedAt: snapshot.confirmedAt }], selections: snapshot.selections.map((selection, index) => ({ id: `selection-${index}`, snapshotId: snapshot.id, ruleId: snapshot.ruleId, sourceBracketId: snapshot.sourceBracketId, sourceCarId: selection.sourceCarId, destinationBracketId: selection.destinationBracketId, destinationCarId: null, rank: selection.rank })) };
    const onCommit = vi.fn(async () => ({ ok: true, message: "Replaced" }));
    render(<AdvancementPanel meet={meet} history={history} canManage onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: /review and reconfirm/i }));
    await userEvent.type(screen.getByLabelText(/reconfirmation reason/i), "Rechecked after appeal");
    await userEvent.click(screen.getByRole("button", { name: /replace advancement/i }));
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ mode: "replace", ruleId: "rule-source", reason: "Rechecked after appeal", selections: snapshot.selections }));
  });

  it("reconfirms a stale named snapshot without bypassing the reason gate", async () => {
    const confirmed = confirmAdvancementPure(progression(3), "rule-source", { actorId: "official", confirmedAt: "2026-08-14T10:00:00Z" });
    const snapshot = { ...confirmed.advancementSnapshots[0]!, stale: true };
    const meet = { ...confirmed, advancementSnapshots: [snapshot] };
    const history: AdvancementHistory = { snapshots: [{ id: snapshot.id, ruleId: snapshot.ruleId, sourceBracketId: snapshot.sourceBracketId, sourceResultVersion: snapshot.sourceResultVersion, stale: true, replacedBySnapshotId: null, confirmedBy: snapshot.confirmedBy, reason: snapshot.reason, confirmedAt: snapshot.confirmedAt }], selections: [] };
    const onCommit = vi.fn(async () => ({ ok: true, message: "Reconfirmed" }));
    render(<AdvancementPanel meet={meet} history={history} canManage onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: /review and reconfirm/i }));
    const replace = screen.getByRole("button", { name: /replace advancement/i });
    expect(replace.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText(/reconfirmation reason/i), "Latest source results reviewed");
    await userEvent.click(replace);
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ mode: "replace", sourceResultVersion: 1, reason: "Latest source results reviewed" }));
  });

  it("locks a pending confirmation and keeps the conflict available for authoritative refresh", async () => {
    const meet = progression(3);
    let finish: ((value: { ok: false; message: string }) => void) | undefined;
    const onCommit = vi.fn(() => new Promise<{ ok: false; message: string }>((resolve) => { finish = resolve; }));
    render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onCommit={onCommit} />);
    await userEvent.click(screen.getByRole("button", { name: /review advancement/i }));
    const confirm = screen.getByRole("button", { name: /^confirm advancement$/i });
    await userEvent.click(confirm);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(confirm.hasAttribute("disabled")).toBe(true);
    finish?.({ ok: false, message: "Another official changed this rule. Refresh before retrying." });
    expect(await screen.findByText(/another official changed this rule/i)).not.toBeNull();
    expect(screen.getByRole("dialog", { name: /confirm advancement/i })).not.toBeNull();
  });

  it("shows an awaiting state and disables confirmation before source results are complete", () => {
    const meet = progression(3);
    meet.brackets[0]!.event.matches[0]!.status = "scheduled";
    meet.brackets[0]!.event.matches[0]!.winnerEntryId = null;
    render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onCommit={async () => ({ ok: true, message: "Unexpected" })} />);
    expect(screen.getByText(/awaiting results/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: /review advancement/i }).hasAttribute("disabled")).toBe(true);
  });

  it("never lets a viewer open either a new confirmation or a current-snapshot reconfirmation", async () => {
    const onCommit = vi.fn(async () => ({ ok: true, message: "Unexpected" }));
    const unconfirmed = progression(3);
    const view = render(<AdvancementPanel meet={unconfirmed} history={emptyHistory} canManage={false} onCommit={onCommit} />);
    const confirm = screen.getByRole("button", { name: /review advancement/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await userEvent.click(confirm);
    expect(screen.queryByRole("dialog")).toBeNull();

    const confirmed = confirmAdvancementPure(unconfirmed, "rule-source", { actorId: "official", confirmedAt: "2026-08-14T10:00:00Z" });
    view.rerender(<AdvancementPanel meet={confirmed} history={emptyHistory} canManage={false} onCommit={onCommit} />);
    const reconfirm = screen.getByRole("button", { name: /review and reconfirm/i });
    expect(reconfirm.hasAttribute("disabled")).toBe(true);
    await userEvent.click(reconfirm);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("registers a keyed advancement draft and clears it on cancel, success and unmount", async () => {
    const dirty = vi.fn();
    const meet = progression(2);
    const onCommit = vi.fn(async () => ({ ok: true, message: "Confirmed" }));
    const view = render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onDirtyChange={dirty} onCommit={onCommit} />);

    await userEvent.click(screen.getByRole("button", { name: /review advancement/i }));
    expect(dirty).toHaveBeenLastCalledWith("advancement:rule-source", true);
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(dirty).toHaveBeenLastCalledWith("advancement:rule-source", false);

    await userEvent.click(screen.getByRole("button", { name: /review advancement/i }));
    await userEvent.click(screen.getAllByRole("checkbox")[0]!);
    await userEvent.type(screen.getByLabelText(/decision reason/i), "Cutoff playoff result");
    await userEvent.click(screen.getByRole("button", { name: /^confirm advancement$/i }));
    expect(dirty).toHaveBeenLastCalledWith("advancement:rule-source", false);

    view.unmount();
    const unresolved = render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onDirtyChange={dirty} onCommit={onCommit} />);
    await userEvent.click(within(unresolved.container).getByRole("button", { name: /review advancement/i }));
    unresolved.unmount();
    expect(dirty).toHaveBeenLastCalledWith("advancement:rule-source", false);
  });

  it("blocks a current replacement when a named transitive upstream snapshot is stale", () => {
    const meet = progression(3);
    const source = meet.brackets[0]!;
    const current = { id: "snapshot-current", ruleId: "rule-source", sourceBracketId: source.id, sourceResultVersion: source.version, selections: [], confirmedBy: "official", reason: null, confirmedAt: "2026-08-14T10:00:00Z", stale: false };
    const upstream = { id: "snapshot-upstream", ruleId: "rule-upstream", sourceBracketId: source.id, sourceResultVersion: source.version, selections: [], confirmedBy: "official", reason: null, confirmedAt: "2026-08-14T09:00:00Z", stale: true };
    source.lineage = [{ sourceBracketId: source.id, sourceCarId: source.event.entries[0]!.id, ruleId: upstream.ruleId, snapshotId: upstream.id }];
    meet.advancementSnapshots = [upstream, current];

    render(<AdvancementPanel meet={meet} history={emptyHistory} canManage onCommit={async () => ({ ok: true, message: "Unexpected" })} />);
    const advisory = screen.getByRole("alert");
    expect(advisory.textContent).toMatch(/Qualifier 1.*upstream.*refresh.*reconfirm/i);
    expect(within(advisory).getByRole("link", { name: /open qualifier 1/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /review and reconfirm/i }).hasAttribute("disabled")).toBe(true);
  });
});
