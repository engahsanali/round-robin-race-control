import { validateMeetState, type MeetStateV1 } from "@rr3/meet-domain";
import type { EventStateV1, JsonValue, TieBreakKey } from "@rr3/domain";

export type PortError = { message: string; code?: string };
export type FilterValue = string | number | boolean | null | readonly string[];
export type QueryRequest = {
  table: string;
  columns?: string;
  filters: Record<string, FilterValue>;
  order?: readonly { column: string; ascending?: boolean }[];
  signal?: AbortSignal;
};
export type RealtimeTarget = { table: string; filter: string };
export type RealtimeRequest = { channel: string; targets: readonly RealtimeTarget[] };

export interface DataPort {
  query<T>(request: QueryRequest): Promise<{ data: T[] | null; error: PortError | null }>;
  rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: PortError | null }>;
  subscribe(request: RealtimeRequest, onInvalidate: () => void, onStatus?: (status: ConnectionStatus) => void): () => void;
}

export type OrganisationRole = "owner" | "admin" | "organiser" | "marshal" | "viewer";
export type OrganisationSummary = { id: string; name: string; slug: string; role: OrganisationRole; version: number };
export type MeetSummary = { id: string; organisationId: string; name: string; venue: string; date: string; status: "setup" | "running" | "completed"; version: number };
export type TeamMember = { userId: string; role: OrganisationRole; displayName: string; email: string | null };
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "error";
export type RepositoryFailureKind = "permission" | "validation" | "conflict" | "offline" | "network" | "unknown";
export type CommandReceipt<T> =
  | { ok: true; value: T; requestId: string; advisory?: { kind: "readback"; message: string } }
  | { ok: false; kind: RepositoryFailureKind; message: string; requestId: string; statePreserved: true };
export type AdvancementHistorySnapshot = {
  id: string; ruleId: string; sourceBracketId: string; sourceResultVersion: number; stale: boolean;
  replacedBySnapshotId: string | null; confirmedBy: string; reason: string | null; confirmedAt: string;
};
export type AdvancementHistorySelection = {
  id: string; snapshotId: string; ruleId: string; sourceBracketId: string; sourceCarId: string;
  destinationBracketId: string; destinationCarId: string | null; rank: number;
};
export type AdvancementHistory = { snapshots: AdvancementHistorySnapshot[]; selections: AdvancementHistorySelection[] };
export type LoadReceipt = { ok: true; value: MeetStateV1; history: AdvancementHistory; heatVersions: Readonly<Record<string, number>> } | { ok: false; kind: RepositoryFailureKind; message: string };

const TABLES = [
  "meets", "brackets", "participants", "cars", "heats", "advancement_rules",
  "advancement_rule_destinations", "advancement_snapshots", "advancement_selections", "audit_events",
] as const;

export class MeetRepository {
  constructor(private readonly port: DataPort) {}

