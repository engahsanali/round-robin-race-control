import { describe, expect, it } from 'vitest'
import { addAudit, createEvent, findGroup, replaceGroup } from './domain'
import { groupRevision, mergeAudits, mergeRemoteEvent, mergeSavedGroup } from './sync'

describe('independent bracket synchronization', () => {
  it('gives every new bracket revision zero', () => {
    const event = createEvent('Test', '2026-09-11', '')
    expect(event.mainClasses.flatMap(cls => cls.groups).every(group => groupRevision(group) === 0)).toBe(true)
  })

  it('keeps a dirty local bracket while accepting another bracket from the server', () => {
    const base = createEvent('Test', '2026-09-11', '')
    const groupA = base.mainClasses[0].groups[0]
    const groupB = base.mainClasses[0].groups[1]
    const local = replaceGroup(base, { ...groupA, label: 'Bracket A - local' })
    const remote = replaceGroup(structuredClone(base), { ...groupB, label: 'Bracket B - remote', revision: 1 })
    const merged = mergeRemoteEvent(local, remote, new Set([groupA.id]), false)
    expect(findGroup(merged, groupA.id)?.label).toBe('Bracket A - local')
    expect(findGroup(merged, groupB.id)?.label).toBe('Bracket B - remote')
    expect(findGroup(merged, groupB.id)?.revision).toBe(1)
  })

  it('rebases newer local edits onto the revision returned by a completed save', () => {
    const base = createEvent('Test', '2026-09-11', '')
    const group = base.mainClasses[0].groups[0]
    const local = replaceGroup(base, { ...group, label: 'Newer local label' })
    const saved = { ...group, label: 'Earlier saved label', revision: 4 }
    const merged = mergeSavedGroup(local, saved, [], true)
    expect(findGroup(merged, group.id)?.label).toBe('Newer local label')
    expect(findGroup(merged, group.id)?.revision).toBe(4)
  })

  it('deduplicates activity received from multiple bracket records', () => {
    const event = createEvent('Test', '2026-09-11', '')
    const group = event.mainClasses[0].groups[0]
    const withAudit = addAudit(event, 'draw', 'New draw', { groupId: group.id })
    expect(mergeAudits(withAudit.audit, withAudit.audit)).toHaveLength(withAudit.audit.length)
  })
})
