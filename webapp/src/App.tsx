import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addAudit, allGroups, cleanName, completedHeatCount, createEvent, eventToCsv, feeRows, findGroup,
  groupStatus, groupValidation, reconcileEvent, reconcileGroup, redrawGroup, replaceGroup, setWinner, standings, validEntrants,
} from './domain'
import { createRemote, GroupSaveConflict, loadLocal, loadRemote, localEvents, SaveConflict, saveLocal, savedKey, updateRemote, updateRemoteGroup } from './store'
import { changedScheduleGroupIds, mergeAudits, mergeRemoteEvent, mergeSavedGroup, META_SCOPE } from './sync'
import type { AuditItem, Entrant, EventData, RaceClass, RaceGroup } from './types'

type View = 'overview' | 'entries' | 'race' | 'fees' | 'finals' | 'reraces' | 'display'
type ChangeEvent = (updater: (event: EventData) => EventData, groupId?: string) => void
type DirtyScopes = Record<string, number>
type GroupConflict = { local: RaceGroup; remote: RaceGroup; audit: AuditItem[] }

const views: Array<{ id: View; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'entries', label: 'Entries' }, { id: 'race', label: 'Race day' },
  { id: 'fees', label: 'Fees' }, { id: 'finals', label: 'Finals' }, { id: 'reraces', label: 'Reraces' }, { id: 'display', label: 'Display' },
]

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value)
}

function eventUrl(id: string, key?: string, display = false) {
  const url = new URL(location.origin + location.pathname)
  url.searchParams.set('event', id)
  if (display) url.searchParams.set('mode', 'display')
  if (key) url.hash = `key=${encodeURIComponent(key)}`
  return url.toString()
}

