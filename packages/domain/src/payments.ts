import { validateEventState } from "./schema";
import type { EventStateV1 } from "./types";

export type ParticipantAccount = {
  participantId: string;
  chargeCents: number;
  collectedCents: number;
  balanceCents: number;
};

export type EventAccounts = {
  participants: ParticipantAccount[];
  chargeCents: number;
  collectedCents: number;
  balanceCents: number;
};

export function calculateParticipantAccount(state: EventStateV1, participantId: string): ParticipantAccount {
  const validatedState = assertValidEvent(state);
  if (!validatedState.participants.some(({ id }) => id === participantId)) {
    throw new Error(`Unknown participant ID: ${participantId}`);
  }
  return aggregateAccounts(validatedState, new Set([participantId])).get(participantId)!;
}

export function calculateEventAccounts(state: EventStateV1): EventAccounts {
  const validatedState = assertValidEvent(state);
  const participantIds = new Set(validatedState.participants.map(({ id }) => id));
  const accounts = aggregateAccounts(validatedState, participantIds);
  const result: EventAccounts = { participants: [], chargeCents: 0, collectedCents: 0, balanceCents: 0 };
  for (const participant of validatedState.participants) {
    const account = accounts.get(participant.id)!;
    result.participants.push(account);
    result.chargeCents = safeAdd(result.chargeCents, account.chargeCents, "Event charge");
    result.collectedCents = safeAdd(result.collectedCents, account.collectedCents, "Event collected amount");
    result.balanceCents = safeAdd(result.balanceCents, account.balanceCents, "Event balance");
  }
  return result;
}

function aggregateAccounts(state: EventStateV1, participantIds: ReadonlySet<string>): Map<string, ParticipantAccount> {
  const charges = new Map<string, number>();
  const collected = new Map<string, number>();
  for (const participantId of participantIds) {
    charges.set(participantId, 0);
    collected.set(participantId, 0);
  }

  for (const entry of state.entries) {
    if (!participantIds.has(entry.participantId)) continue;
    assertSafePositiveInteger(entry.quantity, `Entry ${entry.id} quantity`);
    const priceCents = state.settings.prices[entry.categoryId];
    if (priceCents === undefined) {
      throw new Error(`Missing category price for ${entry.categoryId} on entry ${entry.id}`);
    }
    assertSafeNonnegativeInteger(priceCents, `Category ${entry.categoryId} price`);
    const entryCharge = safeMultiply(entry.quantity, priceCents, `Charge for entry ${entry.id}`);
    charges.set(entry.participantId, safeAdd(charges.get(entry.participantId)!, entryCharge, "Participant charge"));
  }

  for (const payment of state.payments) {
    if (!participantIds.has(payment.participantId)) continue;
    assertSafeNonnegativeInteger(payment.amountCents, `Payment ${payment.id} amount`);
    const signedAmount = payment.kind === "refund" ? -payment.amountCents : payment.amountCents;
    collected.set(payment.participantId, safeAdd(collected.get(payment.participantId)!, signedAmount, "Participant collected amount"));
  }

  const accounts = new Map<string, ParticipantAccount>();
  for (const participantId of participantIds) {
    const chargeCents = charges.get(participantId)!;
    const collectedCents = collected.get(participantId)!;
    accounts.set(participantId, {
      participantId,
      chargeCents,
      collectedCents,
      balanceCents: safeAdd(chargeCents, -collectedCents, "Participant balance")
    });
  }
  return accounts;
}

function assertValidEvent(state: EventStateV1): EventStateV1 {
  const result = validateEventState(state);
  if (result.success) return result.data;
  const summary = result.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid event state: ${summary}`);
}

function assertSafePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function assertSafeNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer number of cents`);
}

function safeMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds the safe integer range`);
  return result;
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds the safe integer range`);
  return result;
}
