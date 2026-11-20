import { useState } from 'react'
import { groupValidation, validEntrants } from './domain'
import type { EventData, RaceGroup, StageKind } from './types'
import './race-control.css'

type ProgressStatus = 'empty' | 'attention' | 'ready' | 'racing' | 'complete'

export interface GroupProgress {
  entered: boolean
  entries: number
  completed: number
  heats: number
  percent: number
  status: ProgressStatus
  detail: string
}

const statusLabels: Record<ProgressStatus, string> = {
  empty: 'Empty', attention: 'Needs attention', ready: 'Ready', racing: 'Racing', complete: 'Complete',
}
const stageLabels: Record<StageKind, string> = { main: 'Main race', finals: 'Finals', rerace: 'Reraces' }

export function groupProgress(group: RaceGroup): GroupProgress {
  const entered = group.entrants.some(entry => entry.name.trim() || entry.carNumber.trim())
  const entries = validEntrants(group).length
  const completed = group.heats.filter(heat => heat.winnerId && heat.lanes.includes(heat.winnerId)).length
  const heats = group.heats.length
  const percent = heats ? Math.round(completed / heats * 100) : 0
  const validation = groupValidation(group)
  let status: ProgressStatus = 'empty'
  let detail = 'No entries'
  if (entered) {
    if (!validation.valid || !heats) {
      status = 'attention'
      detail = validation.valid ? 'The schedule needs to be generated.' : validation.message
    } else if (completed === heats) {
      status = 'complete'
      detail = 'All heats scored'
    } else if (completed > 0) {
      status = 'racing'
      detail = 'Scoring in progress'
    } else {
      status = 'ready'
      detail = 'Ready for the first heat'
    }
  }
  return { entered, entries, completed, heats, percent, status, detail }
}

export function raceControlRows(event: EventData) {
  const classes = [...event.mainClasses, ...event.finalsClasses]
  return [
    ...classes.flatMap(category => category.groups.map(group => ({ category: category.name, group, progress: groupProgress(group) }))),
    ...event.reraces.map(group => ({ category: 'Reraces', group, progress: groupProgress(group) })),
  ]
}

export interface RaceControlProps {
  event: EventData
  onOpenGroup: (groupId: string) => void
  onSetStatus?: (status: EventData['status']) => void | Promise<void>
}