export default function App() {
  const initial = new URLSearchParams(location.search)
  const [eventId, setEventId] = useState<string | null>(initial.get('event'))
  const [event, setEvent] = useState<EventData | null>(null)
  const eventRef = useRef<EventData | null>(null)
  const [ownerKey, setOwnerKey] = useState('')
  const [role, setRole] = useState<'owner' | 'viewer'>('viewer')
  const [view, setView] = useState<View>(initial.get('mode') === 'display' ? 'display' : 'overview')
  const [loading, setLoading] = useState(Boolean(eventId))
  const [loadError, setLoadError] = useState('')
  const [dirtyScopes, setDirtyScopes] = useState<DirtyScopes>({})
  const dirtyScopesRef = useRef<DirtyScopes>({})
  const [sync, setSync] = useState<'saved' | 'saving' | 'offline' | 'conflict'>('saved')
  const [conflict, setConflict] = useState<EventData | null>(null)
  const [groupConflicts, setGroupConflicts] = useState<Record<string, GroupConflict>>({})

  useEffect(() => { eventRef.current = event; if (event) saveLocal(event, ownerKey) }, [event, ownerKey])

  const updateDirtyScopes = (updater: (current: DirtyScopes) => DirtyScopes) => {
    setDirtyScopes(current => {
      const next = updater(current)
      dirtyScopesRef.current = next
      return next
    })
  }

  const markDirty = (scope: string) => updateDirtyScopes(current => ({ ...current, [scope]: (current[scope] ?? 0) + 1 }))

  const open = useCallback((id: string, key = '') => {
    const url = eventUrl(id, key)
    history.pushState({}, '', url)
    dirtyScopesRef.current = {}
    setDirtyScopes({}); setConflict(null); setGroupConflicts({})
    setEventId(id); setEvent(null); setOwnerKey(key); setView('overview'); setLoading(true); setLoadError('')
  }, [])

  useEffect(() => {
    const pop = () => {
      const params = new URLSearchParams(location.search)
      setEventId(params.get('event')); setView(params.get('mode') === 'display' ? 'display' : 'overview')
    }
    addEventListener('popstate', pop); return () => removeEventListener('popstate', pop)
  }, [])

  useEffect(() => {
    if (!eventId) { setLoading(false); return }
    let live = true
    const key = ownerKey || savedKey(eventId)
    if (key !== ownerKey) setOwnerKey(key)
    setLoading(true)
    loadRemote(eventId, key).then(result => {
      if (!live) return
      const prepared = reconcileEvent(result.event)
      const repairs = result.role === 'owner' ? changedScheduleGroupIds(result.event, prepared) : []
      const nextDirty = Object.fromEntries(repairs.map(groupId => [groupId, 1]))
      dirtyScopesRef.current = nextDirty
      eventRef.current = prepared
      setDirtyScopes(nextDirty); setEvent(prepared); setRole(result.role); setSync(repairs.length ? 'saving' : 'saved'); setLoading(false)
    }).catch(error => {
      if (!live) return
      const local = loadLocal(eventId)
      if (local) {
        const prepared = reconcileEvent(local)
        const repairs = key ? changedScheduleGroupIds(local, prepared) : []
        const nextDirty = Object.fromEntries(repairs.map(groupId => [groupId, 1]))
        dirtyScopesRef.current = nextDirty
        eventRef.current = prepared
        setDirtyScopes(nextDirty); setEvent(prepared); setRole(key ? 'owner' : 'viewer'); setSync('offline'); setLoading(false)
      }
      else { setLoadError(error instanceof Error ? error.message : 'Event could not be opened.'); setLoading(false) }
    })
    return () => { live = false }
  }, [eventId, ownerKey])

  useEffect(() => {
    if (!event || !Object.keys(dirtyScopes).length || !ownerKey) return
    if (event.id.startsWith('local-')) { setSync('offline'); return }
    const snapshot = event
    const scheduled = { ...dirtyScopes }
    const timer = setTimeout(async () => {
      setSync('saving')
      const outcomes = await Promise.all(Object.entries(scheduled).map(async ([scope, generation]) => {
        try {
          if (scope === META_SCOPE) return { scope, generation, value: await updateRemote(snapshot, ownerKey) }
          const group = findGroup(snapshot, scope)
          if (!group) throw new Error('Bracket is no longer available.')
          const audit = snapshot.audit.filter(item => item.groupId === scope)
          return { scope, generation, value: await updateRemoteGroup(snapshot.id, group, audit, ownerKey) }
        } catch (error) { return { scope, generation, error } }
      }))

      let nextEvent = eventRef.current ?? snapshot
      let nextDirty = { ...dirtyScopesRef.current }
      const nextGroupConflicts: Record<string, GroupConflict> = {}
      const successfulGroups = new Set<string>()
      let eventConflict: EventData | null = null
      let failedOffline = false

      for (const outcome of outcomes.sort((a, b) => a.scope === META_SCOPE ? -1 : b.scope === META_SCOPE ? 1 : 0)) {
        if ('error' in outcome) {
          if (outcome.error instanceof GroupSaveConflict) {
            const local = findGroup(nextEvent, outcome.scope) ?? findGroup(snapshot, outcome.scope)
            if (local) nextGroupConflicts[outcome.scope] = { local, remote: outcome.error.remote, audit: outcome.error.audit }
            delete nextDirty[outcome.scope]
          } else if (outcome.error instanceof SaveConflict) {
            eventConflict = outcome.error.remote
            delete nextDirty[META_SCOPE]
          } else failedOffline = true
          continue
        }

        const newerChangesExist = nextDirty[outcome.scope] !== outcome.generation
        if (outcome.scope === META_SCOPE) {
          const protectedGroups = new Set(Object.keys(nextDirty).filter(scope => scope !== META_SCOPE))
          nextEvent = mergeRemoteEvent(nextEvent, outcome.value as EventData, protectedGroups, newerChangesExist)
        } else {
          const saved = outcome.value as { group: RaceGroup; audit: AuditItem[] }
          nextEvent = mergeSavedGroup(nextEvent, saved.group, saved.audit, newerChangesExist)
          successfulGroups.add(outcome.scope)
        }
        if (!newerChangesExist) delete nextDirty[outcome.scope]
      }

      eventRef.current = nextEvent
      dirtyScopesRef.current = nextDirty
      setEvent(nextEvent)
      setDirtyScopes(nextDirty)
      if (eventConflict) setConflict(eventConflict)
      setGroupConflicts(current => {
        const next = { ...current }
        successfulGroups.forEach(groupId => { delete next[groupId] })
        return { ...next, ...nextGroupConflicts }
      })
      const hasConflict = Boolean(eventConflict || conflict || Object.keys(nextGroupConflicts).length || Object.keys(groupConflicts).some(id => !successfulGroups.has(id)))
      setSync(hasConflict ? 'conflict' : failedOffline ? 'offline' : Object.keys(nextDirty).length ? 'saving' : 'saved')
    }, 650)
    return () => clearTimeout(timer)
  }, [dirtyScopes, event, ownerKey, conflict, groupConflicts])

  useEffect(() => {
    if (!eventId) return
    const timer = setInterval(async () => {
      if (sync === 'saving') return
      try {
        const result = await loadRemote(eventId, ownerKey)
        const current = eventRef.current
        if (current) {
          const prepared = reconcileEvent(result.event)
          const protectedGroups = new Set([
            ...Object.keys(dirtyScopesRef.current).filter(scope => scope !== META_SCOPE),
            ...Object.keys(groupConflicts),
          ])
          const merged = mergeRemoteEvent(current, prepared, protectedGroups, Boolean(dirtyScopesRef.current[META_SCOPE] || conflict))
          eventRef.current = merged
          setEvent(merged)
          const repairs = ownerKey ? changedScheduleGroupIds(result.event, prepared).filter(id => !protectedGroups.has(id)) : []
          if (repairs.length) {
            updateDirtyScopes(scopes => {
              const next = { ...scopes }
              repairs.forEach(id => { next[id] = (next[id] ?? 0) + 1 })
              return next
            })
          }
        }
        if (!Object.keys(dirtyScopesRef.current).length && !conflict && !Object.keys(groupConflicts).length) setSync('saved')
      } catch { setSync('offline') }
    }, 3000)
    return () => clearInterval(timer)
  }, [eventId, ownerKey, sync, conflict, groupConflicts])

  const change: ChangeEvent = (updater, groupId) => {
    if (role !== 'owner') return
    setEvent(current => {
      const next = current ? updater(current) : current
      eventRef.current = next
      return next
    })
    markDirty(groupId ?? META_SCOPE)
    setSync('saving')
  }

  const close = () => {
    history.pushState({}, '', location.pathname)
    dirtyScopesRef.current = {}
    setEventId(null); setEvent(null); setOwnerKey(''); setDirtyScopes({}); setConflict(null); setGroupConflicts({}); setView('overview')
  }

  if (!eventId) return <Home onOpen={open} onCreate={async draft => {
    let result: { event: EventData; ownerKey: string }
    try { result = await createRemote(draft) }
    catch (error) {
      if (!import.meta.env.DEV) throw error
      const id = `local-${crypto.randomUUID()}`
      result = { event: { ...draft, id, version: 1 }, ownerKey: crypto.randomUUID() }
    }
    saveLocal(result.event, result.ownerKey)
    open(result.event.id, result.ownerKey)
  }} />
  if (loading) return <FullState title="Opening event" detail="Loading the latest saved race data…" />
  if (!event) return <FullState title="Event unavailable" detail={loadError || 'The event link is invalid or no longer available.'} action={<button onClick={close}>Back to events</button>} />

  const publicMode = new URLSearchParams(location.search).get('mode') === 'display'
  const groupConflictEntry = Object.entries(groupConflicts)[0]
  const pendingCount = Object.keys(dirtyScopes).length
  const removeGroupConflict = (groupId: string) => setGroupConflicts(current => {
    const next = { ...current }
    delete next[groupId]
    return next
  })
  const useSavedEvent = () => {
    if (!conflict) return
    const protectedGroups = new Set([...Object.keys(dirtyScopes).filter(scope => scope !== META_SCOPE), ...Object.keys(groupConflicts)])
    const next = mergeRemoteEvent(eventRef.current ?? event, conflict, protectedGroups, false)
    eventRef.current = next
    setEvent(next); setConflict(null); setSync(pendingCount ? 'saving' : Object.keys(groupConflicts).length ? 'conflict' : 'saved')
  }
  const keepLocalEvent = () => {
    if (!conflict) return
    setEvent(current => {
      const next = current ? { ...current, version: conflict.version, updatedAt: new Date().toISOString() } : current
      eventRef.current = next
      return next
    })
    setConflict(null); markDirty(META_SCOPE); setSync('saving')
  }
  const useSavedGroup = (groupId: string, item: GroupConflict) => {
    setEvent(current => {
      const next = current ? mergeSavedGroup(current, item.remote, item.audit, false) : current
      eventRef.current = next
      return next
    })
    removeGroupConflict(groupId)
    setSync(conflict || Object.keys(groupConflicts).length > 1 ? 'conflict' : pendingCount ? 'saving' : 'saved')
  }
  const keepLocalGroup = (groupId: string, item: GroupConflict) => {
    setEvent(current => {
      if (!current) return current
      const local = findGroup(current, groupId) ?? item.local
      const next = mergeSavedGroup(current, { ...local, revision: item.remote.revision }, mergeAudits(current.audit, item.audit), true)
      eventRef.current = next
      return next
    })
    removeGroupConflict(groupId); markDirty(groupId); setSync('saving')
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={close} aria-label="Return to events"><span className="brand-mark">RR</span><span>Race Manager</span></button>
        <div className="event-title"><strong>{event.name}</strong><span>{event.date}{event.venue ? ` · ${event.venue}` : ''}</span></div>
        <div className="top-actions">
          <span className={`sync sync-${sync}`}>{sync === 'saved' ? 'Saved' : sync === 'saving' ? pendingCount > 1 ? `Saving ${pendingCount} brackets…` : 'Saving…' : sync === 'offline' ? 'Offline copy' : 'Save conflict'}</span>
          {!publicMode && <button className="secondary compact" onClick={() => copy(eventUrl(event.id, undefined, true))}>Copy display link</button>}
        </div>
      </header>

      {conflict && <div className="conflict-banner" role="alert"><div><strong>Event settings changed on another device.</strong><span>Bracket results are safe. Choose which event details or payments to keep.</span></div><div><button onClick={useSavedEvent}>Use saved event</button><button className="danger" onClick={keepLocalEvent}>Keep this tab</button></div></div>}
      {groupConflictEntry && <div className="conflict-banner" role="alert"><div><strong>{findGroup(event, groupConflictEntry[0])?.label ?? 'This bracket'} changed in another tab.</strong><span>Only this bracket needs a decision; every other bracket can continue saving.</span></div><div><button onClick={() => useSavedGroup(groupConflictEntry[0], groupConflictEntry[1])}>Use saved bracket</button><button className="danger" onClick={() => keepLocalGroup(groupConflictEntry[0], groupConflictEntry[1])}>Keep this tab</button></div></div>}

      {!publicMode && <nav className="main-nav" aria-label="Event sections">{views.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>}

      <main>
        {publicMode || view === 'display' ? <DisplayPage event={event} /> : null}
        {!publicMode && view === 'overview' && <Overview event={event} ownerKey={ownerKey} change={change} />}
        {!publicMode && view === 'entries' && <MainStage event={event} change={change} rosterOnly />}
        {!publicMode && view === 'race' && <MainStage event={event} change={change} />}
        {!publicMode && view === 'fees' && <FeesPage event={event} change={change} />}
        {!publicMode && view === 'finals' && <ClassStage title="Finals and semifinals" helper="Enter or renumber the selected finalists, then record the winner of each heat." classes={event.finalsClasses} event={event} change={change} />}
        {!publicMode && view === 'reraces' && <ReraceStage event={event} change={change} />}
      </main>

      {role === 'viewer' && !publicMode && <div className="viewer-note">Read-only view. Use the private admin link to manage this event.</div>}
    </div>
  )
}

function FullState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <main className="full-state"><span className="brand-mark large">RR</span><h1>{title}</h1><p>{detail}</p>{action}</main>
}

