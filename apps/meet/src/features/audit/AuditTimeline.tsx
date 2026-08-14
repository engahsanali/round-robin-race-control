import { useMemo, useState } from "react";
import type { MeetAuditEvent } from "@rr3/meet-domain";

export function AuditTimeline({ events }: { events: readonly MeetAuditEvent[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => events.filter((event) => JSON.stringify(event).toLowerCase().includes(query.trim().toLowerCase())).slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)), [events, query]);
  return <section className="audit-timeline" aria-labelledby="audit-heading"><div className="panel-heading"><div><p className="eyebrow">Accountability</p><h3 id="audit-heading">Audit timeline</h3></div><label><span className="sr-only">Search audit</span><input type="search" aria-label="Search audit" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Actor, action, reason or value" /></label></div>
    <div role="feed" aria-label="Audit timeline">{visible.length ? visible.map((event) => <article key={event.id} aria-label={`${event.action} at ${event.timestamp}`}><header><strong>{event.action}</strong><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time></header><p>Actor {event.actorId} · {event.entityType} {event.entityId}</p>{event.reason ? <p>Reason: {event.reason}</p> : null}<details><summary role="button" aria-label="Show change details">Change details</summary><div className="audit-change"><section><h4>Before</h4><pre>{JSON.stringify(event.before, null, 2)}</pre></section><section><h4>After</h4><pre>{JSON.stringify(event.after, null, 2)}</pre></section></div></details></article>) : <p>No audit events match.</p>}</div>
  </section>;
}
