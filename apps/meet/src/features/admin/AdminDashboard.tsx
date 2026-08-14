import type { AdminOverview, OrganisationRole, SecurityEventPageItem } from "../../data/meetRepository";

export function AdminDashboard({ role, overview, securityEvents }: { role: OrganisationRole; overview: AdminOverview | null; securityEvents: readonly SecurityEventPageItem[] }) {
  if (role !== "owner" && role !== "admin") return null;
  return <section className="admin-dashboard" aria-labelledby="admin-heading"><div className="panel-heading"><div><p className="eyebrow">Organisation operations</p><h3 id="admin-heading">Admin dashboard</h3></div></div>
    {overview ? <><dl className="admin-facts"><div><dt>Active meets</dt><dd>{overview.activeMeetCount}</dd></div><div><dt>Running meets</dt><dd>{overview.runningMeetCount}</dd></div><div><dt>Stale advancement</dt><dd>{overview.staleAdvancementCount}</dd></div><div><dt>Unresolved ties</dt><dd>{overview.unresolvedTieCount}</dd></div></dl><section><h4>Recent activity</h4><ul>{overview.recentActivity.map((item) => <li key={item.id}><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time> · {item.action} · {item.actorId}</li>)}</ul></section></> : <p role="status">Admin facts are loading.</p>}
    <section><h4>Security events</h4>{securityEvents.length ? <ul>{securityEvents.map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time> · {event.eventType} · actor {event.actorId ?? "system"} · subject {event.subjectUserId ?? "none"}</li>)}</ul> : <p>No recent security events.</p>}</section>
  </section>;
}