  async listOrganisations(userId: string, signal?: AbortSignal): Promise<OrganisationSummary[]> {
    const memberships = await this.port.query<Record<string, unknown>>({
      table: "organisation_memberships",
      filters: { user_id: userId, status: "active" },
      order: [{ column: "organisation_id" }], signal,
    });
    if (memberships.error) throw new Error(safeMessage(memberships.error));
    const membershipRows = memberships.data ?? [];
    const ids = membershipRows.map((row) => asString(row.organisation_id)).filter(Boolean);
    if (ids.length === 0) return [];
    const organisations = await this.port.query<Record<string, unknown>>({
      table: "organisations", filters: { id: ids }, order: [{ column: "name" }, { column: "id" }], signal,
    });
    if (organisations.error) throw new Error(safeMessage(organisations.error));
    const roles = new Map(membershipRows.map((row) => [asString(row.organisation_id), asRole(row.role)]));
    return (organisations.data ?? []).flatMap((row) => {
      const id = asString(row.id);
      const role = roles.get(id);
      return id && role ? [{ id, name: asString(row.name), slug: asString(row.slug), role, version: asInteger(row.version, 1) }] : [];
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async listMembers(organisationId: string): Promise<TeamMember[]> {
    const response = await this.port.rpc<Record<string, unknown>[]>("list_organisation_members", { target_organisation_id: organisationId });
    if (response.error) throw new Error(safeMessage(response.error));
    return (response.data ?? []).map((row) => ({
      userId: asString(row.user_id), role: asRole(row.role) ?? "viewer",
      displayName: asString(row.display_name), email: typeof row.email === "string" ? row.email : null,
    }));
  }

  async listMeets(organisationId: string, signal?: AbortSignal): Promise<MeetSummary[]> {
    const response = await this.port.query<Record<string, unknown>>({
      table: "meets",
      filters: { organisation_id: organisationId },
      order: [{ column: "meet_date", ascending: false }, { column: "name" }, { column: "id" }],
      signal,
    });
    if (response.error) throw new Error(safeMessage(response.error));
    return (response.data ?? []).flatMap((row) => row.organisation_id === organisationId ? [{
      id: asString(row.id), organisationId, name: asString(row.name), venue: asString(row.venue),
      date: asString(row.meet_date), status: asStatus(row.status), version: asInteger(row.version, 1),
    }] : []);
  }

  async loadMeet(organisationId: string, meetId: string, signal?: AbortSignal): Promise<LoadReceipt> {
    try {
      const meetScopedTables = ["meets", "brackets", "advancement_rules", "advancement_rule_destinations", "advancement_snapshots", "advancement_selections", "audit_events"] as const;
      const requests = meetScopedTables.map((table): QueryRequest => ({
        table,
        filters: {
          organisation_id: organisationId,
          ...(table === "meets" ? { id: meetId } : {}),
          ...(table !== "meets" ? { meet_id: meetId } : {}),
        },
        signal,
      }));
      const results = await Promise.all(requests.map((request) => this.port.query<Record<string, unknown>>(request)));
      const rows: Record<string, unknown[]> = {};
      for (let index = 0; index < meetScopedTables.length; index += 1) {
        const result = results[index];
        if (!result) return { ok: false, kind: "unknown", message: "Meet data response was incomplete." };
        if (result.error) return { ok: false, kind: mapError(result.error), message: safeMessage(result.error) };
        rows[meetScopedTables[index]!] = result.data ?? [];
      }
      const bracketIds = getRows(rows, "brackets").map((row) => asString(row.id)).filter(Boolean);
      if (bracketIds.length === 0) return { ok: false, kind: "validation", message: "The requested meet has no readable brackets." };
      const bracketOwnedTables = ["participants", "cars", "heats"] as const;
      const ownedResults = await Promise.all(bracketOwnedTables.map((table) => this.port.query<Record<string, unknown>>({
        table,
        filters: { organisation_id: organisationId, bracket_id: bracketIds },
        signal,
      })));
      for (let index = 0; index < bracketOwnedTables.length; index += 1) {
        const result = ownedResults[index];
        if (!result) return { ok: false, kind: "unknown", message: "Bracket data response was incomplete." };
        if (result.error) return { ok: false, kind: mapError(result.error), message: safeMessage(result.error) };
        rows[bracketOwnedTables[index]!] = result.data ?? [];
      }
      return hydrateMeetState(rows, organisationId, meetId);
    } catch (cause) {
      if (signal?.aborted) return { ok: false, kind: "offline", message: "Meet refresh was cancelled." };
      return { ok: false, kind: "network", message: safeUnknownMessage(cause) };
    }
  }

  async execute<T>(name: string, args: Record<string, unknown>, readback?: (value: T) => Promise<unknown>): Promise<CommandReceipt<T>> {
    const requestId = typeof args.request_id === "string" ? args.request_id : createRequestId();
    let response: { data: T | null; error: PortError | null };
    try {
      response = await this.port.rpc<T>(name, { ...args, request_id: requestId });
    } catch (cause) {
      const message = safeUnknownMessage(cause);
      return { ok: false, kind: /unreachable/i.test(message) ? "network" : "network", message, requestId, statePreserved: true };
    }
    if (response.error || response.data === null) {
      const error = response.error ?? { message: "Empty command response" };
      return { ok: false, kind: mapError(error), message: safeMessage(error), requestId, statePreserved: true };
    }
    if (readback) {
      try {
        await readback(response.data);
      } catch {
        return { ok: true, value: response.data, requestId, advisory: { kind: "readback", message: "The change committed, but the latest view could not be refreshed. Do not repeat the command." } };
      }
    }
    return { ok: true, value: response.data, requestId };
  }

  createOrganisation(name: string, slug: string, requestId = createRequestId()) {
    return this.execute<{ organisation_id: string; version: number }>("create_organisation", { name, slug, request_id: requestId }, (value) => this.readOne("organisations", { id: value.organisation_id }));
  }
  redeemInvitation(code: string, requestId = createRequestId()) {
    return this.execute<{ organisation_id: string; role: OrganisationRole }>("redeem_invitation", { invitation_code: code, request_id: requestId }, (value) => this.readOne("organisation_memberships", { organisation_id: value.organisation_id }));
  }
  createInvitation(organisationId: string, role: OrganisationRole, expiresAt: string, requestId = createRequestId()) {
    return this.execute<{ invitation_id: string; code: string | null; expires_at: string }>("create_invitation", { target_organisation_id: organisationId, invitation_role: role, invitation_expires_at: expiresAt, request_id: requestId }, (value) => this.readOne("organisation_invitations", { id: value.invitation_id }));
  }
  revokeInvitation(invitationId: string, requestId = createRequestId()) {
    return this.execute<{ invitation_id: string; revoked: boolean }>("revoke_invitation", { invitation_id: invitationId, request_id: requestId }, (value) => this.readOne("organisation_invitations", { id: value.invitation_id }));
  }
  removeMembership(organisationId: string, userId: string, reason: string, requestId = createRequestId()) {
    return this.execute<{ organisation_id: string; user_id: string; removed: boolean }>("remove_membership", { target_organisation_id: organisationId, target_user_id: userId, reason, request_id: requestId }, (value) => this.readOne("organisation_memberships", { organisation_id: value.organisation_id }));
  }
  saveMeetWorkbook(organisationId: string, meetId: string | null, expectedVersion: number | null, workbook: Record<string, unknown>, requestId = createRequestId()) {
    return this.execute<{ meet_id: string; version: number; bracket_count: number; rule_count: number }>("save_meet_workbook", { target_organisation_id: organisationId, target_meet_id: meetId, expected_version: expectedVersion, workbook, request_id: requestId }, (value) => this.readOne("meets", { id: value.meet_id, organisation_id: organisationId }));
  }
  saveRegistrationBatch(bracketId: string, expectedVersion: number, rows: readonly Record<string, unknown>[], requestId = createRequestId()) {
    return this.execute<{ bracket_id: string; version: number; saved_count: number; stale_advancement_count: number }>("save_registration_batch", { target_bracket_id: bracketId, expected_version: expectedVersion, rows, request_id: requestId }, (value) => this.readOne("brackets", { id: value.bracket_id }));
  }
  activateBracketSchedule(bracketId: string, expectedVersion: number, schedule: Record<string, unknown>, replacementReason: string | null, requestId = createRequestId()) {
    return this.execute<{ bracket_id: string; version: number; heat_count: number }>("activate_bracket_schedule", { target_bracket_id: bracketId, expected_version: expectedVersion, schedule, replacement_reason: replacementReason, request_id: requestId }, (value) => this.readOne("brackets", { id: value.bracket_id }));
  }
  confirmHeatWinnerMs(heatId: string, winnerId: string, laneTimesMs: Record<string, number>, expectedVersion: number, requestId = createRequestId()) {
    return this.execute<{ heat_id: string; winner_car_id: string; version: number }>("confirm_heat_winner_ms", { heat_id: heatId, winner_car_id: winnerId, lane_times_ms: laneTimesMs, expected_version: expectedVersion, request_id: requestId }, (value) => this.readOne("heats", { id: value.heat_id }));
  }
  correctHeatWinnerMs(heatId: string, winnerId: string, laneTimesMs: Record<string, number>, expectedVersion: number, reason: string, requestId = createRequestId()) {
    return this.execute<{ heat_id: string; winner_car_id: string; version: number }>("correct_heat_winner_ms", { heat_id: heatId, winner_car_id: winnerId, lane_times_ms: laneTimesMs, expected_version: expectedVersion, reason, request_id: requestId }, (value) => this.readOne("heats", { id: value.heat_id }));
  }
  confirmHeatWinner(heatId: string, winnerId: string, laneTimes: Record<string, number | null>, expectedVersion: number, requestId = createRequestId()) {
    return this.execute<{ heat_id: string; winner_car_id: string; version: number }>("confirm_heat_winner", { heat_id: heatId, winner_car_id: winnerId, lane_times: laneTimes, expected_version: expectedVersion, request_id: requestId }, (value) => this.readOne("heats", { id: value.heat_id }));
  }
  correctHeatWinner(heatId: string, winnerId: string, laneTimes: Record<string, number | null>, expectedVersion: number, reason: string, requestId = createRequestId()) {
    return this.execute<{ heat_id: string; winner_car_id: string; version: number }>("correct_heat_winner", { heat_id: heatId, winner_car_id: winnerId, lane_times: laneTimes, expected_version: expectedVersion, reason, request_id: requestId }, (value) => this.readOne("heats", { id: value.heat_id }));
  }
  confirmAdvancement(ruleId: string, sourceResultVersion: number, expectedVersion: number, selections: readonly { sourceCarId: string; destinationBracketId: string; rank: number }[], reason: string | null, requestId = createRequestId()) {
    return this.execute<{ snapshot_id: string; rule_id: string; version: number }>("confirm_advancement", { rule_id: ruleId, source_result_version: sourceResultVersion, expected_version: expectedVersion, selections, reason, request_id: requestId }, (value) => this.readOne("advancement_snapshots", { id: value.snapshot_id }));
  }
  replaceAdvancement(ruleId: string, sourceResultVersion: number, expectedVersion: number, selections: readonly { sourceCarId: string; destinationBracketId: string; rank: number }[], reason: string, requestId = createRequestId()) {
    return this.execute<{ snapshot_id: string; rule_id: string; version: number }>("replace_advancement", { rule_id: ruleId, source_result_version: sourceResultVersion, expected_version: expectedVersion, selections, reason, request_id: requestId }, (value) => this.readOne("advancement_snapshots", { id: value.snapshot_id }));
  }
  recordSecurityEvent(organisationId: string, eventName: "account.sign_in" | "account.password_changed" | "account.recovery_completed" | "account.email_confirmed", subjectUserId: string | null, metadata: Record<string, JsonValue>, requestId = createRequestId()) {
    return this.execute<{ ok: boolean; security_event_id?: string; event_type?: string }>("record_security_event", { target_organisation_id: organisationId, event_name: eventName, subject_user_id: subjectUserId, event_metadata: metadata, request_id: requestId }, (value) => this.readOne("security_events", value.security_event_id ? { id: value.security_event_id } : { organisation_id: organisationId }));
  }

  private async readOne(table: string, filters: Record<string, FilterValue>): Promise<void> {
    const result = await this.port.query<Record<string, unknown>>({ table, filters });
    if (result.error) throw new Error(safeMessage(result.error));
  }

  watchMeet(
    organisationId: string,
    meetId: string,
    handlers: {
      bracketIds: readonly string[];
      onSnapshot(snapshot: MeetStateV1, syncedAt: string): void;
      onStatus(status: ConnectionStatus): void;
      isDirty(): boolean;
      onDirtyUpdate(): void;
      onError?(message: string): void;
    },
  ): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let controller: AbortController | null = null;
    let closed = false;
    const refresh = () => {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const currentGeneration = ++generation;
        controller?.abort();
        controller = new AbortController();
        handlers.onStatus("reconnecting");
        void this.loadMeet(organisationId, meetId, controller.signal).then((receipt) => {
          if (closed || currentGeneration !== generation) return;
          if (!receipt.ok) {
            handlers.onStatus(receipt.kind === "offline" || receipt.kind === "network" ? "offline" : "error");
            handlers.onError?.(receipt.message);
            return;
          }
          handlers.onStatus("connected");
          if (handlers.isDirty()) handlers.onDirtyUpdate();
          else handlers.onSnapshot(receipt.value, new Date().toISOString());
        });
      }, 60);
    };
    handlers.onStatus("connecting");
    const bracketFilter = `bracket_id=in.(${handlers.bracketIds.join(",")})`;
    const targets: RealtimeTarget[] = [
      { table: "meets", filter: `id=eq.${meetId}` },
      ...["brackets", "advancement_rules", "advancement_rule_destinations", "advancement_snapshots", "advancement_selections", "audit_events"].map((table) => ({ table, filter: `meet_id=eq.${meetId}` })),
      ...(handlers.bracketIds.length > 0 ? ["participants", "cars", "heats"].map((table) => ({ table, filter: bracketFilter })) : []),
      { table: "organisations", filter: `id=eq.${organisationId}` },
      { table: "organisation_memberships", filter: `organisation_id=eq.${organisationId}` },
      { table: "organisation_invitations", filter: `organisation_id=eq.${organisationId}` },
    ];
    const unsubscribe = this.port.subscribe({ channel: `meet:${organisationId}:${meetId}`, targets }, refresh, handlers.onStatus);
    return () => {
      closed = true;
      generation += 1;
      if (timer) clearTimeout(timer);
      controller?.abort();
      unsubscribe();
    };
  }
}

