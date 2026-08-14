import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { MeetStateV1 } from "@rr3/meet-domain";
import { AuthBoundary, useMeetSession, type AuthPort } from "./AuthBoundary";
import { MeetProviders } from "./MeetProviders";
import { AuthPanel } from "../features/auth/AuthPanel";
import { TeamDrawer, type TeamActions } from "../features/team/TeamDrawer";
import { createDemoRepository } from "../data/demoRepository";
import { createRequestId, type CommandReceipt, type MeetRepository, type MeetSummary, type OrganisationRole, type OrganisationSummary, type TeamMember } from "../data/meetRepository";
import { useMeetStore } from "../state/MeetStore";
import { WorkbookWorkspace, type WorkbookActions, type WorkbookActionResult } from "../features/workbook/WorkbookWorkspace";

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

  if (authState.recoveryMode) return <AuthPanel authState={authState} />;
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
  const requestIds = useRef(new Map<string, string>());
  const { runCommand, dispatch } = useMeetStore();
  const run = async <T,>(key: string, command: (requestId: string) => Promise<CommandReceipt<T>>) => {
    const requestId = requestIds.current.get(key) ?? createRequestId();
    requestIds.current.set(key, requestId);
    const receipt = await runCommand(requestId, () => command(requestId));
    if (!(receipt.ok === false && receipt.kind === "duplicate")) requestIds.current.delete(key);
    return receipt;
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const receipt = await run("create-organisation", (requestId) => repository.createOrganisation(name.trim(), slug.trim(), requestId));
    if (!receipt.ok) setStatus(receipt.message); else { setStatus("Organisation created."); onJoined(); }
  };
  const join = async (event: FormEvent) => {
    event.preventDefault();
    const receipt = await run("redeem-invitation", (requestId) => repository.redeemInvitation(code.trim(), requestId));
    setCode("");
    if (!receipt.ok) setStatus(receipt.message); else { setStatus("Invitation accepted."); onJoined(); }
  };
  return (
    <section className="onboarding" aria-labelledby="organisation-heading">
      <div className="section-heading"><div><p className="eyebrow">Authorised access</p><h2 id="organisation-heading">Create or join an organisation</h2></div><button type="button" className="quiet-action" onClick={() => { dispatch({ type: "session.cleared" }); void onSignOut(); }}>Sign out</button></div>
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
  const [meets, setMeets] = useState<MeetSummary[]>([]);
  const [selectedMeetId, setSelectedMeetId] = useState<string | null>(null);
  const [heatVersions, setHeatVersions] = useState<Readonly<Record<string, number>>>({});
  const [loadingMeet, setLoadingMeet] = useState(true);
  const [invitation, setInvitation] = useState<{ id: string; code: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const { runCommand, dispatch, capabilities, state } = useMeetStore();
  const run = async <T,>(key: string, command: (requestId: string) => Promise<CommandReceipt<T>>) => {
    const requestId = requestIds.current.get(key) ?? createRequestId();
    requestIds.current.set(key, requestId);
    const receipt = await runCommand(requestId, () => command(requestId));
    if (!(receipt.ok === false && receipt.kind === "duplicate")) requestIds.current.delete(key);
    return receipt;
  };
  useEffect(() => {
    let active = true;
    void repository.listMembers(organisation.id).then((values) => { if (active) setMembers(values); }).catch(() => { if (active) setNotice("Team directory is temporarily unavailable."); });
    return () => { active = false; };
  }, [organisation.id, repository]);
  useEffect(() => {
    let active = true;
    setLoadingMeet(true);
    void repository.listMeets(organisation.id).then((values) => {
      if (!active) return;
      setMeets(values);
      setSelectedMeetId((current) => current && values.some((meet) => meet.id === current) ? current : values[0]?.id ?? null);
      if (values.length === 0) {
        dispatch({ type: "snapshot.loaded", snapshot: starterMeet(), syncedAt: new Date().toISOString() });
        setLoadingMeet(false);
      }
    }).catch(() => { if (active) { setNotice("Meet list could not be loaded safely."); setLoadingMeet(false); } });
    return () => { active = false; };
  }, [dispatch, organisation.id, repository]);
  const reloadMeet = useCallback(async (meetId = selectedMeetId) => {
    if (!meetId) return false;
    setLoadingMeet(true);
    const receipt = await repository.loadMeet(organisation.id, meetId);
    if (!receipt.ok) { setNotice(receipt.message); setLoadingMeet(false); return false; }
    setHeatVersions(receipt.heatVersions);
    dispatch({ type: "meet.selected", meetId });
    dispatch({ type: "snapshot.loaded", snapshot: receipt.value, syncedAt: new Date().toISOString() });
    setLoadingMeet(false);
    return true;
  }, [dispatch, organisation.id, repository, selectedMeetId]);
  useEffect(() => { if (selectedMeetId) void reloadMeet(selectedMeetId); }, [reloadMeet, selectedMeetId]);
  useEffect(() => {
    if (!selectedMeetId || !state.snapshot || state.snapshot.meet.id !== selectedMeetId) return;
    return repository.watchMeet(organisation.id, selectedMeetId, {
      bracketIds: state.snapshot.brackets.map((bracket) => bracket.id),
      onSnapshot: (snapshot, syncedAt) => dispatch({ type: "realtime.snapshot", snapshot, syncedAt }),
      onStatus: (status) => dispatch({ type: "connection.changed", status }),
      isDirty: () => state.formDirty,
      onDirtyUpdate: () => dispatch({ type: "form.dirty", dirty: true }),
      onError: (message) => setNotice(message),
    });
  }, [dispatch, organisation.id, repository, selectedMeetId, state.formDirty, state.snapshot]);
  const teamActions = useMemo<TeamActions>(() => ({
    createInvitation: async (role) => {
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const receipt = await run(`invite:${role}`, (requestId) => repository.createInvitation(organisation.id, role, expiresAt, requestId));
      if (!receipt.ok) setNotice(receipt.message);
      else if (receipt.value.code) { setInvitation({ id: receipt.value.invitation_id, code: receipt.value.code }); setNotice("Copy this code now. It is shown only once."); }
      else setNotice("This invitation already exists; its secret code cannot be shown again.");
    },
    revokeInvitation: async (id) => {
      const receipt = await run(`revoke:${id}`, (requestId) => repository.revokeInvitation(id, requestId));
      setInvitation(null); setNotice(receipt.ok ? "Invitation revoked." : receipt.message);
    },
    removeMember: async (userId, reason) => {
      const receipt = await run(`remove:${userId}`, (requestId) => repository.removeMembership(organisation.id, userId, reason, requestId));
      if (!receipt.ok) setNotice(receipt.message);
      else { setMembers((current) => current.filter((member) => member.userId !== userId)); setNotice(receipt.advisory?.message ?? "Member removed with an audit record."); }
    },
  }), [organisation.id, repository, runCommand]);
  const asAction = useCallback(async <T,>(key: string, command: (requestId: string) => Promise<CommandReceipt<T>>, refresh = true): Promise<WorkbookActionResult> => {
    const receipt = await run(key, command);
    if (!receipt.ok) return { ok: false, message: receipt.message };
    if (refresh) await reloadMeet();
    return { ok: true, message: receipt.advisory?.message ?? "Saved with an official audit receipt." };
  }, [reloadMeet, runCommand]);
  const workbookActions = useMemo<WorkbookActions>(() => ({
    saveSetup: async (snapshot) => {
      const requestId = createRequestId();
      const receipt = await runCommand(requestId, () => repository.saveMeetWorkbook(organisation.id, selectedMeetId, selectedMeetId ? snapshot.meet.version : null, workbookPayload(snapshot), requestId));
      if (!receipt.ok) return { ok: false, message: receipt.message };
      const meetId = receipt.value.meet_id;
      setSelectedMeetId(meetId);
      setMeets((current) => current.some((meet) => meet.id === meetId) ? current : [...current, { id: meetId, organisationId: organisation.id, name: snapshot.meet.name, venue: snapshot.meet.venue, date: snapshot.meet.date, status: snapshot.meet.status, version: receipt.value.version }]);
      await reloadMeet(meetId);
      return { ok: true, message: "Meet workbook saved atomically." };
    },
    saveRegistration: ({ bracketId, expectedVersion, rows }) => asAction(`registration:${bracketId}`, (requestId) => repository.saveRegistrationBatch(bracketId, expectedVersion, rows, requestId)),
    activateSchedule: ({ bracketId, expectedVersion, candidate, replacementReason }) => asAction(`schedule:${bracketId}`, (requestId) => repository.activateBracketSchedule(bracketId, expectedVersion, candidate, replacementReason, requestId)),
    confirmWinner: ({ heatId, winnerId, laneTimes, expectedVersion }) => asAction(`winner:${heatId}`, (requestId) => repository.confirmHeatWinnerMs(heatId, winnerId, laneTimes, expectedVersion, requestId)),
    correctWinner: ({ heatId, winnerId, laneTimes, expectedVersion, reason }) => asAction(`correction:${heatId}`, (requestId) => repository.correctHeatWinnerMs(heatId, winnerId, laneTimes, expectedVersion, reason, requestId)),
  }), [asAction, organisation.id, reloadMeet, repository, runCommand, selectedMeetId]);
  return (
    <section className="official-meet-shell" aria-labelledby="workspace-heading">
      <div className="workspace-toolbar organisation-toolbar">
        <div><p className="eyebrow">Official workspace</p><h2 id="workspace-heading">{organisation.name}</h2></div>
        <label><span>Organisation</span><select value={organisation.id} onChange={(event) => onSelect(event.target.value)}>{organisations.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <span className="role-pill">{organisation.role}</span>
        <button type="button" disabled={!capabilities.read} onClick={() => setTeamOpen((value) => !value)}>{teamOpen ? "Close team" : "Open team"}</button>
        <button type="button" className="quiet-action" onClick={() => { dispatch({ type: "session.cleared" }); void onSignOut(); }}>Sign out</button>
      </div>
      {meets.length > 1 ? <label className="meet-picker"><span>Meet</span><select value={selectedMeetId ?? ""} onChange={(event) => setSelectedMeetId(event.target.value)}>{meets.map((meet) => <option value={meet.id} key={meet.id}>{meet.name} · {meet.date}</option>)}</select></label> : null}
      {invitation ? <section className="invitation-receipt"><h3>Single-use invitation code</h3><output>{invitation.code}</output><button type="button" className="quiet-danger" onClick={() => void teamActions.revokeInvitation(invitation.id)}>Revoke invitation</button></section> : null}
      {notice ? <p role="status" className="safe-notice">{notice}</p> : null}
      {teamOpen ? <TeamDrawer role={organisation.role} members={members} actions={teamActions} /> : null}
      {loadingMeet ? <section className="center-card"><p role="status">Loading the authorised Meet workbook…</p></section> : state.snapshot ? <WorkbookWorkspace meet={state.snapshot} heatVersions={heatVersions} role={organisation.role} readOnly={organisation.role === "viewer"} actions={workbookActions} /> : <section className="workbook-placeholder"><h3>Meet unavailable</h3><p>The current view was preserved. Retry after the hosted service reconnects.</p></section>}
    </section>
  );
}

function DemoWorkspace({ onExit }: { onExit(): void }) {
  const demo = useMemo(createDemoRepository, []);
  const meet = useMemo(() => demo.load(), [demo]);
  return (
    <div className="meet-app demo-mode">
      <BrandHeader badge="Demo workspace · read-only" />
      <main id="main-content" className="demo-workspace"><MeetProviders workspace="demo" selected={{ id: "demo", name: "Demo organisation", slug: "demo", role: "viewer", version: 1 }}><WorkbookWorkspace meet={meet} role="viewer" readOnly actions={readOnlyWorkbookActions()} onSignOut={onExit} /></MeetProviders></main>
      <Footer />
    </div>
  );
}

function workbookPayload(snapshot: MeetStateV1): Record<string, unknown> {
  return {
    meet: { name: snapshot.meet.name, venue: snapshot.meet.venue, meetDate: snapshot.meet.date, status: snapshot.meet.status, settings: {} },
    brackets: snapshot.brackets.map((bracket) => ({ id: bracket.id, name: bracket.name, stage: bracket.stage, displayOrder: bracket.displayOrder, status: bracket.status, settings: { scheduleMode: bracket.event.settings.scheduleMode, seed: bracket.event.settings.seed, rankingMode: bracket.event.settings.rankingMode, tieBreakOrder: bracket.event.settings.tieBreakOrder, finalistCount: bracket.event.settings.finalistCount, enableTiming: bracket.event.settings.enableTiming } })),
    rules: snapshot.advancementRules.map((rule) => ({ id: rule.id, sourceBracketId: rule.sourceBracketId, topN: rule.topN, destinationCapacity: rule.destinationCapacity, status: rule.status, destinations: rule.destinationOrder.map((bracketId, index) => ({ bracketId, order: index + 1 })) })),
  };
}

function starterMeet(): MeetStateV1 {
  const now = new Date().toISOString();
  const bracketId = crypto.randomUUID();
  return { version: 1, meet: { id: crypto.randomUUID(), name: "New race meeting", venue: "", date: now.slice(0, 10), status: "setup", createdAt: now, updatedAt: now, version: 1 }, brackets: [{ id: bracketId, name: "Qualifier 1", stage: "qualifier", displayOrder: 1, status: "setup", version: 1, lineage: [], event: { version: 1, event: { id: bracketId, name: "Qualifier 1", date: now.slice(0, 10), venue: "", organizer: "Meet officials", laneCount: 3, status: "setup", createdAt: now, updatedAt: now, resultSeal: "draft" }, settings: { scheduleMode: "custom", seed: "meet-schedule", rankingMode: "competition", allowSharedRanks: true, tieBreakOrder: ["totalWins"], finalistCount: 3, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: {} }, participants: [], entries: [], matches: [], finals: [], payments: [], auditLog: [] } }], advancementRules: [], advancementSnapshots: [], auditLog: [] };
}

function readOnlyWorkbookActions(): WorkbookActions {
  const denied = async () => ({ ok: false, message: "Demo mode is read-only." });
  return { saveSetup: denied, saveRegistration: denied, activateSchedule: denied, confirmWinner: denied, correctWinner: denied };
}

function BrandHeader({ badge }: { badge: string }) {
  return <><a href="#main-content" className="skip-link">Skip to Meet workspace</a><header className="brand-header"><span className="product-mark" aria-hidden="true">RR · 3</span><div><p className="edition-label">{badge}</p><h1>Round Robin Race Control</h1></div><span className="hosted-pill">Accountable · Realtime-ready</span></header></>;
}
function Footer() { return <footer><p>{CREATOR_CREDIT}</p><p>Operational tracking only · no advertising trackers.</p></footer>; }
