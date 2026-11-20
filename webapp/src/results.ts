import { cleanName, standings, validEntrants } from './domain'
import type { Entrant, EventData, RaceGroup } from './types'

export interface PointRules {
  first: number
  second: number
  third: number
  version: number
}

export interface PodiumFinisher {
  place: 1 | 2 | 3
  entrantId: string
  competitorId?: string
  name: string
  carNumber: string
}

export interface ConfirmedPodium {
  eventId: string
  classId: string
  className: string
  sourceGroupId: string
  sourceRevision: number
  reraceGroupId?: string
  reraceRevision?: number
  finishers: PodiumFinisher[]
  confirmedAt: string
  revision: number
  reason?: string
  pointRules?: PointRules
}

export interface SeasonTotal {
  identity: string
  competitorId?: string
  name: string
  first: number
  second: number
  third: number
  events: number
  points: number | null
}

function finisher(entrant: Entrant, index: number): PodiumFinisher {
  const competitorId = (entrant as Entrant & { competitorId?: string }).competitorId
  return {
    place: (index + 1) as 1 | 2 | 3,
    entrantId: entrant.id, name: cleanName(entrant.name), carNumber: entrant.carNumber,
    ...(competitorId ? { competitorId } : {}),
  }
}

export function suggestPodium(group: RaceGroup) {
  const complete = group.heats.length > 0 && group.heats.every(heat => Boolean(heat.winnerId))
  const rows = standings(group)
  const count = Math.min(3, rows.length)
  const needsTieBreak = complete && rows.slice(0, count).some(row => rows.filter(other => other.wins === row.wins).length > 1)
  return {
    complete, needsTieBreak,
    finishers: complete && !needsTieBreak ? rows.slice(0, count).map((row, index) => finisher(row.entrant, index)) : [],
  }
}

export function pointRulesAreValid(rules: PointRules): boolean {
  return Boolean(rules && Number.isInteger(rules.version) && rules.version >= 1 &&
    [rules.first, rules.second, rules.third].every(value => Number.isFinite(value) && value >= 0 && value <= 100000))
}

export interface PodiumOptions {
  reason?: string
  reraceGroupId?: string
  pointRules?: PointRules
  revision?: number
  confirmedAt?: string
}

export function buildPodium(event: EventData, classId: string, sourceGroupId: string, entrantIds: string[], options: PodiumOptions = {}): ConfirmedPodium {
  const raceClass = event.finalsClasses.find(item => item.id === classId)
  const group = raceClass?.groups.find(item => item.id === sourceGroupId && item.kind === 'finals')
  if (!raceClass || !group) throw new Error('Choose a deciding final in this category.')
  const suggestion = suggestPodium(group)
  if (!suggestion.complete) throw new Error('Complete every heat in the deciding final before confirming places.')
  const entrants = validEntrants(group)
  const count = Math.min(3, entrants.length)
  if (!count || entrantIds.length !== count || new Set(entrantIds).size !== count) throw new Error('Choose a different eligible car for each place.')
  const finishers = entrantIds.map((id, index) => {
    const entrant = entrants.find(item => item.id === id)
    if (!entrant) throw new Error('A selected car is absent from this final.')
    return finisher(entrant, index)
  })
  const manual = suggestion.needsTieBreak || suggestion.finishers.some((item, index) => item.entrantId !== entrantIds[index])
  const reason = options.reason?.trim()
  if (manual && (!reason || reason.length < 3)) throw new Error('Enter a reason for the tie-break or adjusted result.')
  if (reason && reason.length > 300) throw new Error('Use a result reason of 300 characters or fewer.')
  const rerace = options.reraceGroupId ? event.reraces.find(item => item.id === options.reraceGroupId) : undefined
  if (options.reraceGroupId && (!rerace || !suggestPodium(rerace).complete)) throw new Error('Complete the selected tie-break rerace.')
  if (options.pointRules && !pointRulesAreValid(options.pointRules)) throw new Error('The points rule is invalid.')
  const revision = options.revision ?? 1
  if (!Number.isInteger(revision) || revision < 1) throw new Error('The result revision is invalid.')
  const confirmedAt = options.confirmedAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(confirmedAt))) throw new Error('The confirmation date is invalid.')
  return {
    eventId: event.id, classId: raceClass.id, className: raceClass.name,
    sourceGroupId: group.id, sourceRevision: group.revision ?? 0, finishers, revision, confirmedAt,
    ...(reason ? { reason } : {}),
    ...(rerace ? { reraceGroupId: rerace.id, reraceRevision: rerace.revision ?? 0 } : {}),
    ...(options.pointRules ? { pointRules: {
      first: options.pointRules.first, second: options.pointRules.second, third: options.pointRules.third, version: options.pointRules.version,
    } } : {}),
  }
}

/** Rebuild submitted results from current race state before accepting a confirmation. */
export function validatePodium(event: EventData, podium: ConfirmedPodium): string[] {
  try {
    if (podium.eventId !== event.id) return ['The result belongs to a different event.']
    const expected = buildPodium(event, podium.classId, podium.sourceGroupId, podium.finishers.map(row => row.entrantId), podium)
    if (expected.sourceRevision !== podium.sourceRevision || expected.reraceRevision !== podium.reraceRevision) return ['The source bracket revision changed. Review the latest results.']
    const changed = expected.finishers.some((row, index) => {
      const saved = podium.finishers[index]
      return row.place !== saved.place || row.entrantId !== saved.entrantId || row.competitorId !== saved.competitorId ||
        row.name !== saved.name || row.carNumber !== saved.carNumber
    })
    if (expected.className !== podium.className || changed) return ['The recorded finishers differ from the saved final.']
    return []
  } catch (error) {
    return [error instanceof Error ? error.message : 'Invalid result.']
  }
}

/** Latest event/category revisions count once. Unlinked racers stay scoped to their entry. */
export function aggregatePodiums(podiums: ConfirmedPodium[]): SeasonTotal[] {
  const current = new Map<string, ConfirmedPodium>()
  for (const podium of podiums) {
    const key = JSON.stringify([podium.eventId, podium.classId])
    const prior = current.get(key)
    if (!prior || podium.revision > prior.revision || (podium.revision === prior.revision && podium.confirmedAt > prior.confirmedAt)) current.set(key, podium)
  }
  const totals = new Map<string, SeasonTotal & { eventIds: Set<string> }>()
  for (const podium of current.values()) {
    for (const row of podium.finishers) {
      const identity = row.competitorId ? 'competitor:' + row.competitorId : 'entry:' + podium.eventId + ':' + row.entrantId
      const total = totals.get(identity) ?? {
        identity, competitorId: row.competitorId, name: row.name,
        first: 0, second: 0, third: 0, events: 0, points: 0, eventIds: new Set<string>(),
      }
      total.name = row.name
      const place = row.place === 1 ? 'first' : row.place === 2 ? 'second' : 'third'
      total[place]++
      total.eventIds.add(podium.eventId)
      if (!podium.pointRules) total.points = null
      else if (total.points !== null) total.points = Math.round((total.points + podium.pointRules[place]) * 100) / 100
      totals.set(identity, total)
    }
  }
  return [...totals.values()].map(({ eventIds, ...row }) => ({ ...row, events: eventIds.size }))
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || b.first - a.first || b.second - a.second || b.third - a.third || a.identity.localeCompare(b.identity))
}
