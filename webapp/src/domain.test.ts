import { describe, expect, it } from 'vitest'
import { createEvent, feeRows, generateHeats, groupValidation, reconcileEvent, standings, validEntrants } from './domain'
import type { RaceGroup } from './types'

function group(kind: RaceGroup['kind'], count: number): RaceGroup {
  const event = createEvent('Test', '2026-09-09', '')
  const selected = kind === 'rerace' ? event.reraces[0] : kind === 'main' ? event.mainClasses[0].groups[0] : event.finalsClasses[0].groups[0]
  selected.entrants.slice(0, count).forEach((entrant, i) => { entrant.name = `Racer ${i + 1}`; entrant.carNumber = `${i + 1}` })
  selected.heats = generateHeats(selected)
  return selected
}

describe('verified schedule library', () => {
  it('covers every supported main count once per round', () => {
    for (let n = 6; n <= 21; n++) {
      const g = group('main', n)
      expect(groupValidation(g).valid).toBe(true)
      const rounds = new Set(g.heats.map(h => h.round))
      const completeHeats = new Set<string>()
      const laneCounts = new Map(validEntrants(g).map(entry => [entry.id, [0, 0, 0]]))
      for (const round of rounds) {
        const ids = g.heats.filter(h => h.round === round).flatMap(h => h.lanes.filter(Boolean))
        expect(ids).toHaveLength(n)
        expect(new Set(ids).size).toBe(n)
      }
      for (const heat of g.heats) {
        const key = heat.lanes.filter(Boolean).sort().join('|')
        expect(completeHeats.has(key)).toBe(false)
        completeHeats.add(key)
        heat.lanes.forEach((id, lane) => { if (id) laneCounts.get(id)![lane]++ })
      }
      for (const lanes of laneCounts.values()) expect(Math.max(...lanes) - Math.min(...lanes)).toBeLessThanOrEqual(1)
    }
  })

  it('covers finals 6 through 12', () => {
    for (let n = 6; n <= 12; n++) {
      const g = group('finals', n)
      expect(g.heats.length).toBeGreaterThan(0)
      for (const round of new Set(g.heats.map(h => h.round))) {
        const ids = g.heats.filter(h => h.round === round).flatMap(h => h.lanes.filter(Boolean))
        expect(ids).toHaveLength(n)
        expect(new Set(ids).size).toBe(n)
      }
    }
  })

  it('gives four rerace cars all six unique pairs over three rounds', () => {
    const g = group('rerace', 4)
    const pairs = g.heats.map(h => h.lanes.filter(Boolean).sort().join('|'))
    expect(g.heats).toHaveLength(6)
    expect(new Set(pairs).size).toBe(6)
    expect(new Set(g.heats.map(h => h.round)).size).toBe(3)
  })

  it('covers reraces from 2 through 21', () => {
    for (let n = 2; n <= 21; n++) {
      const g = group('rerace', n)
      expect(g.heats.length).toBeGreaterThan(0)
      const lanes = new Map(validEntrants(g).map(entry => [entry.id, [0, 0, 0]]))
      const completeHeats = new Set<string>()
      for (const heat of g.heats) {
        if (n >= 4) {
          const key = heat.lanes.filter(Boolean).sort().join('|')
          expect(completeHeats.has(key)).toBe(false)
          completeHeats.add(key)
        }
        heat.lanes.forEach((id, lane) => { if (id) lanes.get(id)![lane]++ })
      }
      for (const round of [1, 2, 3]) {
        const ids = g.heats.filter(h => h.round === round).flatMap(h => h.lanes.filter(Boolean))
        expect(ids).toHaveLength(n)
        expect(new Set(ids).size).toBe(n)
      }
      for (const counts of lanes.values()) expect(counts).toEqual([1, 1, 1])
    }
  })

  it('rejects partial entries and duplicate car numbers', () => {
    const g = group('main', 6)
    g.entrants[5].carNumber = ''
    expect(groupValidation(g).valid).toBe(false)
    g.entrants[5].carNumber = g.entrants[4].carNumber
    expect(groupValidation(g).message).toBe('Car numbers must be unique in this group.')
  })

  it('allows one owner name on multiple cars in the same bracket', () => {
    const g = group('main', 6)
    g.entrants.slice(0, 4).forEach(entrant => { entrant.name = 'Shared Owner' })
    expect(groupValidation(g)).toMatchObject({ valid: true, count: 6 })
    expect(generateHeats(g)).toHaveLength(8)
  })

  it('repairs a saved bracket that duplicate names previously left without a schedule', () => {
    const event = createEvent('Legacy event', '2026-09-09', '')
    const g = event.mainClasses[0].groups[0]
    g.entrants.slice(0, 6).forEach((entrant, i) => {
      entrant.name = i < 4 ? 'Shared Owner' : `Racer ${i + 1}`
      entrant.carNumber = `${i + 1}`
    })
    expect(g.heats).toHaveLength(0)
    const repaired = reconcileEvent(event)
    expect(repaired).not.toBe(event)
    expect(repaired.mainClasses[0].groups[0].heats).toHaveLength(8)
  })
})

describe('scoring and fees', () => {
  it('does not count unfinished heats as losses and shares equal ranks', () => {
    const g = group('rerace', 4)
    g.heats[0].winnerId = g.heats[0].lanes.find(Boolean) as string
    const table = standings(g)
    expect(table.reduce((sum, row) => sum + row.wins, 0)).toBe(1)
    expect(table.reduce((sum, row) => sum + row.losses, 0)).toBe(1)
    expect(table.filter(row => row.wins === 0).every(row => row.rank === 2)).toBe(true)
  })

  it('tallies main entries by competitor name only', () => {
    const event = createEvent('Test', '2026-09-09', '')
    const first = event.mainClasses[0].groups[0].entrants[0]
    const second = event.mainClasses[1].groups[0].entrants[0]
    first.name = ' Cesar  Lacsamana '; first.carNumber = '10'
    second.name = 'Cesar Lacsamana'; second.carNumber = '22'
    expect(validEntrants(event.mainClasses[0].groups[0])).toHaveLength(1)
    expect(feeRows(event)).toMatchObject([{ displayName: 'Cesar Lacsamana', entries: 2, due: 30, balance: 30 }])
  })

  it('combines repeated owner names from the same bracket into one fee row', () => {
    const event = createEvent('Test', '2026-09-09', '')
    event.mainClasses[0].groups[0].entrants.slice(0, 4).forEach((entrant, i) => {
      entrant.name = 'Shared Owner'
      entrant.carNumber = `${i + 1}`
    })
    expect(feeRows(event)).toMatchObject([{ displayName: 'Shared Owner', entries: 4, due: 60, balance: 60 }])
  })
})
