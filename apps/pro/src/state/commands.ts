import {
  calculateRankings,
  calculateStandings,
  cancelHeat,
  markRerun,
  recordWinner,
  validateEventState,
  type AuditEntry,
  type EventStateV1,
} from "@rr3/domain";
import type { EventRepository } from "../persistence/repository";

export type CommandReceipt = {
  commandId: string;
  timestamp: string;
  summary: string;
  affectedCarIds: string[];
  previousRanks: Record<string, number | null>;
  nextRanks: Record<string, number | null>;
  undoUntil: string | null;
};

export type EventCommand =
  | { type: "event.replace"; event: EventStateV1; summary: string }
  | {
      type: "result.record-winner";
      heatId: string;
      carId: string;
      correctionReason?: string;
      laneTimesMs?: [number | null, number | null, number | null];
    }
  | { type: "heat.cancel"; heatId: string; reason: string }
  | { type: "heat.mark-rerun"; heatId: string; reason: string };

export type PublishCommittedEvent = (event: EventStateV1, receipt: CommandReceipt) => void;

export type PostCommitIssue = {
  commandId: string;
  area: "state-readback" | "state-publish" | "snapshot-history";
  message: string;
};

export type CommandDispatcherOptions = {
  repository: EventRepository;
  now?: () => string;
  createId?: () => string;
  publish?: PublishCommittedEvent;
  onPostCommitIssue?: (issue: PostCommitIssue) => void;
};

export class CommandAlreadyPendingError extends Error {
  constructor() {
    super("An event command is already pending");
    this.name = "CommandAlreadyPendingError";
  }
}

export type CommandDispatcher = {
  dispatch(command: EventCommand): Promise<CommandReceipt>;
  readonly pending: boolean;
};

export type PreparedEventCommand = {
  event: EventStateV1;
  receipt: CommandReceipt;
};

class TransactionalCommandDispatcher implements CommandDispatcher {
  private isPending = false;
  private readonly repository: EventRepository;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly publish?: PublishCommittedEvent;
  private readonly onPostCommitIssue?: (issue: PostCommitIssue) => void;

  constructor(options: CommandDispatcherOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? createCommandId;
    this.publish = options.publish;
    this.onPostCommitIssue = options.onPostCommitIssue;
  }

  get pending(): boolean {
    return this.isPending;
  }

  async dispatch(command: EventCommand): Promise<CommandReceipt> {
    if (this.isPending) throw new CommandAlreadyPendingError();
    this.isPending = true;
    try {
      return await this.execute(command);
    } finally {
      this.isPending = false;
    }
  }

  private async execute(command: EventCommand): Promise<CommandReceipt> {
    const current = await this.repository.load();
    const commandId = this.createId();
    const timestamp = this.now();
    const { event: candidate, receipt } = prepareEventCommand(current, command, commandId, timestamp);

    await this.repository.save(candidate, { commandId, timestamp, summary: receipt.summary });
    let committed = candidate;
    try {
      const readBack = await this.repository.load();
      if (readBack) {
        committed = readBack;
      } else {
        this.reportPostCommitIssue({
          commandId,
          area: "state-readback",
          message: "Committed event could not be read back",
        });
      }
    } catch (cause) {
      this.reportPostCommitIssue({
        commandId,
        area: "state-readback",
        message: toSafeErrorMessage(cause, "Committed event read-back failed"),
      });
    }
    try {
      this.publish?.(committed, receipt);
    } catch (cause) {
      this.reportPostCommitIssue({
        commandId,
        area: "state-publish",
        message: toSafeErrorMessage(cause, "Committed state publication failed"),
      });
    }
    return receipt;
  }

  private reportPostCommitIssue(issue: PostCommitIssue): void {
    try {
      this.onPostCommitIssue?.(issue);
    } catch {
      // An advisory issue reporter cannot turn a committed command into a failure.
    }
  }
}

export function createCommandDispatcher(options: CommandDispatcherOptions): CommandDispatcher {
  return new TransactionalCommandDispatcher(options);
}

export function prepareEventCommand(
  current: EventStateV1 | null,
  command: EventCommand,
  commandId: string,
  timestamp: string,
): PreparedEventCommand {
  const rankingPhase = rankingPhaseForCommand(current, command);
  const previousRanks = current ? rankMap(current, rankingPhase) : {};
  const { event, affectedCarIds, summary, undoable } = applyCommand(
    current,
    command,
    commandId,
    timestamp,
  );
  return {
    event,
    receipt: {
      commandId,
      timestamp,
      summary,
      affectedCarIds,
      previousRanks,
      nextRanks: rankMap(event, rankingPhase),
      undoUntil: undoable ? addSeconds(timestamp, 30) : null,
    },
  };
}

