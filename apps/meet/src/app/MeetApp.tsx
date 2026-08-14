import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AuthBoundary, useMeetSession, type AuthPort } from "./AuthBoundary";
import { MeetProviders } from "./MeetProviders";
import { AuthPanel } from "../features/auth/AuthPanel";
import { TeamDrawer, type TeamActions } from "../features/team/TeamDrawer";
import { createDemoRepository } from "../data/demoRepository";
import { createRequestId, type MeetRepository, type OrganisationRole, type OrganisationSummary, type TeamMember } from "../data/meetRepository";

const CREATOR_CREDIT = "Made by Cesar Lacsamana and Ahsan Ali";

export function MeetApp({
  productionRepository,
  auth,
  initialMode = "welcome",
}: {
  productionRepository: MeetRepository | null;
  auth: AuthPort | null;
  initialMode?: "welcome" | "demo";
}) {
  const [demo, setDemo] = useState(initialMode === "demo");
  if (demo) return <DemoWorkspace onExit={() => setDemo(false)} />;
  return (
    <div className="meet-app">
      <BrandHeader badge="Hosted Meet Edition" />
      <main id="main-content" tabIndex={-1}>
        {auth && productionRepository ? (
          <AuthBoundary auth={auth}>
            <OfficialGate repository={productionRepository} />
          </AuthBoundary>
        ) : (
          <section className="welcome-grid">
            <div className="hero-card">
              <p className="eyebrow">Account configuration required</p>
              <h2>Sign in to Meet Edition</h2>
              <p>The official workspace opens only after secure authentication and an active organisation membership.</p>
              <p className="safe-notice">Add the Supabase URL and browser publishable key in the hosting environment to enable accounts.</p>
            </div>
          </section>
        )}
        <section className="demo-strip" aria-label="Demonstration mode">
          <div><p className="eyebrow">No account needed</p><h2>Explore the race-control shape safely</h2><p>The compiled demo is read-only and never connects to production Auth, data or Realtime.</p></div>
          <button type="button" onClick={() => setDemo(true)}>Explore read-only demo</button>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function OfficialGate({ repository }: { repository: MeetRepository }) {
  const authState = useMeetSession();
  const [organisations, setOrganisations] = useState<OrganisationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingMemberships, setLoadingMemberships] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);

  useEffect(() => {
    if (!authState.session) { setOrganisations([]); setSelectedId(null); return; }
    const controller = new AbortController();
    setLoadingMemberships(true);
    void repository.listOrganisations(authState.session.user.id, controller.signal).then((values) => {
      if (controller.signal.aborted) return;
      setOrganisations(values);
      setSelectedId((current) => current && values.some((value) => value.id === current) ? current : values[0]?.id ?? null);
      setMembershipError(null);
    }).catch(() => {
      if (!controller.signal.aborted) setMembershipError("Organisation membership could not be loaded safely.");
    }).finally(() => { if (!controller.signal.aborted) setLoadingMemberships(false); });
    return () => controller.abort();
  }, [authState.session, repository]);

  if (authState.loading) return <section className="center-card"><p role="status">Checking secure session…</p></section>;
  if (!authState.session) return <AuthPanel authState={authState} />;
  const selected = organisations.find((organisation) => organisation.id === selectedId) ?? null;
  const refresh = async () => {
    const values = await repository.listOrganisations(authState.session!.user.id);
    setOrganisations(values);
    setSelectedId((current) => current && values.some((value) => value.id === current) ? current : values[0]?.id ?? null);
  };
  return (
    <MeetProviders organisations={organisations} selected={selected}>
      {loadingMemberships ? <section className="center-card"><p role="status">Loading authorised organisations…</p></section> : selected ? (
        <OfficialWorkspace repository={repository} organisation={selected} organisations={organisations} onSelect={setSelectedId} onSignOut={() => authState.controller.signOut()} />
      ) : (
        <OrganisationOnboarding repository={repository} onJoined={() => void refresh()} onSignOut={() => authState.controller.signOut()} error={membershipError} />
      )}
    </MeetProviders>
  );
}

function OrganisationOnboarding({ repository, onJoined, onSignOut, error }: { repository: MeetRepository; onJoined(): void; onSignOut(): Promise<void>; error: string | null }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(error);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const receipt = await repository.createOrganisation(name.trim(), slug.trim(), createRequestId());
    if (!receipt.ok) setStatus(receipt.message); else { setStatus("Organisation created."); onJoined(); }
  };
  const join = async (event: FormEvent) => {
    event.preventDefault();
    const receipt = await repository.redeemInvitation(code.trim(), createRequestId());
    setCode("");
    if (!receipt.ok) setStatus(receipt.message); else { setStatus("Invitation accepted."); onJoined(); }
  };
  return (
    <section className="onboarding" aria-labelledby="organisation-heading">
      <div className="section-heading"><div><p className="eyebrow">Authorised access</p><h2 id="organisation-heading">Create or join an organisation</h2></div><button type="button" className="quiet-action" onClick={() => void onSignOut()}>Sign out</button></div>
      <div className="onboarding-grid">
        <form onSubmit={(event) => void create(event)}><h3>Start a team</h3><label><span>Organisation name</span><input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>Short URL slug</span><input required pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} /></label><button type="submit">Create organisation</button></form>
        <form onSubmit={(event) => void join(event)}><h3>Join a team</h3><p>Enter the single-use invitation code an owner shared with you directly.</p><label><span>Invitation code</span><input required autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} /></label><button type="submit">Redeem invitation</button></form>
      </div>
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}

