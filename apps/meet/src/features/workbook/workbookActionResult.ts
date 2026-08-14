import type { WorkbookActionResult } from "./WorkbookWorkspace";

export type CommittedReceipt = {
  ok: boolean;
  message?: string;
  advisory?: { message: string } | null;
};

export async function finishCommittedWorkbookAction(
  receipt: CommittedReceipt,
  refresh: (() => Promise<boolean>) | null,
  successMessage = "Saved with an official audit receipt.",
): Promise<WorkbookActionResult> {
  if (!receipt.ok) return { ok: false, message: receipt.message ?? "The change was not saved." };
  if (refresh && !(await refresh())) {
    return { ok: true, message: "Change committed successfully, but the latest view could not be refreshed. This screen may be stale; reconnect and refresh before the next official action." };
  }
  return { ok: true, message: receipt.advisory?.message ?? successMessage };
}