type AppliedCommand = {
  event: EventStateV1;
  affectedCarIds: string[];
  summary: string;
  undoable: boolean;
};

function applyCommand(
  current: EventStateV1 | null,
  command: EventCommand,
  commandId: string,
  timestamp: string,
): AppliedCommand {
  if (command.type === "event.replace") {
    const validated = validateEventState(command.event);
    if (!validated.success) throw new Error("Replacement event is invalid");
    const summary = requireSummary(command.summary);
    const candidate = structuredClone(validated.data);
    candidate.event.updatedAt = timestamp;
    candidate.auditLog.push(createReplacementAudit(candidate, commandId, timestamp, summary));
    return {
      event: candidate,
      affectedCarIds: candidate.entries.map(({ id }) => id),
      summary,
      undoable: false,
    };
  }

  if (!current) throw new Error("No live event is available for this command");
  const timestamped = structuredClone(current);
  timestamped.event.updatedAt = timestamp;

  if (command.type === "result.record-winner") {
    const previousWinner = requireHeat(timestamped, command.heatId).winnerEntryId;
    const event = recordWinner(timestamped, command.heatId, command.carId, command.correctionReason);
    if (command.laneTimesMs) {
      const located = requireHeat(event, command.heatId);
      command.laneTimesMs.forEach((time, laneIndex) => {
        if (time !== null && (!Number.isSafeInteger(time) || time < 0)) {
          throw new Error(`Lane ${laneIndex + 1} time must be a non-negative safe integer`);
        }
        if (located.lanes[laneIndex] === null && time !== null) {
          throw new Error(`Lane ${laneIndex + 1} is vacant and cannot have a time`);
        }
      });
      located.laneTimesMs = [...command.laneTimesMs] as [number | null, number | null, number | null];
    }
    return {
      event,
      affectedCarIds: uniqueCarIds(previousWinner, command.carId),
      summary: requireLatestAuditSummary(event),
      undoable: true,
    };
  }

  const heat = requireHeat(timestamped, command.heatId);
  const affectedCarIds = heat.lanes.filter((carId): carId is string => carId !== null);
  if (command.type === "heat.cancel") {
    const event = cancelHeat(timestamped, command.heatId, command.reason);
    return { event, affectedCarIds, summary: requireLatestAuditSummary(event), undoable: true };
  }
  const event = markRerun(timestamped, command.heatId, command.reason);
  return { event, affectedCarIds, summary: requireLatestAuditSummary(event), undoable: true };
}

function rankingPhaseForCommand(
  current: EventStateV1 | null,
  command: EventCommand,
): "preliminary" | "final" {
  if (!current || command.type === "event.replace") return "preliminary";
  return requireHeat(current, command.heatId).phase;
}

function rankMap(
  event: EventStateV1,
  phase: "preliminary" | "final",
): Record<string, number | null> {
  try {
    const standings = calculateStandings(event, phase);
    return Object.fromEntries(
      calculateRankings(standings, event.settings).map(({ carId, rank }) => [carId, rank]),
    );
  } catch {
    return Object.fromEntries(event.entries.filter(({ active }) => active).map(({ id }) => [id, null]));
  }
}

function requireHeat(event: EventStateV1, heatId: string) {
  const heat = [...event.matches, ...event.finals].find(({ id }) => id === heatId);
  if (!heat) throw new Error(`Unknown heat ID: ${heatId}`);
  return heat;
}

function uniqueCarIds(...carIds: Array<string | null>): string[] {
  return [...new Set(carIds.filter((carId): carId is string => carId !== null))];
}

function requireLatestAuditSummary(event: EventStateV1): string {
  const summary = event.auditLog.at(-1)?.summary.trim();
  if (!summary) throw new Error("A meaningful audit summary is required");
  return summary;
}

function requireSummary(summary: string): string {
  const normalized = summary.trim();
  if (!normalized) throw new Error("Command summary is required");
  return normalized;
}

function createReplacementAudit(
  event: EventStateV1,
  commandId: string,
  timestamp: string,
  summary: string,
): AuditEntry {
  return {
    id: `audit-event-replaced-${commandId}`,
    timestamp,
    action: "event.replaced",
    summary,
    entityType: "event",
    entityId: event.event.id,
    details: { commandId },
  };
}

function addSeconds(timestamp: string, seconds: number): string {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new Error("Command timestamp must be valid ISO date text");
  return new Date(milliseconds + seconds * 1_000).toISOString();
}

function toSafeErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

let fallbackIdSequence = 0;

function createCommandId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `command-${crypto.randomUUID()}`;
  }
  fallbackIdSequence += 1;
  return `command-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}`;
}