function Home({ onOpen, onCreate }: { onOpen: (id: string, key?: string) => void; onCreate: (event: EventData) => Promise<void> }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [venue, setVenue] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const recent = localEvents()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setCreating(true); setError('')
    try { await onCreate(createEvent(name, date, venue)) } catch (err) { setError(err instanceof Error ? err.message : 'Event could not be created.'); setCreating(false) }
  }
  const importBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as EventData
      parsed.id = ''; parsed.version = 0; parsed.name = `${parsed.name} copy`; parsed.audit = []
      await onCreate(parsed)
    } catch { setError('That backup file could not be imported.') }
  }
  return <div className="landing">
    <section className="landing-intro"><div className="landing-brand"><span className="brand-mark large">RR</span><span>Round Robin</span></div><h1>Run the whole race day from one clear screen.</h1><p>Entries, fair draws, winners, W/L records, fees, finals and reraces. Saved after every change.</p><div className="feature-list"><span>Works on phone, tablet and laptop</span><span>Offline copy on this device</span><span>Separate public display link</span></div></section>
    <section className="start-card"><p className="eyebrow">New event</p><h2>Set up a race</h2><form onSubmit={submit}><label>Event name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="September club race" /></label><div className="form-pair"><label>Date<input required type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label>Venue<input maxLength={160} value={venue} onChange={e => setVenue(e.target.value)} placeholder="Track or venue" /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary full" disabled={creating}>{creating ? 'Creating…' : 'Create event'}</button></form><label className="import-link">Import event backup<input type="file" accept="application/json,.json" onChange={e => e.target.files?.[0] && importBackup(e.target.files[0])} /></label></section>
    {recent.length > 0 && <section className="recent"><p className="eyebrow">This device</p><h2>Recent events</h2><div className="recent-grid">{recent.map(event => <button key={event.id} onClick={() => onOpen(event.id, savedKey(event.id))}><strong>{event.name}</strong><span>{event.date || 'No date'} · {event.status}</span></button>)}</div></section>}
  </div>
}

