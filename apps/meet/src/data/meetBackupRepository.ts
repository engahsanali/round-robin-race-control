import { parseMeetBackup, serializeMeetBackup, type PortableHostedMeetBundle } from "@rr3/meet-domain";
import type { DataPort, PortError, RepositoryFailureKind } from "./meetRepository";

export type BackupReceipt<T> =
  | { ok: true; value: T; requestId?: string }
  | { ok: false; kind: RepositoryFailureKind; message: string; committed: "no"; statePreserved: true; requestId?: string }
  | { ok: false; kind: RepositoryFailureKind; message: string; committed: "unknown"; requestId: string; retry: { requestId: string } };
export type MeetRevisionKind = "manual" | "pre_restore" | "imported_source";
export type MeetRevisionSummary = {
  id: string; organisationId: string; meetId: string; sequence: number; kind: MeetRevisionKind;
  sourceMeetVersion: number; label: string; reason: string; payloadSha256: string; createdBy: string; createdAt: string;
};
export type MeetRevisionPreview = { revisionId: string; meetId: string; sourceMeetVersion: number; manifest: Record<string, unknown> };

export class MeetBackupRepository {
  constructor(private readonly port: DataPort) {}

  async exportBackup(
    organisationId: string,
    meetId: string,
    expectedVersion: number,
    options: { exportedAt: string; applicationVersion: string },
  ): Promise<BackupReceipt<string>> {
    const response = await this.call<PortableHostedMeetBundle>("export_meet_bundle", {
      target_organisation_id: organisationId, target_meet_id: meetId, expected_version: expectedVersion,
    });
    if (!response.ok) return response;
    try { return { ok: true, value: await serializeMeetBackup(response.value, options) }; }
    catch { return failure("validation", "The server returned an invalid meet graph for export."); }
  }

  async createCheckpoint(organisationId: string, meetId: string, expectedVersion: number, label: string, reason: string, requestId: string): Promise<BackupReceipt<{ revisionId: string; sequence: number; meetId: string }>> {
    try {
      return await this.mutate<{ revision_id: string; sequence: number; meet_id: string }, { revisionId: string; sequence: number; meetId: string }>("create_meet_revision", {
        target_organisation_id: organisationId, target_meet_id: meetId, expected_version: expectedVersion,
        revision_kind: "manual", revision_label: normalizeLabel(label), revision_reason: normalizeReason(reason), request_id: requestId,
      }, requestId, (value) => ({ revisionId: asString(value.revision_id), sequence: asPositiveInteger(value.sequence), meetId: asString(value.meet_id) }));
    } catch { return failure("validation", "A checkpoint label and reason within the allowed limits are required.", requestId); }
  }

  async listRevisions(organisationId: string, meetId: string, page: { limit?: number; beforeSequence?: number | null } = {}): Promise<MeetRevisionSummary[]> {
    const pageSize = Math.min(100, Math.max(1, page.limit ?? 50));
    const response = await this.call<Record<string, unknown>[]>("list_meet_revisions", {
      target_organisation_id: organisationId, target_meet_id: meetId, page_size: pageSize, before_sequence: page.beforeSequence ?? null,
    });
    if (!response.ok) throw new Error(response.message);
    return response.value.map((row) => ({
      id: asString(row.id), organisationId: asString(row.organisation_id), meetId: asString(row.meet_id),
      sequence: asPositiveInteger(row.sequence), kind: asRevisionKind(row.kind), sourceMeetVersion: asPositiveInteger(row.source_meet_version),
      label: asString(row.label), reason: asString(row.reason), payloadSha256: asString(row.payload_sha256),
      createdBy: asString(row.created_by), createdAt: asString(row.created_at),
    }));
  }

  async previewRevision(organisationId: string, revisionId: string): Promise<MeetRevisionPreview> {
    const response = await this.call<Record<string, unknown>>("preview_meet_revision", { target_organisation_id: organisationId, revision_id: revisionId });
    if (!response.ok) throw new Error(response.message);
    return {
      revisionId: asString(response.value.revision_id), meetId: asString(response.value.meet_id),
      sourceMeetVersion: asPositiveInteger(response.value.source_meet_version), manifest: isRecord(response.value.manifest) ? response.value.manifest : {},
    };
  }

  async importAsNewMeet(organisationId: string, text: string, reason: string, confirmed: boolean, requestId: string): Promise<BackupReceipt<{ meetId: string; sourceRevisionId: string; version: number }>> {
    const parsed = await parseMeetBackup(text);
    if (!parsed.ok) return failure("validation", "The portable backup failed validation and was not imported.", requestId);
    try {
      return await this.mutate<{ meet_id: string; source_revision_id: string; version: number }, { meetId: string; sourceRevisionId: string; version: number }>("import_meet_backup", {
        target_organisation_id: organisationId, backup: parsed.data, reason: normalizeReason(reason), confirm_import: confirmed, request_id: requestId,
      }, requestId, importReceipt);
    } catch { return failure("validation", "A recovery reason within the allowed limits is required.", requestId); }
  }

