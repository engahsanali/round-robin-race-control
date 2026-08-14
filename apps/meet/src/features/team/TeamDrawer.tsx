import { useMemo, useRef, useState } from "react";
import type { OrganisationRole, TeamMember } from "../../data/meetRepository";

export type TeamActions = {
  createInvitation(role: OrganisationRole): void | Promise<void>;
  revokeInvitation(invitationId: string): void | Promise<void>;
  removeMember(userId: string, reason: string): void | Promise<void>;
};

export function TeamDrawer({ role, members, actions }: { role: OrganisationRole; members: readonly TeamMember[]; actions: TeamActions }) {
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [reason, setReason] = useState("");
  const [inviteRole, setInviteRole] = useState<OrganisationRole>("viewer");
  const removalTrigger = useRef<HTMLButtonElement | null>(null);
  const canManage = role === "owner" || role === "admin";
  const visibleMembers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return members;
    return members.filter((member) => `${member.displayName} ${member.email ?? ""} ${member.role}`.toLocaleLowerCase().includes(needle));
  }, [members, search]);
  const closeRemoval = () => {
    setRemoving(null);
    setReason("");
    removalTrigger.current?.focus();
  };

  return (
    <aside className="team-drawer" aria-labelledby="team-heading">
      <div data-testid="team-drawer-background" inert={removing ? true : undefined} aria-hidden={removing ? true : undefined}>
        <header>
          <p className="eyebrow">Organisation access</p>
          <h2 id="team-heading">Team directory</h2>
          <p>Your role: <strong>{roleLabel(role)}</strong></p>
        </header>
        <label>
          <span>Search members</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {canManage ? (
          <div className="team-actions">
            <label>
              <span>Invitation role</span>
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as OrganisationRole)}>
                {(["viewer", "marshal", "organiser", "admin", ...(role === "owner" ? ["owner"] : [])] as OrganisationRole[]).map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void actions.createInvitation(inviteRole)}>Create invitation</button>
          </div>
        ) : null}
        <ul className="member-list">
          {visibleMembers.map((member) => (
            <li key={member.userId}>
              <div><strong>{member.displayName}</strong><span>{roleLabel(member.role)}</span>{member.email ? <small>{member.email}</small> : null}</div>
              {canManage && member.role !== "owner" ? <button type="button" className="quiet-danger" onClick={(event) => { removalTrigger.current = event.currentTarget; setRemoving(member); setReason(""); }}>Remove {member.displayName}</button> : null}
            </li>
          ))}
        </ul>
      </div>
      {removing ? (
        <section className="remove-confirmation" role="dialog" aria-modal="true" aria-labelledby="remove-heading" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeRemoval(); } }}>
          <h3 id="remove-heading">Remove {removing.displayName}?</h3>
          <p>The server will prevent removal of the final owner.</p>
          <label>
            <span>Reason for removal</span>
            <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="button-row">
            <button type="button" disabled={reason.trim().length === 0} onClick={() => { void actions.removeMember(removing.userId, reason.trim()); closeRemoval(); }}>Confirm removal</button>
            <button type="button" className="quiet-action" onClick={closeRemoval}>Cancel</button>
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function roleLabel(role: OrganisationRole): string {
  if (role === "owner") return "Owner / Admin";
  if (role === "marshal") return "Race Marshal";
  return role.charAt(0).toUpperCase() + role.slice(1);
}