function Overview({ event, ownerKey, change }: { event: EventData; ownerKey: string; change: ChangeEvent }) {
  const fees = feeRows(event)
  const mainEntries = event.mainClasses.flatMap(c => c.groups).reduce((sum, group) => sum + validEntrants(group).length, 0)
  const groupsRunning = allGroups(event).filter(group => group.heats.length).length
  const balance = fees.reduce((sum, row) => sum + row.balance, 0)
  const setting = <K extends keyof EventData>(key: K, value: EventData[K]) => change(current => ({ ...current, [key]: value, updatedAt: new Date().toISOString() }))
  return <div className="page-stack">
    <section className="page-heading"><div><p className="eyebrow">Event control</p><h1>Overview</h1><p>Everything important before racing starts.</p></div><div className="heading-actions"><button className="secondary" onClick={() => download(`${event.name}-backup.json`, JSON.stringify(event, null, 2), 'application/json')}>Download backup</button><button className="secondary" onClick={() => download(`${event.name}-results.csv`, eventToCsv(event), 'text/csv')}>Export results</button></div></section>
    <section className="stat-grid"><article><span>Main entries</span><strong>{mainEntries}</strong></article><article><span>Active groups</span><strong>{groupsRunning}</strong></article><article><span>Completed heats</span><strong>{completedHeatCount(event)}</strong></article><article><span>Outstanding fees</span><strong>${balance.toFixed(2)}</strong></article></section>
    <div className="two-column"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Details</p><h2>Event settings</h2></div></div><div className="settings-grid"><label>Event name<input value={event.name} onChange={e => setting('name', e.target.value)} /></label><label>Date<input type="date" value={event.date} onChange={e => setting('date', e.target.value)} /></label><label>Venue<input value={event.venue} onChange={e => setting('venue', e.target.value)} /></label><label>Status<select value={event.status} onChange={e => setting('status', e.target.value as EventData['status'])}><option value="draft">Draft</option><option value="live">Live</option><option value="complete">Complete</option></select></label></div><div className="admin-links"><div><strong>Public display</strong><span>Safe, read-only link for a screen or spectators.</span></div><button onClick={() => copy(eventUrl(event.id, undefined, true))}>Copy link</button><div><strong>Private admin link</strong><span>Anyone with this link can change the event.</span></div><button onClick={() => copy(eventUrl(event.id, ownerKey))}>Copy admin link</button></div></section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">History</p><h2>Recent activity</h2></div></div>{event.audit.length ? <ol className="audit-list">{event.audit.slice(0, 12).map(item => <li key={item.id}><span className={`audit-dot ${item.action}`} /><div><strong>{item.message}</strong><time>{new Date(item.at).toLocaleString()}</time></div></li>)}</ol> : <Empty compact title="No activity yet" detail="Draws, winners and payments will appear here." />}</section></div>
  </div>
}

