import { useState } from 'react'
import { cleanName, validEntrants } from './domain'
import { aggregatePodiums, buildPodium, suggestPodium, type ConfirmedPodium, type PointRules } from './results'
import type { EventData, RaceGroup } from './types'
import './results.css'

interface ResultsPanelProps {
  event: EventData
  podiums: ConfirmedPodium[]
  pointRules?: PointRules
  onConfirm: (podium: ConfirmedPodium) => Promise<void>
}

export default function ResultsPanel({ event, podiums, pointRules, onConfirm }: ResultsPanelProps) {
  const [classId, setClassId] = useState(event.finalsClasses[0]?.id ?? '')
  const [groupId, setGroupId] = useState('')
  const raceClass = event.finalsClasses.find(item => item.id === classId) ?? event.finalsClasses[0]
  const group = raceClass?.groups.find(item => item.id === groupId) ?? raceClass?.groups[0]
  const saved = podiums.filter(item => item.eventId === event.id && item.classId === raceClass?.id)
    .sort((a, b) => b.revision - a.revision)[0]
  const totals = aggregatePodiums(podiums.filter(item => item.eventId === event.id))
  return <div className="page-stack results-page">
    <section className="page-heading"><div><p className="eyebrow">Results</p><h1>Podiums</h1><p>Confirm the deciding final for each category to record first, second and third places.</p></div></section>
    <section className="panel results-controls">
      <label>Result category<select value={raceClass?.id ?? ''} onChange={event => { setClassId(event.target.value); setGroupId('') }}>
        {event.finalsClasses.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <label>Deciding final<select value={group?.id ?? ''} onChange={event => setGroupId(event.target.value)}>
        {raceClass?.groups.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>
    </section>
    {saved && <section className="panel confirmed-result">
      <h2>Confirmed {saved.className} podium</h2>
      <ol>{saved.finishers.map(row => <li key={row.place}><strong>{row.name}</strong><span>Car {row.carNumber}</span></li>)}</ol>
      <p>Result revision {saved.revision} · {new Date(saved.confirmedAt).toLocaleString()}</p>
      <p>Source {event.finalsClasses.flatMap(item => item.groups).find(item => item.id === saved.sourceGroupId)?.label ?? saved.sourceGroupId} · bracket revision {saved.sourceRevision}</p>
      {saved.reason && <p>Confirmation reason · {saved.reason}</p>}
      {saved.reraceGroupId && <p>Tie-break {event.reraces.find(item => item.id === saved.reraceGroupId)?.label ?? saved.reraceGroupId} · revision {saved.reraceRevision}</p>}
      {saved.sourceGroupId === group?.id && saved.sourceRevision !== (group.revision ?? 0) && <p role="status" className="results-warning">This final has changed since confirmation. Review and confirm a corrected podium.</p>}
    </section>}
    {group && raceClass && <PodiumEditor key={group.id + ':' + (group.revision ?? 0)} event={event} group={group} classId={raceClass.id} priorRevision={saved?.revision ?? 0} pointRules={pointRules} onConfirm={onConfirm} />}
    {totals.length > 0 && <section className="panel results-history">
      <h2>Event podium tally</h2>
      <div className="results-table-scroll"><table><thead><tr><th scope="col">Competitor</th><th scope="col">1st</th><th scope="col">2nd</th><th scope="col">3rd</th><th scope="col">Points</th></tr></thead>
        <tbody>{totals.map(row => <tr key={row.identity}><th scope="row">{row.name}</th><td>{row.first}</td><td>{row.second}</td><td>{row.third}</td><td>{row.points ?? 'Not configured'}</td></tr>)}</tbody>
      </table></div>
    </section>}
  </div>
}

function PodiumEditor({ event, group, classId, priorRevision, pointRules, onConfirm }: {
  event: EventData
  group: RaceGroup
  classId: string
  priorRevision: number
  pointRules?: PointRules
  onConfirm: ResultsPanelProps['onConfirm']
}) {
  const suggestion = suggestPodium(group)
  const entrants = validEntrants(group)
  const [selected, setSelected] = useState(() => Array.from({ length: Math.min(3, entrants.length) }, (_, index) => suggestion.finishers[index]?.entrantId ?? ''))
  const [reason, setReason] = useState('')
  const [reraceGroupId, setReraceGroupId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const completeReraces = event.reraces.filter(item => suggestPodium(item).complete)
  const manual = suggestion.needsTieBreak || suggestion.finishers.some((item, index) => item.entrantId !== selected[index])
  const submit = async (action: React.FormEvent) => {
    action.preventDefault()
    setError(''); setMessage(''); setBusy(true)
    try {
      const podium = buildPodium(event, classId, group.id, selected, {
        reason, reraceGroupId: reraceGroupId || undefined, pointRules, revision: priorRevision + 1,
      })
      await onConfirm(podium)
      setMessage('Podium saved.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The podium could not be saved.')
    } finally { setBusy(false) }
  }
  return <section className="panel podium-editor">
    <h2>{priorRevision ? 'Review or correct the podium' : 'Confirm places'}</h2>
    {!suggestion.complete ? <p>Complete every heat in this final to confirm its podium.</p> : <form onSubmit={submit}>
      {suggestion.needsTieBreak && <p className="results-warning">Equal wins affect the podium. Select the confirmed order and record how the tie was resolved.</p>}
      <div className="podium-places">{selected.map((value, index) => <label key={index}>{['1st place', '2nd place', '3rd place'][index]}
        <select required value={value} disabled={busy} onChange={action => setSelected(current => current.map((id, place) => place === index ? action.target.value : id))}>
          <option value="">Choose a car</option>
          {entrants.map(entrant => <option key={entrant.id} value={entrant.id}>{entrant.carNumber} · {cleanName(entrant.name)}</option>)}
        </select>
      </label>)}</div>
      {completeReraces.length > 0 && <label>Tie-break rerace, if used<select value={reraceGroupId} disabled={busy} onChange={action => setReraceGroupId(action.target.value)}>
        <option value="">No linked rerace</option>{completeReraces.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>}
      <label>{manual ? 'Tie-break or correction reason' : 'Result note, optional'}
        <input required={manual} minLength={manual ? 3 : undefined} maxLength={300} disabled={busy} value={reason} onChange={action => setReason(action.target.value)} />
      </label>
      <p>{pointRules ? `Points rule ${pointRules.version} awards ${pointRules.first}, ${pointRules.second} and ${pointRules.third} points.` : 'Points are not configured. Confirmed podium places will still be recorded.'}</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Saving podium…' : 'Confirm podium'}</button>
    </form>}
  </section>
}
