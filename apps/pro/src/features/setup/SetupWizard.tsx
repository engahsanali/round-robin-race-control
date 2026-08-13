import { useMemo, useState } from "react";
import type { CarEntry, EventStateV1, Participant } from "@rr3/domain";
import { useOptionalOfficialEventState } from "../../state/EventProvider";
import { useOptionalRehearsalWorkspace } from "../../state/RehearsalWorkspace";

type WorkspaceKind = "real" | "demo";
type DraftCar = { name: string; carNumber: string };

const stepLabels = ["Event details", "Categories & prices", "Entrants & cars", "Competition policy", "Review & create"];

export function SetupWizard() {
  const eventState = useOptionalOfficialEventState();
  const rehearsal = useOptionalRehearsalWorkspace();
  const [step, setStep] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceKind>("real");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [price, setPrice] = useState("1200");
  const [participantName, setParticipantName] = useState("");
  const [cars, setCars] = useState<DraftCar[]>([{ name: "", carNumber: "1" }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const heading = `${step + 1}. ${stepLabels[step]}`;
  const parsedPrice = Number(price);
  const activeCarCount = cars.filter((car) => car.name.trim()).length;
  const reviewSummary = useMemo(
    () => `${activeCarCount} active car${activeCarCount === 1 ? "" : "s"} · Standard ${formatMoney(Number.isSafeInteger(parsedPrice) ? parsedPrice : 0)}`,
    [activeCarCount, parsedPrice],
  );

  function goFromDetails() {
    const nextErrors: string[] = [];
    if (!name.trim()) nextErrors.push("Event name is required.");
    if (!date) nextErrors.push("Event date is required.");
    setErrors(nextErrors);
    if (nextErrors.length === 0) setStep(1);
  }

  function goFromPrices() {
    if (!Number.isSafeInteger(parsedPrice) || parsedPrice < 0) {
      setErrors(["Price must be a non-negative safe integer number of cents."]);
      return;
    }
    setErrors([]);
    setStep(2);
  }

  function goFromEntrants() {
    const used = new Set<number>();
    const nextErrors: string[] = [];
    if (!participantName.trim()) nextErrors.push("Participant name is required.");
    for (const car of cars) {
      const number = Number(car.carNumber);
      if (!car.name.trim()) nextErrors.push("Every car needs a name.");
      if (!Number.isSafeInteger(number) || number <= 0) {
        nextErrors.push("Car numbers must be positive safe integers.");
      } else if (used.has(number)) {
        nextErrors.push(`Active car number ${number} is already used.`);
      }
      used.add(number);
    }
    setErrors(nextErrors);
    if (nextErrors.length === 0) setStep(3);
  }

  async function createEvent() {
    if (workspace === "real" && !eventState) return;
    if (workspace === "demo" && !rehearsal) return;
    setSubmitting(true);
    setErrors([]);
    try {
      const timestamp = new Date().toISOString();
      const eventId = workspace === "demo"
        ? `demo-rehearsal-${slug(name) || "event"}`
        : `event-${slug(name) || "race"}`;
      const participantId = `${eventId}-participant-1`;
      const participants: Participant[] = [{
        id: participantId,
        name: participantName.trim(),
        email: "",
        phone: "",
        notes: "",
      }];
      const entries: CarEntry[] = cars.map((car, index) => ({
        id: `${eventId}-car-${index + 1}`,
        participantId,
        carNumber: Number(car.carNumber),
        name: car.name.trim(),
        categoryId: "standard",
        quantity: 1,
        active: true,
      }));
      const event: EventStateV1 = {
        version: 1,
        event: {
          id: eventId,
          name: workspace === "demo" ? `Demo rehearsal — ${name.trim()}` : name.trim(),
          date,
          venue: venue.trim(),
          organizer: organizer.trim(),
          laneCount: 3,
          status: "setup",
          createdAt: timestamp,
          updatedAt: timestamp,
          resultSeal: "draft",
        },
        settings: {
          scheduleMode: "custom",
          seed: `${eventId}-seed`,
          rankingMode: "competition",
          allowSharedRanks: true,
          tieBreakOrder: ["totalWins", "headToHead", "playoff"],
          finalistCount: 3,
          autoSave: true,
          confirmWinnerChanges: true,
          enableTiming: false,
          prices: { standard: parsedPrice },
        },
        participants,
        entries,
        matches: [],
        finals: [],
        payments: [],
        auditLog: workspace === "demo" ? [{
          id: `${eventId}-audit-workspace`,
          timestamp,
          action: "workspace.demo-created",
          summary: "Created an isolated demo rehearsal workspace.",
          entityType: "event",
          entityId: eventId,
          details: { workspace: "demo-rehearsal" },
        }] : [],
      };
      if (workspace === "demo") {
        rehearsal!.begin(event);
      } else {
        await eventState!.dispatchEventCommand({
          type: "event.replace",
          event,
          summary: "Created real event workspace",
        });
      }
      setNotice(workspace === "demo"
        ? `${name.trim()} was created as an isolated demo rehearsal.`
        : `${name.trim()} was created as a real event.`);
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : "Event creation failed."]);
    } finally {
      setSubmitting(false);
    }
  }

  if (!eventState && !rehearsal) return <SetupUnavailable />;
  if (eventState?.loading) return <p role="status">Loading local event workspace…</p>;

  return (
    <section className="setup-wizard feature-panel" aria-labelledby="setup-step-title">
      <p className="step-count">Step {step + 1} of 5</p>
      <h3 id="setup-step-title">{heading}</h3>
      {step === 0 ? (
        <div className="form-stack">
          <fieldset>
            <legend>Workspace type</legend>
            <label><input type="radio" name="workspace" checked={workspace === "real"} onChange={() => setWorkspace("real")} /> Real event</label>
            <label><input type="radio" name="workspace" checked={workspace === "demo"} onChange={() => setWorkspace("demo")} /> Demo rehearsal</label>
          </fieldset>
          <label>Event name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Event date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>Venue<input value={venue} onChange={(event) => setVenue(event.target.value)} /></label>
          <label>Organizer<input value={organizer} onChange={(event) => setOrganizer(event.target.value)} /></label>
          <button type="button" onClick={goFromDetails}>Next: Categories</button>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="form-stack">
          <label>Standard price in cents<input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
          <button type="button" onClick={goFromPrices}>Next: Entrants</button>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="form-stack">
          <label>Participant name<input value={participantName} onChange={(event) => setParticipantName(event.target.value)} /></label>
          {cars.map((car, index) => (
            <fieldset key={index}>
              <legend>Car {index + 1}</legend>
              <label>Car {index + 1} name<input value={car.name} onChange={(event) => updateCar(setCars, index, "name", event.target.value)} /></label>
              <label>Car {index + 1} number<input type="number" min="1" value={car.carNumber} onChange={(event) => updateCar(setCars, index, "carNumber", event.target.value)} /></label>
            </fieldset>
          ))}
          <button type="button" className="secondary-action" onClick={() => setCars((current) => [...current, { name: "", carNumber: String(current.length + 1) }])}>Add another car</button>
          <button type="button" onClick={goFromEntrants}>Next: Competition</button>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="form-stack">
          <p>Competition ranking: shared competition ranks, then head-to-head, then an explicit playoff.</p>
          <p>Schedule activation remains a separate validated action in Schedule Lab.</p>
          <button type="button" onClick={() => { setErrors([]); setStep(4); }}>Review event</button>
        </div>
      ) : null}
      {step === 4 ? (
        <div className="review-panel">
          <strong>{workspace === "demo" ? "Demo rehearsal — isolated practice data" : "Real event — official workspace"}</strong>
          <p>{reviewSummary}</p>
          <button type="button" disabled={submitting} onClick={() => void createEvent()}>
            {workspace === "demo" ? "Create demo rehearsal" : "Create real event"}
          </button>
        </div>
      ) : null}
      {errors.length ? <div className="inline-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
      {notice ? <p role="status" className="success-notice">{notice}</p> : null}
    </section>
  );
}

function SetupUnavailable() {
  return (
    <section className="feature-panel">
      <h3>Guided setup</h3>
      <p>Open the installed application to create a validated local event.</p>
    </section>
  );
}

function updateCar(
  setCars: React.Dispatch<React.SetStateAction<DraftCar[]>>,
  index: number,
  field: keyof DraftCar,
  value: string,
) {
  setCars((current) => current.map((car, carIndex) => carIndex === index ? { ...car, [field]: value } : car));
}

function slug(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 60);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}