function MainStage({ event, change, rosterOnly = false }: { event: EventData; change: ChangeEvent; rosterOnly?: boolean }) {
  return <ClassStage title={rosterOnly ? 'Entries' : 'Race day'} helper={rosterOnly ? 'Enter each car by class and bracket. Owner names may repeat; car numbers must be unique within the bracket. Every bracket works independently.' : 'Choose the winner of each heat. W/L records and ranking update immediately.'} classes={event.mainClasses} event={event} change={change} rosterOnly={rosterOnly} />
}

function ClassStage({ title, helper, classes, event, change, rosterOnly = false }: { title: string; helper: string; classes: RaceClass[]; event: EventData; change: ChangeEvent; rosterOnly?: boolean }) {
  const [classIndex, setClassIndex] = useState(0)
  const [groupIndex, setGroupIndex] = useState(0)
  const selectedClass = classes[classIndex] ?? classes[0]
  const group = selectedClass.groups[groupIndex] ?? selectedClass.groups[0]
  return <div className="page-stack"><section className="page-heading"><div><p className="eyebrow">{group.kind === 'main' ? 'Preliminaries' : 'Final stage'}</p><h1>{title}</h1><p>{helper}</p></div></section><StagePicker classes={classes} classIndex={classIndex} groupIndex={groupIndex} onClass={i => { setClassIndex(i); setGroupIndex(0) }} onGroup={setGroupIndex} />
    {rosterOnly ? <RosterPanel group={group} event={event} change={change} /> : <div className="workspace-grid"><RosterPanel group={group} event={event} change={change} condensed /><SchedulePanel group={group} event={event} change={change} /></div>}
  </div>
}

