import { useState } from "react";
import type { Participant, ParticipantAccount } from "@rr3/domain";

type AccountPanelProps = {
  participant: Participant;
  account: ParticipantAccount;
  refunded: boolean;
  onRecord(kind: "payment" | "refund", amountCents: number): Promise<void>;
};

export function AccountPanel({ participant, account, refunded, onRecord }: AccountPanelProps) {
  const [kind, setKind] = useState<"payment" | "refund">("payment");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function record() {
    const cents = Number(amount);
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      setError("Amount must be a positive safe integer number of cents.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onRecord(kind, cents);
      setAmount("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account update failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-panel feature-panel" aria-label={`${participant.name} account`}>
      <h3>{participant.name} account</h3>
      <p className="account-state">{formatAccountState(account, refunded)}</p>
      <dl className="account-breakdown">
        <div><dt>Current charges</dt><dd>{formatMoney(account.chargeCents)}</dd></div>
        <div><dt>Net collected</dt><dd>{formatMoney(account.collectedCents)}</dd></div>
      </dl>
      <label>
        Account entry type
        <select value={kind} onChange={(event) => setKind(event.target.value as "payment" | "refund")}>
          <option value="payment">Payment</option>
          <option value="refund">Refund</option>
        </select>
      </label>
      <label>Amount in cents<input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button type="button" disabled={saving} onClick={() => void record()}>{kind === "refund" ? "Record refund" : "Record payment"}</button>
    </section>
  );
}

export function formatAccountState(account: ParticipantAccount, refunded: boolean): string {
  if (account.balanceCents < 0) return `Credit · ${formatMoney(-account.balanceCents)} credit`;
  if (refunded) return `Refunded · ${formatMoney(account.balanceCents)} due`;
  if (account.balanceCents === 0) return "Paid · $0.00 due";
  if (account.collectedCents > 0) return `Partial · ${formatMoney(account.balanceCents)} due`;
  return `Unpaid · ${formatMoney(account.balanceCents)} due`;
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}