export function hydrateMeetState(rows: Record<string, unknown[]>, organisationId: string, meetId: string): LoadReceipt {
  const collections = Object.entries(rows);
  for (const [table, values] of collections) {
    for (const value of values) {
      const row = asRecord(value);
      if ("organisation_id" in row && row.organisation_id !== organisationId) {
        return { ok: false, kind: "validation", message: `${table} contained data from another organisation.` };
      }
      if ("meet_id" in row && row.meet_id !== meetId) {
        return { ok: false, kind: "validation", message: `${table} contained data from another meet.` };
      }
    }
  }
  const hostedIssue = validateHostedRows(rows);
  if (hostedIssue) return { ok: false, kind: "validation", message: hostedIssue };
  const meetRows = getRows(rows, "meets");
  if (meetRows.length !== 1 || meetRows[0]?.id !== meetId) return { ok: false, kind: "validation", message: "The requested meet was not available." };
  const meet = meetRows[0]!;
  const bracketRows = getRows(rows, "brackets").sort(byNumberThenId("display_order"));
  const bracketIds = new Set(bracketRows.map((row) => asString(row.id)));
  for (const table of ["participants", "cars", "heats"] as const) {
    if (getRows(rows, table).some((row) => !bracketIds.has(asString(row.bracket_id)))) {
      return { ok: false, kind: "validation", message: `${table} contained rows outside this meet.` };
    }
  }
  const historyResult = buildAdvancementHistory(rows);
  if (!historyResult.ok) return historyResult;
  const currentSnapshots = getRows(rows, "advancement_snapshots").filter((row) => row.replaced_by_snapshot_id == null).sort(byString("confirmed_at", "id"));
  const currentSnapshotIds = new Set(currentSnapshots.map((row) => asString(row.id)));
  const selections = getRows(rows, "advancement_selections").filter((row) => currentSnapshotIds.has(asString(row.snapshot_id))).sort(byNumberThenId("rank"));
  const participants = getRows(rows, "participants");
  const cars = getRows(rows, "cars");
  const heats = getRows(rows, "heats");
  const settings = asRecord(meet.settings);
  const candidate: MeetStateV1 = {
    version: 1,
    meet: {
      id: asString(meet.id), name: asString(meet.name), venue: asString(meet.venue), date: asString(meet.meet_date),
      status: asStatus(meet.status), createdAt: asString(meet.created_at), updatedAt: asString(meet.updated_at), version: asInteger(meet.version, 1),
    },
    brackets: bracketRows.map((bracket) => {
      const bracketId = asString(bracket.id);
      const bracketParticipants = participants.filter((row) => row.bracket_id === bracketId).sort(byString("name", "id"));
      const bracketCars = cars.filter((row) => row.bracket_id === bracketId).sort(byNumberThenId("car_number"));
      const bracketHeats = heats.filter((row) => row.bracket_id === bracketId).sort((a, b) => asInteger(a.round_number) - asInteger(b.round_number) || asInteger(a.heat_number) - asInteger(b.heat_number) || asString(a.id).localeCompare(asString(b.id)));
      const bracketSettings = asRecord(bracket.settings);
      const mapHeat = (heat: Record<string, unknown>) => ({
        id: asString(heat.id), phase: heat.phase === "final" ? "final" as const : "preliminary" as const,
        matchNumber: asInteger(heat.round_number, 1), heatNumber: asInteger(heat.heat_number, 1),
        lanes: [nullableString(heat.lane_1_car_id), nullableString(heat.lane_2_car_id), nullableString(heat.lane_3_car_id)] as [string | null, string | null, string | null],
        status: heat.status === "confirmed" ? "completed" as const : "scheduled" as const,
        winnerEntryId: nullableString(heat.winner_car_id),
        laneTimesMs: [secondsToMilliseconds(heat.lane_1_time), secondsToMilliseconds(heat.lane_2_time), secondsToMilliseconds(heat.lane_3_time)] as [number | null, number | null, number | null], notes: "",
      });
      return {
        id: bracketId, name: asString(bracket.name), stage: asStage(bracket.stage), displayOrder: asInteger(bracket.display_order, 1), status: asStatus(bracket.status), version: asInteger(bracket.version, 1),
        lineage: selections.filter((selection) => selection.destination_bracket_id === bracketId).map((selection) => ({ sourceBracketId: asString(selection.source_bracket_id), sourceCarId: asString(selection.source_car_id), ruleId: asString(selection.rule_id), snapshotId: asString(selection.snapshot_id) })),
        event: {
          version: 1,
          event: { id: bracketId, name: asString(bracket.name), date: asString(meet.meet_date), venue: asString(meet.venue), organizer: asString(settings.organizer) || "Meet officials", laneCount: 3 as const, status: asStatus(bracket.status), createdAt: asString(bracket.created_at), updatedAt: asString(bracket.updated_at), resultSeal: bracket.status === "completed" ? "official" as const : bracket.status === "running" ? "provisional" as const : "draft" as const },
          settings: eventSettings(bracketSettings),
          participants: bracketParticipants.map((row) => ({ id: asString(row.id), name: asString(row.name), email: asString(row.email), phone: asString(row.phone), notes: asString(row.notes) })),
          entries: bracketCars.map((row) => ({ id: asString(row.id), participantId: asString(row.participant_id), carNumber: asInteger(row.car_number, 1), name: asString(row.name), categoryId: bracketId, quantity: 1, active: row.active !== false })),
          matches: bracketHeats.filter((row) => row.phase !== "final").map(mapHeat),
          finals: bracketHeats.filter((row) => row.phase === "final").map(mapHeat), payments: [], auditLog: [],
        },
      };
    }),
    advancementRules: getRows(rows, "advancement_rules").sort(byString("id")).map((rule) => {
      const destinations = getRows(rows, "advancement_rule_destinations").filter((row) => row.rule_id === rule.id).sort(byNumberThenId("destination_order"));
      const ids = destinations.map((row) => asString(row.destination_bracket_id));
      return { id: asString(rule.id), sourceBracketId: asString(rule.source_bracket_id), destinationBracketIds: ids, topN: asInteger(rule.top_n, 1), destinationCapacity: asInteger(rule.destination_capacity, 1), destinationOrder: [...ids], status: rule.status === "disabled" ? "disabled" as const : "active" as const };
    }),
    advancementSnapshots: currentSnapshots.map((snapshot) => ({
      id: asString(snapshot.id), ruleId: asString(snapshot.rule_id), sourceBracketId: asString(snapshot.source_bracket_id), sourceResultVersion: asInteger(snapshot.source_result_version, 1),
      selections: selections.filter((selection) => selection.snapshot_id === snapshot.id).map((selection) => ({ sourceCarId: asString(selection.source_car_id), destinationBracketId: asString(selection.destination_bracket_id), rank: asInteger(selection.rank, 1) })),
      confirmedBy: asString(snapshot.confirmed_by), reason: nullableString(snapshot.reason), confirmedAt: asString(snapshot.confirmed_at), stale: snapshot.stale === true,
    })),
    auditLog: getRows(rows, "audit_events").sort(byString("occurred_at", "id")).map((event) => ({
      id: asString(event.id), timestamp: asString(event.occurred_at), actorId: asString(event.actor_id), action: asString(event.action), entityType: asString(event.entity_type), entityId: asString(event.entity_id), reason: nullableString(event.reason), before: asJson(event.before_state), after: asJson(event.after_state),
    })),
  };
  const validation = validateMeetState(candidate);
  return validation.success ? {
    ok: true,
    value: validation.data,
    history: historyResult.history,
    heatVersions: Object.fromEntries(heats.map((heat) => [asString(heat.id), asInteger(heat.version, 1)])),
  } : { ok: false, kind: "validation", message: `Hosted meet data failed validation: ${validation.issues[0]?.message ?? "unknown issue"}` };
}