  async restoreRevisionAsNewMeet(organisationId: string, revisionId: string, reason: string, confirmed: boolean, requestId: string): Promise<BackupReceipt<{ meetId: string; sourceRevisionId: string; version: number }>> {
    try {
      return await this.mutate<{ meet_id: string; source_revision_id: string; version: number }, { meetId: string; sourceRevisionId: string; version: number }>("restore_meet_revision_copy", {
        target_organisation_id: organisationId, revision_id: revisionId, reason: normalizeReason(reason), confirm_restore: confirmed, request_id: requestId,
      }, requestId, importReceipt);
    } catch { return failure("validation", "A recovery reason within the allowed limits is required.", requestId); }
  }

  private async call<T>(name: string, args: Record<string, unknown>, mutationRequestId?: string): Promise<BackupReceipt<T>> {
    try {
      const response = await this.port.rpc<T>(name, args);
      if (response.error || response.data === null) {
        const kind = mapError(response.error);
        if (mutationRequestId && (kind === "network" || kind === "offline")) return uncertainFailure(kind, "The recovery request may have committed before the transport error. Retry only with the same request ID.", mutationRequestId);
        return failure(kind, safeMessage(response.error), mutationRequestId);
      }
      return { ok: true, value: response.data };
    } catch {
      if (mutationRequestId) return uncertainFailure("network", "The recovery request may have committed before the connection was lost. Retry only with the same request ID.", mutationRequestId);
      return failure("network", "The hosted service is unreachable. The current meet was preserved.");
    }
  }

  private async mutate<TRaw, TValue>(name: string, args: Record<string, unknown>, requestId: string, map: (value: TRaw) => TValue): Promise<BackupReceipt<TValue>> {
    const response = await this.call<TRaw>(name, args, requestId);
    if (!response.ok) return response;
    try { return { ok: true, value: map(response.value), requestId }; }
    catch { return uncertainFailure("validation", "The server returned an invalid recovery receipt. Resolve it by retrying with the same request ID.", requestId); }
  }
}

function importReceipt(value: { meet_id: string; source_revision_id: string; version: number }) { return { meetId: asString(value.meet_id), sourceRevisionId: asString(value.source_revision_id), version: asPositiveInteger(value.version) }; }
function normalizeReason(value: string): string { const normalized = value.trim(); if (normalized.length < 1 || normalized.length > 500) throw new Error("A reason between 1 and 500 characters is required."); return normalized; }
function normalizeLabel(value: string): string { const normalized = value.trim(); if (normalized.length < 1 || normalized.length > 200) throw new Error("A label between 1 and 200 characters is required."); return normalized; }
function asString(value: unknown): string { if (typeof value !== "string" || value.length === 0) throw new Error("Invalid string"); return value; }
function asPositiveInteger(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid integer"); return value; }
function asRevisionKind(value: unknown): MeetRevisionKind { if (value !== "manual" && value !== "pre_restore" && value !== "imported_source") throw new Error("Invalid revision kind"); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function mapError(error: PortError | null): RepositoryFailureKind { const message = `${error?.code ?? ""} ${error?.message ?? ""}`; if (/FORBIDDEN|permission|row-level security/i.test(message)) return "permission"; if (/VERSION_CONFLICT|REVISION_CONFLICT/i.test(message)) return "conflict"; if (/INVALID|HASH|GRAPH|CONFIRM|REASON|NOT_FOUND/i.test(message)) return "validation"; if (/offline/i.test(message)) return "offline"; if (/network|fetch/i.test(message)) return "network"; return "unknown"; }
function safeMessage(error: PortError | null): string { const kind = mapError(error); if (kind === "permission") return "Your role does not allow this recovery operation."; if (kind === "conflict") return "The meet changed before recovery could complete. Refresh and review the authoritative version."; if (kind === "validation") return "The server rejected invalid recovery data."; if (kind === "offline" || kind === "network") return "The hosted service is unreachable. The current meet was preserved."; return "The hosted recovery operation failed safely."; }
function failure(kind: RepositoryFailureKind, message: string, requestId?: string): { ok: false; kind: RepositoryFailureKind; message: string; committed: "no"; statePreserved: true; requestId?: string } { return { ok: false, kind, message, committed: "no", statePreserved: true, ...(requestId ? { requestId } : {}) }; }
function uncertainFailure(kind: RepositoryFailureKind, message: string, requestId: string): { ok: false; kind: RepositoryFailureKind; message: string; committed: "unknown"; requestId: string; retry: { requestId: string } } { return { ok: false, kind, message, committed: "unknown", requestId, retry: { requestId } }; }
