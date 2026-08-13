import { useState } from "react";
import type { CarEntry, Participant } from "@rr3/domain";

type ParticipantEditorProps = {
  participant: Participant;
  entries: CarEntry[];
  allEntries: CarEntry[];
  onSave(participant: Participant, entries: CarEntry[]): Promise<void>;
  onCancel(): void;
};

export type NewCarDraft = {
  name: string;
  carNumber: number;
  categoryId: string;
};

type NewParticipantEditorProps = {
  categoryIds: string[];
  allEntries: CarEntry[];
  onSave(participant: Omit<Participant, "id">, cars: NewCarDraft[]): Promise<void>;
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

export function NewParticipantEditor({
  categoryIds,
  allEntries,
  onSave,
  onCancel,
}: NewParticipantEditorProps) {
  const nextNumber = Math.max(0, ...allEntries.map(({ carNumber }) => carNumber)) + 1;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cars, setCars] = useState<Array<{ name: string; number: string; categoryId: string }>>([
    { name: "", number: String(nextNumber), categoryId: categoryIds[0] ?? "" },
  ]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function updateCar(index: number, update: Partial<(typeof cars)[number]>) {
    setCars((current) => current.map((car, carIndex) => carIndex === index ? { ...car, ...update } : car));
  }

  async function save() {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("Participant name is required.");
      return;
    }
    if (normalizedName.length > 200 || email.trim().length > 320 || phone.trim().length > 64) {
      setError("Participant details exceed the supported length.");
      return;
    }
    const occupied = new Set(allEntries.filter(({ active }) => active).map(({ carNumber }) => carNumber));
    const used = new Set<number>();
    const nextCars: NewCarDraft[] = [];
    for (let index = 0; index < cars.length; index += 1) {
      const car = cars[index]!;
      const carName = car.name.trim();
      const carNumber = Number(car.number);
      if (!carName) {
        setError(`Car ${index + 1} name is required.`);
        return;
      }
      if (carName.length > 200) {
        setError(`Car ${index + 1} name must be 200 characters or fewer.`);
        return;
      }
      if (!Number.isSafeInteger(carNumber) || carNumber <= 0) {
        setError("Car numbers must be positive safe integers.");
        return;
      }
      if (occupied.has(carNumber) || used.has(carNumber)) {
        setError(`Active car number ${carNumber} is already used.`);
        return;
      }
      if (!categoryIds.includes(car.categoryId)) {
        setError(`Car ${index + 1} must use an available category.`);
        return;
      }
      used.add(carNumber);
      nextCars.push({ name: carName, carNumber, categoryId: car.categoryId });
    }

    setSaving(true);
    setError("");
    try {
      await onSave({ name: normalizedName, email: email.trim(), phone: phone.trim(), notes: "" }, nextCars);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Participant registration failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="participant-editor feature-panel" aria-label="Add participant" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>Add participant and cars</h3>
      <label>Participant name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Phone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      {cars.map((car, index) => (
        <fieldset key={index}>
          <legend>Car {index + 1}</legend>
          <label>Car {index + 1} name<input value={car.name} onChange={(event) => updateCar(index, { name: event.target.value })} /></label>
          <label>Car {index + 1} number<input type="number" min="1" value={car.number} onChange={(event) => updateCar(index, { number: event.target.value })} /></label>
          <label>Car {index + 1} category<select value={car.categoryId} onChange={(event) => updateCar(index, { categoryId: event.target.value })}>{categoryIds.map((categoryId) => <option key={categoryId} value={categoryId}>{categoryId}</option>)}</select></label>
        </fieldset>
      ))}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <div className="action-row">
        <button type="button" className="secondary-action" onClick={() => setCars((current) => [...current, { name: "", number: String(Math.max(nextNumber - 1, ...current.map(({ number }) => Number(number) || 0)) + 1), categoryId: categoryIds[0] ?? "" }])}>Add another car</button>
        <button type="submit" disabled={saving || categoryIds.length === 0}>Save participant</button>
        <button type="button" className="quiet-action" onClick={onCancel}>Cancel registration</button>
      </div>
    </form>
  );
}
