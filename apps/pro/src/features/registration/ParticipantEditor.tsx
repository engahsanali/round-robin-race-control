import { useState } from "react";
import type { CarEntry, Participant } from "@rr3/domain";

type ParticipantEditorProps = {
  participant: Participant;
  entries: CarEntry[];
  allEntries: CarEntry[];
  onSave(participant: Participant, entries: CarEntry[]): Promise<void>;
  onCancel(): void;
};

export function ParticipantEditor({
  participant,
  entries,
  allEntries,
  onSave,
  onCancel,
}: ParticipantEditorProps) {
  const [name, setName] = useState(participant.name);
  const [email, setEmail] = useState(participant.email);
  const [phone, setPhone] = useState(participant.phone);
  const [numbers, setNumbers] = useState(() => Object.fromEntries(entries.map((entry) => [entry.id, String(entry.carNumber)])));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("Participant name is required.");
      return;
    }
    const ownIds = new Set(entries.map(({ id }) => id));
    const occupied = new Set(allEntries.filter(({ active, id }) => active && !ownIds.has(id)).map(({ carNumber }) => carNumber));
    const nextEntries = entries.map((entry) => ({ ...entry, carNumber: Number(numbers[entry.id]) }));
    const used = new Set<number>();
    for (const entry of nextEntries) {
      if (!Number.isSafeInteger(entry.carNumber) || entry.carNumber <= 0) {
        setError("Car numbers must be positive safe integers.");
        return;
      }
      if (entry.active && (occupied.has(entry.carNumber) || used.has(entry.carNumber))) {
        setError(`Active car number ${entry.carNumber} is already used.`);
        return;
      }
      if (entry.active) used.add(entry.carNumber);
    }

    setSaving(true);
    setError("");
    try {
      await onSave({ ...participant, name: normalizedName, email: email.trim(), phone: phone.trim() }, nextEntries);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Participant update failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="participant-editor feature-panel" aria-label={`Edit ${participant.name}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>Edit participant</h3>
      <label>Participant name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Phone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      {entries.map((entry) => (
        <label key={entry.id}>
          {entry.name} car number
          <input
            type="number"
            min="1"
            value={numbers[entry.id]}
            onChange={(event) => setNumbers((current) => ({ ...current, [entry.id]: event.target.value }))}
          />
        </label>
      ))}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <div className="action-row">
        <button type="submit" disabled={saving}>Save participant</button>
        <button type="button" className="quiet-action" onClick={onCancel}>Cancel edit</button>
      </div>
    </form>
  );
}
