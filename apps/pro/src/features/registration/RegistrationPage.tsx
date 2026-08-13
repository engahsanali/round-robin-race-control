import { useMemo, useState } from "react";
import { calculateEventAccounts, type CarEntry, type EventStateV1, type Participant } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";
import { AccountPanel, formatAccountState } from "../payments/AccountPanel";
import { ParticipantEditor } from "./ParticipantEditor";

type SortMode = "participant" | "car-number";
type RegistrationStatus = "all" | "active" | "withdrawn";

export function RegistrationPage() {
  const eventState = useOptionalEventState();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RegistrationStatus>("all");
  const [sort, setSort] = useState<SortMode>("participant");
  const [descending, setDescending] = useState(false);
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
  const [accountParticipantId, setAccountParticipantId] = useState<string | null>(null);
  const [withdrawEntryId, setWithdrawEntryId] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const state = eventState?.state ?? null;
  const participantById = useMemo(
    () => new Map(state?.participants.map((participant) => [participant.id, participant]) ?? []),
    [state?.participants],
  );
  const visibleEntries = useMemo(() => {
    if (!state) return [];
    const query = search.trim().toLocaleLowerCase();
    const result = state.entries.filter((entry) => {
      const participant = participantById.get(entry.participantId);
      const statusMatches = status === "all" || (status === "active" ? entry.active : !entry.active);
      const searchMatches = !query || `${participant?.name ?? ""} ${entry.name} ${entry.carNumber}`.toLocaleLowerCase().includes(query);
      return statusMatches && searchMatches;
    });
    result.sort((left, right) => {
      const comparison = sort === "car-number"
        ? left.carNumber - right.carNumber
        : (participantById.get(left.participantId)?.name ?? "").localeCompare(participantById.get(right.participantId)?.name ?? "");
      return descending ? -comparison : comparison;
    });
    return result;
  }, [descending, participantById, search, sort, state, status]);

  if (!eventState) return <RegistrationUnavailable />;
  if (eventState.loading) return <p role="status">Loading registration…</p>;

  if (!state) {
    return (
      <section className="page-frame" aria-labelledby="page-title">
        <p className="eyebrow">Entrants and accounts</p>
        <h2 id="page-title">Registration &amp; fees</h2>
        <p>Create an event from the dashboard before registering participants and cars.</p>
      </section>
    );
  }

  const provider = eventState;
  const currentState = state;

  const accounts = calculateEventAccounts(currentState);
  const accountByParticipant = new Map(accounts.participants.map((account) => [account.participantId, account]));
  const editingParticipant = currentState.participants.find(({ id }) => id === editingParticipantId);
  const accountParticipant = currentState.participants.find(({ id }) => id === accountParticipantId);
  const withdrawEntry = currentState.entries.find(({ id }) => id === withdrawEntryId);
  const categoryIds = Object.keys(currentState.settings.prices).sort();

  async function replaceEvent(candidate: EventStateV1, summary: string) {
    setError("");
    try {
      await provider.dispatchEventCommand({ type: "event.replace", event: candidate, summary });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration update failed.");
      throw cause;
    }
  }

  async function saveParticipant(participant: Participant, entries: CarEntry[]) {
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const candidate: EventStateV1 = {
      ...currentState,
      participants: currentState.participants.map((current) => current.id === participant.id ? participant : current),
      entries: currentState.entries.map((entry) => entryById.get(entry.id) ?? entry),
    };
    await replaceEvent(candidate, `Updated participant ${participant.id} without changing stable IDs`);
    setEditingParticipantId(null);
  }

  async function setEntryActive(entry: CarEntry, active: boolean) {
    const candidate: EventStateV1 = {
      ...currentState,
      entries: currentState.entries.map((current) => current.id === entry.id ? { ...current, active } : current),
    };
    await replaceEvent(candidate, `${active ? "Restored" : "Withdrew"} car ${entry.carNumber} (${entry.id})`);
    setWithdrawEntryId(null);
  }

  async function savePrices() {
    const prices = { ...currentState.settings.prices };
    for (const categoryId of categoryIds) {
      const raw = priceDrafts[categoryId] ?? String(prices[categoryId]);
      const cents = Number(raw);
      if (!Number.isSafeInteger(cents) || cents < 0) {
        setError(`${categoryId} price must be a non-negative safe integer number of cents.`);
        return;
      }
      prices[categoryId] = cents;
    }
    await replaceEvent({ ...currentState, settings: { ...currentState.settings, prices } }, "Updated current category prices");
  }

  async function recordAccountEntry(participantId: string, kind: "payment" | "refund", amountCents: number) {
    const candidate: EventStateV1 = {
      ...currentState,
      payments: [...currentState.payments, {
        id: `account-${kind}-${participantId}-${currentState.payments.length + 1}`,
        participantId,
        amountCents,
        kind,
        paidAt: new Date().toISOString(),
        note: `Recorded in Pro registration account panel`,
      }],
    };
    await replaceEvent(candidate, `Recorded ${kind} for participant ${participantId}`);
  }

  return (
    <section className="page-frame registration-page" aria-labelledby="page-title">
      <p className="eyebrow">Entrants and accounts</p>
      <h2 id="page-title">Registration &amp; fees</h2>
      <div className="registration-controls">
        <label>Search registration<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Registration status<select value={status} onChange={(event) => setStatus(event.target.value as RegistrationStatus)}><option value="all">All cars</option><option value="active">Active</option><option value="withdrawn">Withdrawn</option></select></label>
        <label>Sort registration<select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="participant">Participant</option><option value="car-number">Car number</option></select></label>
        <button type="button" className="quiet-action" onClick={() => setDescending((value) => !value)}>{descending ? "Sort ascending" : "Sort descending"}</button>
      </div>

      <table className="registration-table" aria-label="Registered cars">
        <thead><tr><th scope="col">Car</th><th scope="col">Participant</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Account</th><th scope="col">Actions</th></tr></thead>
        <tbody>
          {visibleEntries.map((entry) => {
            const participant = participantById.get(entry.participantId)!;
            const account = accountByParticipant.get(participant.id)!;
            const refunded = currentState.payments.some((payment) => payment.participantId === participant.id && payment.kind === "refund");
            return (
              <tr key={entry.id}>
                <td data-label="Car"><span className="car-number">{entry.carNumber}</span> {entry.name}</td>
                <td data-label="Participant">{participant.name}</td>
                <td data-label="Category">{entry.categoryId}</td>
                <td data-label="Status"><span className="status-label">{entry.active ? "Active" : "Withdrawn"}</span></td>
                <td data-label="Account">{participant.name} · {formatAccountState(account, refunded)}</td>
                <td data-label="Actions" className="table-actions">
                  <button type="button" className="quiet-action" onClick={() => setEditingParticipantId(participant.id)}>Edit participant {participant.name}</button>
                  <button type="button" className="quiet-action" onClick={() => setAccountParticipantId(participant.id)}>Manage account {participant.name}</button>
                  {entry.active
                    ? <button type="button" className="danger-action" onClick={() => setWithdrawEntryId(entry.id)}>Withdraw car {entry.carNumber} {entry.name}</button>
                    : <button type="button" className="secondary-action" onClick={() => void setEntryActive(entry, true)}>Restore car {entry.carNumber} {entry.name}</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="feature-panel" aria-labelledby="category-prices-title">
        <h3 id="category-prices-title">Current category prices</h3>
        <p>Account charges always use these current integer-cent prices.</p>
        <div className="price-grid">
          {categoryIds.map((categoryId) => <label key={categoryId}>{categoryId} price in cents<input inputMode="numeric" value={priceDrafts[categoryId] ?? String(currentState.settings.prices[categoryId])} onChange={(event) => setPriceDrafts((current) => ({ ...current, [categoryId]: event.target.value }))} /></label>)}
        </div>
        <button type="button" onClick={() => void savePrices()}>Save category prices</button>
      </section>

      {editingParticipant ? <ParticipantEditor participant={editingParticipant} entries={currentState.entries.filter(({ participantId }) => participantId === editingParticipant.id)} allEntries={currentState.entries} onSave={saveParticipant} onCancel={() => setEditingParticipantId(null)} /> : null}
      {accountParticipant ? <AccountPanel participant={accountParticipant} account={accountByParticipant.get(accountParticipant.id)!} refunded={currentState.payments.some((payment) => payment.participantId === accountParticipant.id && payment.kind === "refund")} onRecord={(kind, amount) => recordAccountEntry(accountParticipant.id, kind, amount)} /> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}

      {withdrawEntry ? (
        <div className="modal-backdrop">
          <section className="confirmation-panel" role="alertdialog" aria-modal="true" aria-labelledby="withdraw-title">
            <h3 id="withdraw-title">Confirm car withdrawal</h3>
            <p>Car {withdrawEntry.carNumber} appears in {scheduledHeatCount(currentState, withdrawEntry.id)} scheduled heat{scheduledHeatCount(currentState, withdrawEntry.id) === 1 ? "" : "s"}.</p>
            <p>The car stays in event history and existing schedules. Future scheduling will exclude it while withdrawn.</p>
            <div className="action-row"><button type="button" className="danger-action" onClick={() => void setEntryActive(withdrawEntry, false)}>Confirm withdrawal</button><button type="button" className="quiet-action" onClick={() => setWithdrawEntryId(null)}>Keep car active</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function scheduledHeatCount(state: EventStateV1, entryId: string): number {
  return [...state.matches, ...state.finals].filter((heat) => heat.status === "scheduled" && heat.lanes.includes(entryId)).length;
}

function RegistrationUnavailable() {
  return (
    <section className="page-frame" aria-labelledby="page-title">
      <p className="eyebrow">Entrants and accounts</p>
      <h2 id="page-title">Registration &amp; fees</h2>
      <p>Open the installed application to manage local registration data.</p>
    </section>
  );
}