export default function RaceControl({ event, onOpenGroup, onSetStatus }: RaceControlProps) {
  const [stage, setStage] = useState<'all' | StageKind>('all')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<'all' | ProgressStatus>('all')
  const [includeEmpty, setIncludeEmpty] = useState(false)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const rows = raceControlRows(event)
  const tracked = rows.filter(row => row.progress.entered)
  const completedGroups = tracked.filter(row => row.progress.status === 'complete').length
  const racingGroups = tracked.filter(row => row.progress.status === 'racing').length
  const attentionGroups = tracked.filter(row => row.progress.status === 'attention').length
  const heats = tracked.reduce((sum, row) => sum + row.progress.heats, 0)
  const completedHeats = tracked.reduce((sum, row) => sum + row.progress.completed, 0)
  const unfinished = tracked.length - completedGroups
  const categories = [...new Set(rows.filter(row => stage === 'all' || row.group.kind === stage).map(row => row.category))]
  const visible = rows.filter(row => (stage === 'all' || row.group.kind === stage) &&
    (category === 'all' || row.category === category) &&
    (status === 'all' || row.progress.status === status) &&
    (row.progress.entered || includeEmpty || status === 'empty'))
  const setEventStatus = async (next: EventData['status']) => {
    if (!onSetStatus) return
    setSaving(true); setError('')
    try { await onSetStatus(next); setConfirmComplete(false) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The event status could not be saved.') }
    finally { setSaving(false) }
  }
  return <section className="race-control" aria-labelledby="race-control-heading">
    <div className="race-control-heading">
      <div><h2 id="race-control-heading">Race control</h2><p>Event status <strong>{event.status === 'draft' ? 'Draft' : event.status === 'live' ? 'Live' : 'Complete'}</strong></p></div>
      {onSetStatus && <div className="race-control-actions">
        {event.status !== 'draft' && <button className="secondary" disabled={saving} onClick={() => void setEventStatus('draft')}>Return to draft</button>}
        {event.status !== 'live' && <button className="primary" disabled={saving} onClick={() => void setEventStatus('live')}>{event.status === 'complete' ? 'Reopen event' : 'Start event'}</button>}
        {event.status !== 'complete' && <button className="secondary" disabled={saving} onClick={() => unfinished > 0 ? setConfirmComplete(true) : void setEventStatus('complete')}>Mark event complete</button>}
      </div>}
    </div>
    {error && <p className="race-control-alert" role="alert">{error}</p>}
    {confirmComplete && <div className="race-control-alert" role="alert">
      <p>{unfinished} entered {unfinished === 1 ? 'group still needs' : 'groups still need'} scoring or roster work. Marking the event complete changes its status.</p>
      <div className="race-control-actions"><button className="secondary" disabled={saving} onClick={() => setConfirmComplete(false)}>Keep event open</button>
        <button className="secondary" disabled={saving} onClick={() => void setEventStatus('complete')}>Confirm event complete</button></div>
    </div>}
    <div className="race-control-stats">
      <article><span>Entered groups</span><strong>{tracked.length}</strong></article>
      <article><span>Racing</span><strong>{racingGroups}</strong></article>
      <article><span>Complete</span><strong>{completedGroups}</strong></article>
      <article><span>Needs attention</span><strong>{attentionGroups}</strong></article>
      <article><span>Heats scored</span><strong>{completedHeats} / {heats}</strong></article>
    </div>
    <div className="race-control-stages">
      {(['main', 'finals', 'rerace'] as const).map(kind => {
        const stageRows = tracked.filter(row => row.group.kind === kind)
        const stageDone = stageRows.filter(row => row.progress.status === 'complete').length
        return <button key={kind} className={stage === kind ? 'active' : ''} aria-pressed={stage === kind} onClick={() => { setStage(stage === kind ? 'all' : kind); setCategory('all') }}>
          <strong>{stageLabels[kind]}</strong><span>{stageDone} / {stageRows.length} entered groups complete</span>
        </button>
      })}
    </div>
    <div className="race-control-filters">
      <label>Stage<select value={stage} onChange={change => { setStage(change.target.value as typeof stage); setCategory('all') }}>
        <option value="all">All stages</option><option value="main">Main race</option><option value="finals">Finals</option><option value="rerace">Reraces</option>
      </select></label>
      <label>Category<select value={category} onChange={change => setCategory(change.target.value)}><option value="all">All categories</option>{categories.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>Progress<select value={status} onChange={change => setStatus(change.target.value as typeof status)}><option value="all">All progress</option>{Object.entries(statusLabels).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
      <label className="race-control-checkbox"><input type="checkbox" checked={includeEmpty} onChange={change => setIncludeEmpty(change.target.checked)} />Include empty groups</label>
    </div>
    <div className="race-control-groups">
      {visible.map(row => <article className="race-control-group" key={row.group.id}>
        <div><span className="race-control-context">{row.category} · {stageLabels[row.group.kind]}</span><h2>{row.group.label}</h2><p>{row.progress.entries} {row.progress.entries === 1 ? 'entry' : 'entries'}</p></div>
        <div className="race-control-group-progress">
          <strong className={'race-control-status ' + row.progress.status}>{statusLabels[row.progress.status]}</strong>
          <span>{row.progress.completed} / {row.progress.heats} heats scored</span>
          <progress max={100} value={row.progress.percent} aria-label={row.category + ' ' + row.group.label + ' heats scored'} />
          <p>{row.progress.detail}</p>
        </div>
        <button className="secondary" onClick={() => onOpenGroup(row.group.id)} aria-label={'Open ' + row.category + ' ' + stageLabels[row.group.kind] + ' ' + row.group.label}>Open group</button>
      </article>)}
      {!visible.length && <p className="race-control-empty">{tracked.length ? 'No groups match these filters.' : 'Add entries to a bracket to track race progress here.'}</p>}
    </div>
  </section>
}