function validateHostedRows(rows: Record<string, unknown[]>): string | null {
  const fail = (table: string, field: string) => `Hosted ${table}.${field} has an invalid type or value.`;
  const requiredStrings = (row: Record<string, unknown>, table: string, fields: readonly string[]) => fields.find((field) => typeof row[field] !== "string" || (row[field] as string).length === 0) ? fail(table, fields.find((field) => typeof row[field] !== "string" || (row[field] as string).length === 0)!) : null;
  const positiveInteger = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  for (const row of getRows(rows, "meets")) {
    const issue = requiredStrings(row, "meets", ["id", "organisation_id", "name", "meet_date", "created_at", "updated_at"]);
    if (issue) return issue;
    if (!isStatus(row.status)) return fail("meets", "status");
    if (!positiveInteger(row.version)) return fail("meets", "version");
    if (!isRecord(row.settings) || typeof row.venue !== "string") return fail("meets", "settings");
  }
  for (const row of getRows(rows, "brackets")) {
    const issue = requiredStrings(row, "brackets", ["id", "organisation_id", "meet_id", "name", "created_at", "updated_at"]);
    if (issue) return issue;
    if (!isStage(row.stage)) return fail("brackets", "stage");
    if (!isStatus(row.status)) return fail("brackets", "status");
    if (!positiveInteger(row.display_order) || !positiveInteger(row.version) || !isRecord(row.settings)) return fail("brackets", "number");
  }
  for (const row of getRows(rows, "participants")) {
    const issue = requiredStrings(row, "participants", ["id", "organisation_id", "bracket_id", "name"]);
    if (issue) return issue;
    if (["email", "phone", "notes"].some((field) => typeof row[field] !== "string")) return fail("participants", "text");
  }
  for (const row of getRows(rows, "cars")) {
    const issue = requiredStrings(row, "cars", ["id", "organisation_id", "bracket_id", "participant_id", "name"]);
    if (issue) return issue;
    if (!positiveInteger(row.car_number) || typeof row.active !== "boolean") return fail("cars", "number");
    if (["source_bracket_id", "source_car_id", "rule_id", "snapshot_id"].some((field) => !nullableString(row[field]))) return fail("cars", "lineage");
  }
  for (const row of getRows(rows, "heats")) {
    const issue = requiredStrings(row, "heats", ["id", "organisation_id", "bracket_id", "lane_1_car_id"]);
    if (issue) return issue;
    if (row.phase !== "preliminary" && row.phase !== "final") return fail("heats", "phase");
    if (row.status !== "pending" && row.status !== "confirmed") return fail("heats", "status");
    if (!positiveInteger(row.round_number) || !positiveInteger(row.heat_number) || !positiveInteger(row.version)) return fail("heats", "number");
    if (["lane_2_car_id", "lane_3_car_id", "winner_car_id"].some((field) => !nullableString(row[field]))) return fail("heats", "car_id");
    if (["lane_1_time", "lane_2_time", "lane_3_time"].some((field) => row[field] !== null && (typeof row[field] !== "number" || !Number.isFinite(row[field])))) return fail("heats", "time");
  }
  for (const row of getRows(rows, "advancement_rules")) {
    const issue = requiredStrings(row, "advancement_rules", ["id", "organisation_id", "meet_id", "source_bracket_id"]);
    if (issue) return issue;
    if (!positiveInteger(row.top_n) || !positiveInteger(row.destination_capacity) || !positiveInteger(row.version)) return fail("advancement_rules", "number");
    if (row.status !== "active" && row.status !== "disabled") return fail("advancement_rules", "status");
  }
  for (const row of getRows(rows, "advancement_rule_destinations")) {
    const issue = requiredStrings(row, "advancement_rule_destinations", ["organisation_id", "meet_id", "rule_id", "destination_bracket_id"]);
    if (issue) return issue;
    if (!positiveInteger(row.destination_order)) return fail("advancement_rule_destinations", "destination_order");
  }
  for (const row of getRows(rows, "advancement_snapshots")) {
    const issue = requiredStrings(row, "advancement_snapshots", ["id", "organisation_id", "meet_id", "rule_id", "source_bracket_id", "confirmed_by", "confirmed_at"]);
    if (issue) return issue;
    if (!positiveInteger(row.source_result_version) || typeof row.stale !== "boolean" || !nullableString(row.replaced_by_snapshot_id) || !nullableString(row.reason)) return fail("advancement_snapshots", "state");
  }
  for (const row of getRows(rows, "advancement_selections")) {
    const issue = requiredStrings(row, "advancement_selections", ["id", "organisation_id", "meet_id", "snapshot_id", "rule_id", "source_bracket_id", "source_car_id", "destination_bracket_id"]);
    if (issue) return issue;
    if (!positiveInteger(row.rank) || !nullableString(row.destination_car_id)) return fail("advancement_selections", "state");
  }
  for (const row of getRows(rows, "audit_events")) {
    const issue = requiredStrings(row, "audit_events", ["id", "organisation_id", "meet_id", "actor_id", "action", "entity_type", "entity_id", "occurred_at"]);
    if (issue) return issue;
    if (!nullableString(row.reason) || !("before_state" in row) || !("after_state" in row)) return fail("audit_events", "state");
  }
  return null;
}

