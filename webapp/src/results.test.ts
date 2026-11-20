import { describe, expect, it } from 'vitest'
import { createEvent } from './domain'
import { aggregatePodiums, buildPodium, suggestPodium, validatePodium, type ConfirmedPodium } from './results'

function fixture() {
  const event = createEvent('Results', '2026-11-20', '')
  event.id = 'event-one'
  const cls = event.finalsClasses[0]
  const group = cls.groups[0]
  group.revision = 4
  group.entrants.slice(0, 4).forEach((entry, index) => Object.assign(entry, { name: 'Same Name', carNumber: String(index + 1) }))
  const [a, b, c, d] = group.entrants
  group.heats = [
    { id: 'h1', round: 1, heat: 1, lanes: [a.id, b.id, null], winnerId: a.id },
    { id: 'h2', round: 2, heat: 1, lanes: [a.id, c.id, null], winnerId: a.id },
    { id: 'h3', round: 3, heat: 1, lanes: [b.id, c.id, null], winnerId: b.id },
    { id: 'h4', round: 4, heat: 1, lanes: [c.id, d.id, null], winnerId: c.id },
    { id: 'h5', round: 5, heat: 1, lanes: [a.id, d.id, null], winnerId: a.id },
  ]
  return { event, cls, group }
}

describe('confirmed podiums', () => {
  it('requires finished heats and refuses to resolve tied podiums by car number', () => {
    const { group } = fixture()
    expect(suggestPodium(group).finishers).toHaveLength(0)
    expect(suggestPodium(group).needsTieBreak).toBe(true)
    group.heats[2].winnerId = null
    expect(suggestPodium(group).complete).toBe(false)
  })

  it('derives authoritative names and requires a reason for a manual tied result', () => {
    const { event, cls, group } = fixture()
    const selected = group.entrants.slice(0, 3).map(entry => entry.id)
    expect(() => buildPodium(event, cls.id, group.id, selected)).toThrow(/reason/i)
    const podium = buildPodium(event, cls.id, group.id, selected, { reason: 'Track rerace confirmed by organiser' })
    expect(podium.sourceRevision).toBe(4)
    expect(podium.finishers.map(row => row.place)).toEqual([1, 2, 3])
    expect(validatePodium(event, podium)).toEqual([])
    expect(validatePodium(event, { ...podium, finishers: podium.finishers.map(row => ({ ...row, name: 'Forged' })) })).not.toEqual([])
    group.revision = 5
    expect(validatePodium(event, podium).join(' ')).toMatch(/revision/i)
  })

  it('rejects duplicate finishers and nonfinal source groups', () => {
    const { event, cls, group } = fixture()
    expect(() => buildPodium(event, cls.id, group.id, [group.entrants[0].id, group.entrants[0].id], { reason: 'Result' })).toThrow()
    expect(() => buildPodium(event, cls.id, event.mainClasses[0].groups[0].id, [])).toThrow()
  })
})

describe('history points', () => {
  it('deduplicates corrected results and keeps unrelated racers with the same name separate', () => {
    const { event, cls, group } = fixture()
    const rules = { first: 10, second: 6, third: 3, version: 1 }
    const original = buildPodium(event, cls.id, group.id, group.entrants.slice(0, 3).map(entry => entry.id), { reason: 'Confirmed', pointRules: rules })
    const corrected: ConfirmedPodium = { ...original, revision: 2, finishers: [original.finishers[1], original.finishers[0], original.finishers[2]].map((row, index) => ({ ...row, place: (index + 1) as 1 | 2 | 3 })) }
    const totals = aggregatePodiums([original, corrected, corrected])
    expect(totals).toHaveLength(3)
    expect(totals.reduce((sum, row) => sum + row.first, 0)).toBe(1)
    expect(totals.find(row => row.identity.endsWith(original.finishers[1].entrantId))?.points).toBe(10)
  })

  it('uses competitor IDs across events and leaves points unset without configured rules', () => {
    const { event, cls, group } = fixture()
    const podium = buildPodium(event, cls.id, group.id, group.entrants.slice(0, 3).map(entry => entry.id), { reason: 'Confirmed' })
    podium.finishers[0].competitorId = 'stable-racer'
    const other = { ...podium, eventId: 'event-two', finishers: [{ ...podium.finishers[0], name: 'New nickname' }] }
    const row = aggregatePodiums([podium, other]).find(row => row.identity === 'competitor:stable-racer')
    expect(row).toMatchObject({ first: 2, points: null, events: 2 })
  })
})