function OfficialWorkspace({ repository, organisation, organisations, onSelect, onSignOut }: { repository: MeetRepository; organisation: OrganisationSummary; organisations: readonly OrganisationSummary[]; onSelect(id: string): void; onSignOut(): Promise<void> }) {
  const [teamOpen, setTeamOpen] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitation, setInvitation] = useState<{ id: string; code: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void repository.listMembers(organisation.id).then((values) => { if (active) setMembers(values); }).catch(() => { if (active) setNotice("Team directory is temporarily unavailable."); });
    return () => { active = false; };
  }, [organisation.id, repository]);
  const teamActions = useMemo<TeamActions>(() => ({
    createInvitation: async (role) => {
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const receipt = await repository.createInvitation(organisation.id, role, expiresAt, createRequestId());
      if (!receipt.ok) setNotice(receipt.message);
      else if (receipt.value.code) { setInvitation({ id: receipt.value.invitation_id, code: receipt.value.code }); setNotice("Copy this code now. It is shown only once."); }
      else setNotice("This invitation already exists; its secret code cannot be shown again.");
    },
    revokeInvitation: async (id) => {
      const receipt = await repository.revokeInvitation(id, createRequestId());
      setInvitation(null); setNotice(receipt.ok ? "Invitation revoked." : receipt.message);
    },
    removeMember: async (userId, reason) => {
      const receipt = await repository.removeMembership(organisation.id, userId, reason, createRequestId());
      if (!receipt.ok) setNotice(receipt.message);
      else { setMembers(await repository.listMembers(organisation.id)); setNotice("Member removed with an audit record."); }
    },
  }), [organisation.id, repository]);
  return (
    <section className="official-workspace" aria-labelledby="workspace-heading">
      <div className="workspace-toolbar">
        <div><p className="eyebrow">Official workspace</p><h2 id="workspace-heading">{organisation.name}</h2></div>
        <label><span>Organisation</span><select value={organisation.id} onChange={(event) => onSelect(event.target.value)}>{organisations.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <span className="role-pill">{organisation.role}</span>
        <button type="button" onClick={() => setTeamOpen((value) => !value)}>{teamOpen ? "Close team" : "Open team"}</button>
        <button type="button" className="quiet-action" onClick={() => void onSignOut()}>Sign out</button>
      </div>
      {invitation ? <section className="invitation-receipt"><h3>Single-use invitation code</h3><output>{invitation.code}</output><button type="button" className="quiet-danger" onClick={() => void teamActions.revokeInvitation(invitation.id)}>Revoke invitation</button></section> : null}
      {notice ? <p role="status" className="safe-notice">{notice}</p> : null}
      {teamOpen ? <TeamDrawer role={organisation.role} members={members} actions={teamActions} /> : null}
      <section className="workbook-placeholder"><div><span className="live-dot" aria-hidden="true" /><p>Connected account shell</p></div><h3>Meet workbook foundation ready</h3><p>Choose or create a meet next. Bracket sheets, live race controls and progression attach here without route switching.</p></section>
    </section>
  );
}

function DemoWorkspace({ onExit }: { onExit(): void }) {
  const demo = useMemo(createDemoRepository, []);
  const meet = useMemo(() => demo.load(), [demo]);
  return (
    <div className="meet-app demo-mode">
      <BrandHeader badge="Demo workspace · read-only" />
      <main id="main-content" className="demo-workspace">
        <section className="workspace-toolbar"><div><p className="eyebrow">Demo workspace</p><h2>{meet.meet.name}</h2></div><span className="role-pill">Read-only Viewer</span><button type="button" onClick={onExit}>Exit demo</button></section>
        <section className="demo-sheet"><div className="sheet-tab">Q1</div><div><p className="eyebrow">Qualifier · {meet.meet.venue}</p><h3>{meet.brackets[0]?.name}</h3><p>This safe preview is compiled into the app. It cannot read or write production data.</p></div><dl><div><dt>Brackets</dt><dd>{meet.brackets.length}</dd></div><div><dt>Status</dt><dd>{meet.meet.status}</dd></div><div><dt>Mode</dt><dd>Read-only</dd></div></dl></section>
      </main>
      <Footer />
    </div>
  );
}

function BrandHeader({ badge }: { badge: string }) {
  return <><a href="#main-content" className="skip-link">Skip to Meet workspace</a><header className="brand-header"><span className="product-mark" aria-hidden="true">RR · 3</span><div><p className="edition-label">{badge}</p><h1>Round Robin Race Control</h1></div><span className="hosted-pill">Accountable · Realtime-ready</span></header></>;
}
function Footer() { return <footer><p>{CREATOR_CREDIT}</p><p>Operational tracking only · no advertising trackers.</p></footer>; }
