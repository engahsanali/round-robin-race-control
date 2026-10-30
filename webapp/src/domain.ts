import mainLibrary from './data/main-library.json'
import reraceLibrary from './data/rerace-library.json'
import type { AuditItem, Entrant, EventData, Heat, Payment, RaceClass, RaceGroup, StageKind, Standing } from './types'

const CLASS_NAMES = ['Box Stock', 'BMAX NCFM', 'BMAX Mixed', 'Open']
const MAX_ENTRANTS = 21

export function makeId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID()}`
}

export function blankEntrants(): Entrant[] {
  return Array.from({ length: MAX_ENTRANTS }, (_, i) => ({ id: makeId(`slot-${i + 1}`), name: '', carNumber: '' }))
}

function makeGroups(kind: StageKind, labels: string[]): RaceGroup[] {
  return labels.map((label, index) => ({ id: makeId(`${kind}-${index + 1}`), label, kind, entrants: blankEntrants(), drawSeed: randomSeed(), heats: [], revision: 0 }))
}

function makeClasses(kind: 'main' | 'finals'): RaceClass[] {
  return CLASS_NAMES.map(name => ({
    id: makeId(kind),
    name,
    groups: makeGroups(kind, Array.from({ length: 6 }, (_, i) => kind === 'main' ? `Bracket ${String.fromCharCode(65 + i)}` : `Final ${String.fromCharCode(65 + i)}`)),
  }))
}

export function createEvent(name: string, date: string, venue: string): EventData {
  const now = new Date().toISOString()
  const event: EventData = {
    id: '', version: 0, name: name.trim() || 'Race event', date, venue: venue.trim(), entryFee: 15, status: 'draft',
    mainClasses: makeClasses('main'), finalsClasses: makeClasses('finals'),
    reraces: makeGroups('rerace', Array.from({ length: 6 }, (_, i) => `Tie group ${i + 1}`)),
    payments: {}, audit: [], createdAt: now, updatedAt: now,
  }
  return addAudit(event, 'create', 'Event created')
}

export function randomSeed(): number {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0] || 1
}

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], seed: number): T[] {
  const result = [...items]
  const next = rng(seed)
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function cleanName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function validEntrants(group: RaceGroup): Entrant[] {
  return group.entrants.filter(entry => cleanName(entry.name) && /^\d+$/.test(entry.carNumber) && Number(entry.carNumber) > 0)
}

export function groupValidation(group: RaceGroup): { valid: boolean; message: string; count: number } {
  const partial = group.entrants.some(entry => Boolean(cleanName(entry.name)) !== Boolean(entry.carNumber.trim()))
  if (partial) return { valid: false, message: 'Complete both name and car number for every entered car.', count: validEntrants(group).length }
  const entrants = validEntrants(group)
  const cars = entrants.map(entry => Number(entry.carNumber))
  if (new Set(cars).size !== cars.length) return { valid: false, message: 'Car numbers must be unique in this group.', count: entrants.length }
  const [min, max] = group.kind === 'rerace' ? [2, 21] : group.kind === 'finals' ? [6, 12] : [6, 21]
  if (entrants.length < min) return { valid: false, message: `Enter at least ${min} complete cars.`, count: entrants.length }
  if (entrants.length > max) return { valid: false, message: `This stage supports up to ${max} cars.`, count: entrants.length }
  return { valid: true, message: 'Ready', count: entrants.length }
}

type MainRow = [string, number, number, number, number, number, number, number]
type ReraceRow = [number, number, number, number, number, number]

export function generateHeats(group: RaceGroup, seed = group.drawSeed): Heat[] {
  const validation = groupValidation(group)
  if (!validation.valid) return []
  const entrants = shuffled(validEntrants(group), seed)
  if (group.kind === 'rerace') {
    return (reraceLibrary as ReraceRow[])
      .filter(row => row[0] === entrants.length)
      .map(row => ({
        id: `${group.id}-${row[1]}-${row[2]}`,
        round: row[1], heat: row[2],
        lanes: row.slice(3, 6).map(slot => slot ? entrants[slot - 1].id : null),
        winnerId: null,
      }))
  }
  const phase = group.kind === 'main' ? 'Main' : 'Finals'
  return (mainLibrary as MainRow[])
    .filter(row => row[0] === phase && row[1] === entrants.length)
    .map(row => ({
      id: `${group.id}-${row[3]}-${row[4]}`,
      round: row[3], heat: row[4],
      lanes: row.slice(5, 8).map(slot => slot ? entrants[Number(slot) - 1].id : null),
      winnerId: null,
    }))
}

export function reconcileGroup(group: RaceGroup): RaceGroup {
  if (group.heats.some(heat => heat.winnerId)) return group
  const validation = groupValidation(group)
  return { ...group, heats: validation.valid ? generateHeats(group) : [] }
}

export function reconcileEvent(event: EventData): EventData {
  let changed = false
  const reconcileClasses = (classes: RaceClass[]) => classes.map(cls => ({
    ...cls,
    groups: cls.groups.map(group => {
      const next = reconcileGroup(group)
      if (next.heats.length !== group.heats.length) changed = true
      return next
    }),
  }))
  const next: EventData = {
    ...event,
    mainClasses: reconcileClasses(event.mainClasses),
    finalsClasses: reconcileClasses(event.finalsClasses),
    reraces: event.reraces.map(group => {
      const nextGroup = reconcileGroup(group)
      if (nextGroup.heats.length !== group.heats.length) changed = true
      return nextGroup
    }),
  }
  return changed ? { ...next, updatedAt: new Date().toISOString() } : event
}

export function redrawGroup(group: RaceGroup): RaceGroup {
  if (group.heats.some(heat => heat.winnerId)) return group
  const drawSeed = randomSeed()
  return { ...group, drawSeed, heats: generateHeats({ ...group, drawSeed }, drawSeed) }
}

export function standings(group: RaceGroup): Standing[] {
  const entrants = validEntrants(group)
  const records = new Map(entrants.map(entry => [entry.id, { wins: 0, losses: 0, completed: 0 }]))
  for (const heat of group.heats) {
    if (!heat.winnerId) continue
    for (const id of heat.lanes.filter(Boolean) as string[]) {
      const record = records.get(id)
      if (!record) continue
      record.completed++
      if (id === heat.winnerId) record.wins++
      else record.losses++
    }
  }
  const rows = entrants.map(entrant => ({ entrant, ...(records.get(entrant.id) ?? { wins: 0, losses: 0, completed: 0 }), rank: 0 }))
  for (const row of rows) row.rank = 1 + rows.filter(other => other.wins > row.wins).length
  return rows.sort((a, b) => a.rank - b.rank || Number(a.entrant.carNumber) - Number(b.entrant.carNumber))
}

export function groupStatus(group: RaceGroup): string {
  const validation = groupValidation(group)
  if (!validation.valid) return validation.message
  const completed = group.heats.filter(heat => heat.winnerId).length
  if (!completed) return `Schedule ready · ${group.heats.length} heats`
  if (completed < group.heats.length) return `Racing · ${completed} of ${group.heats.length} heats complete · roster locked`
  return group.kind === 'rerace' ? 'Complete · equal wins still share a rank' : 'Complete · final rankings shown'
}

export function setWinner(group: RaceGroup, heatId: string, winnerId: string | null): RaceGroup {
  return {
    ...group,
    heats: group.heats.map(heat => {
      if (heat.id !== heatId) return heat
      if (winnerId && !heat.lanes.includes(winnerId)) return heat
      return { ...heat, winnerId }
    }),
  }
}

export function allGroups(event: EventData): RaceGroup[] {
  return [...event.mainClasses.flatMap(c => c.groups), ...event.finalsClasses.flatMap(c => c.groups), ...event.reraces]
}

export function findGroup(event: EventData, groupId: string): RaceGroup | undefined {
  return allGroups(event).find(group => group.id === groupId)
}

export function replaceGroup(event: EventData, group: RaceGroup): EventData {
  const replaceClasses = (classes: RaceClass[]) => classes.map(c => ({ ...c, groups: c.groups.map(g => g.id === group.id ? group : g) }))
  return {
    ...event,
    mainClasses: replaceClasses(event.mainClasses),
    finalsClasses: replaceClasses(event.finalsClasses),
    reraces: event.reraces.map(g => g.id === group.id ? group : g),
    updatedAt: new Date().toISOString(),
  }
}

export function addAudit(event: EventData, action: AuditItem['action'], message: string, detail: Partial<AuditItem> = {}): EventData {
  const item: AuditItem = { id: makeId('audit'), at: new Date().toISOString(), action, message, ...detail }
  return { ...event, audit: [item, ...event.audit].slice(0, 250), updatedAt: item.at }
}

export function normalNameKey(name: string) {
  return cleanName(name).toLocaleLowerCase()
}

export function feeRows(event: EventData) {
  const totals = new Map<string, { displayName: string; entries: number }>()
  for (const group of event.mainClasses.flatMap(c => c.groups)) {
    for (const entrant of validEntrants(group)) {
      const key = normalNameKey(entrant.name)
      const current = totals.get(key) ?? { displayName: cleanName(entrant.name), entries: 0 }
      current.entries++
      totals.set(key, current)
    }
  }
  return [...totals.entries()].map(([nameKey, total]) => {
    const payment: Payment = event.payments[nameKey] ?? { nameKey, displayName: total.displayName, paid: 0 }
    const due = total.entries * event.entryFee
    return { ...total, nameKey, paid: payment.paid, due, balance: Math.max(0, due - payment.paid) }
  }).sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function completedHeatCount(event: EventData) {
  return allGroups(event).reduce((sum, group) => sum + group.heats.filter(heat => heat.winnerId).length, 0)
}

export function eventToCsv(event: EventData): string {
  const rows: string[][] = [['Stage', 'Class', 'Group', 'Round', 'Heat', 'Lane 1', 'Lane 2', 'Lane 3', 'Winner']]
  const append = (classes: RaceClass[]) => classes.forEach(cls => cls.groups.forEach(group => appendGroup(group, cls.name)))
  const appendGroup = (group: RaceGroup, className: string) => {
    const names = new Map(group.entrants.map(e => [e.id, `${e.carNumber} - ${cleanName(e.name)}`]))
    group.heats.forEach(heat => rows.push([group.kind, className, group.label, `${heat.round}`, `${heat.heat}`, ...heat.lanes.map(id => id ? names.get(id) ?? '' : ''), heat.winnerId ? names.get(heat.winnerId) ?? '' : '']))
  }
  append(event.mainClasses); append(event.finalsClasses); event.reraces.forEach(group => appendGroup(group, 'Rerace'))
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
  return rows.map(row => row.map(quote).join(',')).join('\r\n')
}