function buildAdvancementHistory(rows: Record<string, unknown[]>): { ok: true; history: AdvancementHistory } | { ok: false; kind: "validation"; message: string } {
  const snapshots = getRows(rows, "advancement_snapshots");
  const selections = getRows(rows, "advancement_selections");
  const rules = new Set(getRows(rows, "advancement_rules").map((row) => asString(row.id)));
  const brackets = new Set(getRows(rows, "brackets").map((row) => asString(row.id)));
  const cars = new Set(getRows(rows, "cars").map((row) => asString(row.id)));
  const snapshotIds = new Set(snapshots.map((row) => asString(row.id)));
  if (snapshotIds.size !== snapshots.length) return { ok: false, kind: "validation", message: "Advancement history contains duplicate snapshots." };
  for (const snapshot of snapshots) {
    if (!rules.has(asString(snapshot.rule_id)) || !brackets.has(asString(snapshot.source_bracket_id))) return { ok: false, kind: "validation", message: "Advancement history references an unknown rule or source." };
    const replacement = nullableString(snapshot.replaced_by_snapshot_id);
    if (replacement && !snapshotIds.has(replacement)) return { ok: false, kind: "validation", message: "Advancement history replacement is missing." };
  }
  for (const selection of selections) {
    const snapshot = snapshots.find((candidate) => candidate.id === selection.snapshot_id);
    if (!snapshot || snapshot.rule_id !== selection.rule_id || snapshot.source_bracket_id !== selection.source_bracket_id) return { ok: false, kind: "validation", message: "Advancement history selection does not match its snapshot." };
    if (!cars.has(asString(selection.source_car_id)) || !brackets.has(asString(selection.destination_bracket_id))) return { ok: false, kind: "validation", message: "Advancement history selection references an unknown car or destination." };
  }
  return {
    ok: true,
    history: {
      snapshots: snapshots.sort(byString("confirmed_at", "id")).map((snapshot) => ({ id: asString(snapshot.id), ruleId: asString(snapshot.rule_id), sourceBracketId: asString(snapshot.source_bracket_id), sourceResultVersion: snapshot.source_result_version as number, stale: snapshot.stale as boolean, replacedBySnapshotId: nullableString(snapshot.replaced_by_snapshot_id), confirmedBy: asString(snapshot.confirmed_by), reason: nullableString(snapshot.reason), confirmedAt: asString(snapshot.confirmed_at) })),
      selections: selections.sort(byString("snapshot_id", "id")).map((selection) => ({ id: asString(selection.id), snapshotId: asString(selection.snapshot_id), ruleId: asString(selection.rule_id), sourceBracketId: asString(selection.source_bracket_id), sourceCarId: asString(selection.source_car_id), destinationBracketId: asString(selection.destination_bracket_id), destinationCarId: nullableString(selection.destination_car_id), rank: selection.rank as number })),
    },
  };
}

