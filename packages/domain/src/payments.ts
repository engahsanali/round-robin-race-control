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
  assertValidEvent(state);
  if (!state.participants.some(({ id }) => id === participantId)) {
    throw new Error(`Unknown participant ID: ${participantId}`);
  }

  let chargeCents = 0;
  for (const entry of state.entries.filter((candidate) => candidate.participantId === participantId)) {
    assertSafePositiveInteger(entry.quantity, `Entry ${entry.id} quantity`);
    const priceCents = state.settings.prices[entry.categoryId];
    if (priceCents === undefined) {
      throw new Error(`Missing category price for ${entry.categoryId} on entry ${entry.id}`);
    }
    assertSafeNonnegativeInteger(priceCents, `Category ${entry.categoryId} price`);
    chargeCents = safeAdd(chargeCents, safeMultiply(entry.quantity, priceCents, `Charge for entry ${entry.id}`), "Participant charge");
  }

  let collectedCents = 0;
  for (const payment of state.payments.filter((candidate) => candidate.participantId === participantId)) {
    assertSafeNonnegativeInteger(payment.amountCents, `Payment ${payment.id} amount`);
    const signedAmount = payment.kind === "refund" ? -payment.amountCents : payment.amountCents;
    collectedCents = safeAdd(collectedCents, signedAmount, "Participant collected amount");
  }

  return {
    participantId,
    chargeCents,
    collectedCents,
    balanceCents: safeAdd(chargeCents, -collectedCents, "Participant balance")
  };
}

export function calculateEventAccounts(state: EventStateV1): EventAccounts {
  assertValidEvent(state);
  const participants = state.participants.map(({ id }) => calculateParticipantAccount(state, id));
  return participants.reduce<EventAccounts>((totals, account) => ({
    participants: [...totals.participants, account],
    chargeCents: safeAdd(totals.chargeCents, account.chargeCents, "Event charge"),
    collectedCents: safeAdd(totals.collectedCents, account.collectedCents, "Event collected amount"),
    balanceCents: safeAdd(totals.balanceCents, account.balanceCents, "Event balance")
  }), { participants: [], chargeCents: 0, collectedCents: 0, balanceCents: 0 });
}

function assertValidEvent(state: EventStateV1): void {
  const result = validateEventState(state);
  if (result.success) return;
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
