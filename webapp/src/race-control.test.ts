import { expect, it } from 'vitest'
import { createEvent } from './domain'
import { groupProgress, raceControlRows } from './RaceControl'

it('counts entered groups and keeps incomplete roster work visible', () => {
  const event = createEvent('Race control test', '2026-11-20', '')
  const group = event.mainClasses[0].groups[0]
  group.entrants[0].name = 'Racer'
  expect(groupProgress(group)).toMatchObject({ entered: true, entries: 0, status: 'attention', completed: 0, heats: 0 })
  const rows = raceControlRows(event)
  expect(rows.filter(row => row.progress.entered)).toHaveLength(1)
  expect(rows.find(row => row.group.id === group.id)?.category).toBe('Box Stock')
})

it('separates ready, racing, and completed heat counts without treating empty draws as complete', () => {
  const event = createEvent('Race control test', '2026-11-20', '')
  const group = event.reraces[0]
  expect(groupProgress(group).status).toBe('empty')
  group.entrants.slice(0, 2).forEach((entry, index) => { entry.name = 'Racer ' + index; entry.carNumber = String(index + 1) })
  group.heats = [
    { id: 'heat-a', round: 1, heat: 1, lanes: [group.entrants[0].id, group.entrants[1].id, null], winnerId: null },
    { id: 'heat-b', round: 2, heat: 1, lanes: [group.entrants[0].id, group.entrants[1].id, null], winnerId: null },
  ]
  expect(groupProgress(group)).toMatchObject({ status: 'ready', completed: 0, heats: 2, percent: 0 })
  group.heats[0].winnerId = group.entrants[0].id
  expect(groupProgress(group)).toMatchObject({ status: 'racing', completed: 1, percent: 50 })
  group.heats[1].winnerId = group.entrants[1].id
  expect(groupProgress(group)).toMatchObject({ status: 'complete', completed: 2, percent: 100 })
})