function eventSettings(settings: Record<string, unknown>): EventStateV1["settings"] {
  const allowedTieBreaks = new Set<TieBreakKey>(["totalWins", "headToHead", "matchesWon", "averageTime", "bestTime", "laneBalance", "playoff", "carNumber"]);
  const tieBreakOrder = Array.isArray(settings.tieBreakOrder) ? settings.tieBreakOrder.filter((value): value is TieBreakKey => typeof value === "string" && allowedTieBreaks.has(value as TieBreakKey)) : ["totalWins" as TieBreakKey];
  const scheduleMode: EventStateV1["settings"]["scheduleMode"] = settings.scheduleMode === "template9" || settings.scheduleMode === "template12" || settings.scheduleMode === "template15" ? settings.scheduleMode : "custom";
  const rankingMode: EventStateV1["settings"]["rankingMode"] = settings.rankingMode === "dense" || settings.rankingMode === "ordinal" ? settings.rankingMode : "competition";
  return { scheduleMode, seed: asString(settings.seed) || "meet-hosted", rankingMode, allowSharedRanks: rankingMode !== "ordinal", tieBreakOrder, finalistCount: asInteger(settings.finalistCount, 0), autoSave: true, confirmWinnerChanges: true, enableTiming: settings.enableTiming !== false, prices: {} };
}