function ReraceStage({ event, change }: { event: EventData; change: ChangeEvent }) {
  const [index, setIndex] = useState(0)
  const group = event.reraces[index]
  return <div className="page-stack"><section className="page-heading"><div><p className="eyebrow">Tie-breakers</p><h1>Reraces</h1><p>Every rerace is separate from earlier results. Four cars get all six unique head-to-head pairings.</p></div></section><div className="group-tabs">{event.reraces.map((item, i) => <button className={index === i ? 'active' : ''} onClick={() => setIndex(i)} key={item.id}>{item.label}</button>)}</div><div className="workspace-grid"><RosterPanel group={group} event={event} change={change} condensed /><SchedulePanel group={group} event={event} change={change} /></div></div>
}

function StagePicker({ classes, classIndex, groupIndex, onClass, onGroup }: { classes: RaceClass[]; classIndex: number; groupIndex: number; onClass: (i: number) => void; onGroup: (i: number) => void }) {
  return <section className="picker"><div className="class-tabs">{classes.map((item, i) => <button className={classIndex === i ? 'active' : ''} onClick={() => onClass(i)} key={item.id}>{item.name}</button>)}</div><div className="group-tabs">{classes[classIndex].groups.map((item, i) => <button className={groupIndex === i ? 'active' : ''} onClick={() => onGroup(i)} key={item.id}>{item.label}</button>)}</div></section>
}

function RosterPanel({ group, event, change, condensed = false }: { group: RaceGroup; event: EventData; change: ChangeEvent; condensed?: boolean }) {
  const locked = group.heats.some(heat => heat.winnerId)
  const validation = groupValidation(group)
  const [expanded, setExpanded] = useState(false)
  const entered = validEntrants(group).length
  const visibleEntrants = condensed && !expanded ? group.entrants.slice(0, locked ? Math.max(entered, 1) : Math.min(21, Math.max(6, entered + 3))) : group.entrants
  const update = (updater: (group: RaceGroup) => RaceGroup) => change(current => replaceGroup(current, reconcileGroup(updater(findGroup(current, group.id)!))), group.id)
  const updateEntry = (id: string, field: keyof Pick<Entrant, 'name' | 'carNumber'>, value: string) => update(current => ({ ...current, entrants: current.entrants.map(entry => entry.id === id ? { ...entry, [field]: field === 'carNumber' ? value.replace(/\D/g, '').slice(0, 9) : value } : entry) }))
  const redraw = () => change(current => {
    const currentGroup = findGroup(current, group.id)!
    const next = redrawGroup(currentGroup)
    return addAudit(replaceGroup(current, next), 'draw', `New random draw for ${next.label}`, { groupId: next.id })
  }, group.id)
  return <section className={`panel roster-panel ${condensed ? 'condensed' : ''}`}><div className="panel-heading"><div><p className="eyebrow">Roster</p><input className="inline-title" aria-label="Group name" value={group.label} disabled={locked} onChange={e => update(current => ({ ...current, label: e.target.value.slice(0, 120) }))} /></div><div className="panel-actions"><span className={`validation ${validation.valid ? 'ready' : ''}`}>{entered} cars</span>{condensed && !locked && <button className="secondary compact" onClick={() => setExpanded(value => !value)}>{expanded ? 'Fewer slots' : 'All 21 slots'}</button>}<button className="secondary compact" disabled={!validation.valid || locked} onClick={redraw}>New draw</button></div></div>{locked && <p className="locked-note">Roster locked because results exist. Clear this group’s results to make changes.</p>}<div className="entry-table" role="table" aria-label={`${group.label} competitors`}><div className="entry-head" role="row"><span>Slot</span><span>Competitor</span><span>Car</span></div>{visibleEntrants.map((entry, i) => <div className="entry-row" role="row" key={entry.id}><span>{i + 1}</span><input aria-label={`Competitor ${i + 1} name`} disabled={locked} value={entry.name} onChange={e => updateEntry(entry.id, 'name', e.target.value)} placeholder={i === 0 ? 'Competitor name' : ''} /><input aria-label={`Competitor ${i + 1} car number`} inputMode="numeric" disabled={locked} value={entry.carNumber} onChange={e => updateEntry(entry.id, 'carNumber', e.target.value)} placeholder={i === 0 ? 'No.' : ''} /></div>)}</div><p className={`status-line ${validation.valid ? 'success' : ''}`}>{groupStatus(group)}</p></section>
}

