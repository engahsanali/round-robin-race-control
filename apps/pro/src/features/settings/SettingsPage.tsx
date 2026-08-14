import { useEffect, useRef, useState } from "react";
import type { EventStateV1 } from "@rr3/domain";
import { useOptionalEventState } from "../../state/EventProvider";

type SettingsDraft = {
  enableTiming: boolean;
  finalistCount: string;
  rankingMode: EventStateV1["settings"]["rankingMode"];
};

function draftFromEvent(event: EventStateV1 | null): SettingsDraft {
  return {
    enableTiming: event?.settings.enableTiming ?? false,
    finalistCount: String(event?.settings.finalistCount ?? 3),
    rankingMode: event?.settings.rankingMode ?? "competition",
  };
}

export function SettingsPage() {
  const eventState = useOptionalEventState();
  const event = eventState?.state ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState(() => draftFromEvent(event));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { setDraft(draftFromEvent(event)); }, [event?.event.updatedAt]);

  async function save() {
    if (!eventState || !event) return;
    const finalistCount = Number(draft.finalistCount);
    if (!Number.isSafeInteger(finalistCount) || finalistCount < 1 || finalistCount > 100) {
      setError("Finalist count must be a whole number from 1 to 100.");
      return;
    }
    setPending(true);
    setError("");
    setMessage("");
    try {
      const candidate = structuredClone(event);
      candidate.settings = {
        ...candidate.settings,
        enableTiming: draft.enableTiming,
        finalistCount,
        rankingMode: draft.rankingMode,
        allowSharedRanks: draft.rankingMode !== "ordinal",
      };
      await eventState.dispatchEventCommand({
        type: "event.replace",
        event: candidate,
        summary: "Updated competition settings",
      });
      setMessage("Competition settings saved to the current local workspace.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Settings could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="page-frame settings-page" aria-labelledby="page-title">
      <p className="eyebrow">Race policy</p>
      <h2 ref={headingRef} id="page-title" tabIndex={-1}>Settings</h2>
      <p className="page-intro">Competition settings are stored with this event and recorded in its local audit history.</p>

      <section className="feature-panel" aria-label="Competition settings">
        <h3>Competition settings</h3>
        {!event ? (
          <p>Create or load an event before changing its competition policy.</p>
        ) : (
          <div className="settings-grid">
            <label>Ranking mode
              <select value={draft.rankingMode} onChange={(change) => setDraft((value) => ({ ...value, rankingMode: change.target.value as SettingsDraft["rankingMode"] }))}>
                <option value="competition">Competition ranks</option>
                <option value="dense">Dense ranks</option>
                <option value="ordinal">Ordinal after complete tie breaks</option>
              </select>
            </label>
            <label>Finalist count
              <input type="number" min="1" max="100" inputMode="numeric" value={draft.finalistCount} onChange={(change) => setDraft((value) => ({ ...value, finalistCount: change.target.value }))} />
            </label>
            <label className="checkbox-control"><input type="checkbox" checked={draft.enableTiming} onChange={(change) => setDraft((value) => ({ ...value, enableTiming: change.target.checked }))} /> Record lane times</label>
            <button type="button" onClick={() => void save()} disabled={pending}>Save competition settings</button>
          </div>
        )}
        <p role="status" aria-label="Settings result">{message}</p>
        {error ? <p role="alert">{error}</p> : null}
      </section>

      <section className="feature-panel" aria-label="Privacy and presentation limits">
        <h3>Privacy and presentation</h3>
        <p>Event data remains local to this browser. Presentation updates work only between same-origin tabs in the same browser and device.</p>
        <p><strong>Cloud sync is not included.</strong> Download an Event Pack for a durable portable backup or cross-edition transfer.</p>
      </section>
    </section>
  );
}