function getRows(rows: Record<string, unknown[]>, table: string): Record<string, unknown>[] { return (rows[table] ?? []).map(asRecord); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isStatus(value: unknown): value is "setup" | "running" | "completed" { return value === "setup" || value === "running" || value === "completed"; }
function isStage(value: unknown): value is "qualifier" | "semifinal" | "final" { return value === "qualifier" || value === "semifinal" || value === "final"; }
function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function asString(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function asInteger(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isSafeInteger(value) ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : fallback; }
function asStatus(value: unknown): "setup" | "running" | "completed" { return value === "running" || value === "completed" ? value : "setup"; }
function asStage(value: unknown): "qualifier" | "semifinal" | "final" { return value === "semifinal" || value === "final" ? value : "qualifier"; }
function asRole(value: unknown): OrganisationRole | null { return value === "owner" || value === "admin" || value === "organiser" || value === "marshal" || value === "viewer" ? value : null; }
function asJson(value: unknown): JsonValue { return (value ?? {}) as JsonValue; }
function secondsToMilliseconds(value: unknown): number | null { const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 1000) : null; }
function byString(...keys: string[]) { return (a: Record<string, unknown>, b: Record<string, unknown>) => { for (const key of keys) { const difference = asString(a[key]).localeCompare(asString(b[key])); if (difference) return difference; } return 0; }; }
function byNumberThenId(key: string) { return (a: Record<string, unknown>, b: Record<string, unknown>) => asInteger(a[key]) - asInteger(b[key]) || asString(a.id).localeCompare(asString(b.id)); }
function safeUnknownMessage(cause: unknown): string { return cause instanceof Error && /offline|network|fetch/i.test(cause.message) ? "The hosted service is unreachable. Your current view was preserved." : "The hosted operation failed safely."; }
function safeMessage(error: PortError): string { const message = error.message; if (/MEET_VERSION_CONFLICT/.test(message)) return "Another official changed this record. Refresh before retrying."; if (/MEET_FORBIDDEN|permission|row-level security/i.test(message)) return "Your role does not allow this action."; if (/MEET_REASON_REQUIRED|MEET_INVALID|validation/i.test(message)) return "The server rejected invalid meet data."; if (/offline|network|fetch/i.test(message)) return "The hosted service is unreachable. Your current view was preserved."; return "The hosted operation failed safely."; }
function mapError(error: PortError): RepositoryFailureKind { const message = error.message; if (/MEET_VERSION_CONFLICT/.test(message)) return "conflict"; if (/MEET_FORBIDDEN|permission|row-level security/i.test(message)) return "permission"; if (/MEET_REASON_REQUIRED|MEET_INVALID|validation/i.test(message)) return "validation"; if (/offline/i.test(message)) return "offline"; if (/network|fetch/i.test(message)) return "network"; return "unknown"; }
export function createRequestId(): string { return crypto.randomUUID(); }