function entrantLabel(group: RaceGroup, id: string | null) {
  const entrant = group.entrants.find(item => item.id === id)
  return entrant ? `${entrant.carNumber} · ${cleanName(entrant.name)}` : ''
}

function SchedulePanel({ group, event, change, readonly = false }: { group: RaceGroup; event: EventData; change: ChangeEvent; readonly?: boolean }) {
  const table = standings(group)
  const updateWinner = (heatId: string, winnerId: string | null) => change(current => {
    const currentGroup = findGroup(current, group.id)!
    const heat = currentGroup.heats.find(item => item.id === heatId)!
    const next = setWinner(currentGroup, heatId, winnerId)
    const label = winnerId ? `Winner recorded: ${entrantLabel(currentGroup, winnerId)}` : `Winner cleared in round ${heat.round}, heat ${heat.heat}`
    return addAudit(replaceGroup(current, next), 'result', label, { groupId: group.id, heatId, beforeWinnerId: heat.winnerId, afterWinnerId: winnerId })
  }, group.id)
  const clear = () => {
    if (!confirm(`Clear every recorded winner in ${group.label}? The draw will remain unchanged.`)) return
    change(current => {
      const currentGroup = findGroup(current, group.id)!
      const next = { ...currentGroup, heats: currentGroup.heats.map(heat => ({ ...heat, winnerId: null })) }
      return addAudit(replaceGroup(current, next), 'result', `All results cleared for ${group.label}`, { groupId: group.id })
    }, group.id)
  }
  const undo = () => {
    const item = event.audit.find(a => a.action === 'result' && a.groupId === group.id && a.heatId)
    if (!item?.heatId) return
    change(current => {
      const currentGroup = findGroup(current, group.id)!
      const restored = setWinner(currentGroup, item.heatId!, item.beforeWinnerId ?? null)
      const without = current.audit.filter(a => a.id !== item.id)
      return addAudit({ ...replaceGroup(current, restored), audit: without }, 'result', `Last result undone in ${group.label}`, { groupId: group.id })
    }, group.id)
  }
  if (!group.heats.length) return <section className="panel schedule-panel"><Empty title="Schedule waiting" detail={groupValidation(group).message} /></section>
  const lastRound = Math.max(...group.heats.map(h => h.round))
  const canUndo = event.audit.some(a => a.action === 'result' && a.groupId === group.id && a.heatId)
  return <section className="panel schedule-panel"><div className="panel-heading"><div><p className="eyebrow">{lastRound} rounds</p><h2>{group.label} schedule</h2></div>{!readonly && <div className="panel-actions"><button className="secondary compact" disabled={!canUndo} onClick={undo}>Undo result</button><button className="secondary compact" disabled={!group.heats.some(h => h.winnerId)} onClick={clear}>Clear results</button></div>}</div><p className="status-line success">{groupStatus(group)}</p><div className="race-layout"><div className="heat-list">{Array.from({ length: lastRound }, (_, i) => i + 1).map(round => <section className="round-block" key={round}><h3>Round {round}</h3>{group.heats.filter(h => h.round === round).map(heat => <article className={`heat-card ${heat.winnerId ? 'complete' : ''}`} key={heat.id}><div className="heat-number"><span>Heat</span><strong>{heat.heat}</strong></div><div className="lanes">{heat.lanes.map((id, lane) => id && <button disabled={readonly} className={heat.winnerId === id ? 'winner' : ''} onClick={() => updateWinner(heat.id, heat.winnerId === id ? null : id)} key={`${heat.id}-${lane}`}><span>Lane {lane + 1}</span><strong>{entrantLabel(group, id)}</strong>{heat.winnerId === id && <em>Winner</em>}</button>)}</div></article>)}</section>)}</div><Standings table={table} /></div></section>
}

function Standings({ table }: { table: ReturnType<typeof standings> }) {
  return <aside className="standings"><div className="standings-head"><span>Car</span><span>Competitor</span><span>W</span><span>L</span><span>Rank</span></div>{table.map(row => <div className={row.rank <= 3 ? 'top-rank' : ''} key={row.entrant.id}><span>{row.entrant.carNumber}</span><strong>{cleanName(row.entrant.name)}</strong><span>{row.wins}</span><span>{row.losses}</span><span>{row.rank}</span></div>)}</aside>
}

function FeesPage({ event, change }: { event: EventData; change: ChangeEvent }) {
  const rows = feeRows(event)
  const totals = rows.reduce((a, row) => ({ due: a.due + row.due, paid: a.paid + row.paid, balance: a.balance + row.balance }), { due: 0, paid: 0, balance: 0 })
  const setFee = (value: number) => change(current => addAudit({ ...current, entryFee: Math.max(0, value), updatedAt: new Date().toISOString() }, 'payment', `Entry fee changed to $${value.toFixed(2)}`))
  const setPaid = (nameKey: string, displayName: string, value: number) => change(current => addAudit({ ...current, payments: { ...current.payments, [nameKey]: { nameKey, displayName, paid: Math.max(0, value) } } }, 'payment', `Payment updated for ${displayName}`))
  return <div className="page-stack"><section className="page-heading"><div><p className="eyebrow">Registration</p><h1>Fees</h1><p>Main entries are tallied into one name-based table. Finals and reraces add no fees.</p></div><label className="fee-setting">Fee per entry<span>$ <input type="number" min="0" step="0.01" value={event.entryFee} onChange={e => setFee(Number(e.target.value))} /></span></label></section><section className="stat-grid three"><article><span>Total due</span><strong>${totals.due.toFixed(2)}</strong></article><article><span>Paid</span><strong>${totals.paid.toFixed(2)}</strong></article><article><span>Balance</span><strong>${totals.balance.toFixed(2)}</strong></article></section><section className="panel fee-panel">{rows.length ? <div className="fees-table"><div className="fees-head"><span>Competitor</span><span>Entries</span><span>Total due</span><span>Paid</span><span>Balance</span></div>{rows.map(row => <div className="fees-row" key={row.nameKey}><strong>{row.displayName}</strong><span>{row.entries}</span><span>${row.due.toFixed(2)}</span><label><span className="sr-only">Paid by {row.displayName}</span>$ <input type="number" min="0" step="0.01" value={row.paid} onChange={e => setPaid(row.nameKey, row.displayName, Number(e.target.value))} /></label><strong className={row.balance ? 'owing' : 'paid'}>${row.balance.toFixed(2)}</strong></div>)}</div> : <Empty title="No fees yet" detail="Enter competitors on the Entries tab to build this table." />}</section></div>
}

function DisplayPage({ event }: { event: EventData }) {
  const active = useMemo(() => allGroups(event).filter(group => group.heats.length), [event])
  const [groupId, setGroupId] = useState(active[0]?.id ?? '')
  const group = active.find(item => item.id === groupId) ?? active[0]
  return <div className="page-stack display-page"><section className="page-heading"><div><p className="eyebrow">Live results</p><h1>{event.name}</h1><p>{event.date}{event.venue ? ` · ${event.venue}` : ''}</p></div><span className={`event-status ${event.status}`}>{event.status}</span></section>{active.length ? <><label className="display-select">Showing<select value={group?.id} onChange={e => setGroupId(e.target.value)}>{active.map(item => <option value={item.id} key={item.id}>{item.label} · {item.kind}</option>)}</select></label>{group && <SchedulePanel group={group} event={event} change={() => undefined} readonly />}</> : <section className="panel"><Empty title="No schedules yet" detail="The race schedule will appear here after entries are complete." /></section>}</div>
}

function Empty({ title, detail, compact = false }: { title: string; detail: string; compact?: boolean }) {
  return <div className={`empty ${compact ? 'compact' : ''}`}><span aria-hidden="true">—</span><h3>{title}</h3><p>{detail}</p></div>
}
