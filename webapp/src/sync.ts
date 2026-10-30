import { allGroups, findGroup } from './domain'
import type { AuditItem, EventData, RaceClass, RaceGroup } from './types'

export const META_SCOPE = '$event'

export function groupRevision(group: RaceGroup): number {
  return Number.isInteger(group.revision) && (group.revision ?? 0) >= 0 ? group.revision! : 0
}

export function mergeAudits(...lists: AuditItem[][]): AuditItem[] {
  const seen = new Set<string>()
  return lists.flat().filter(item => {
    if (!item?.id || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 250)
}

function replaceGroupSnapshot(event: EventData, group: RaceGroup): EventData {
  const replaceClasses = (classes: RaceClass[]) => classes.map(cls => ({
    ...cls,
    groups: cls.groups.map(item => item.id === group.id ? group : item),
  }))
  return {
    ...event,
    mainClasses: replaceClasses(event.mainClasses),
    finalsClasses: replaceClasses(event.finalsClasses),
    reraces: event.reraces.map(item => item.id === group.id ? group : item),
  }
}

export function changedScheduleGroupIds(before: EventData, after: EventData): string[] {
  return allGroups(after).filter(group => {
    const previous = findGroup(before, group.id)
    return Boolean(previous && previous.heats.length !== group.heats.length)
  }).map(group => group.id)
}

/** Merge a fresh server snapshot without replacing local scopes that still need saving. */
export function mergeRemoteEvent(local: EventData, remote: EventData, protectedGroups: Set<string>, protectMeta: boolean): EventData {
  let merged: EventData = protectMeta ? {
    ...remote,
    version: local.version,
    name: local.name,
    date: local.date,
    venue: local.venue,
    entryFee: local.entryFee,
    status: local.status,
    payments: local.payments,
    updatedAt: local.updatedAt,
  } : remote

  for (const groupId of protectedGroups) {
    const localGroup = findGroup(local, groupId)
    if (localGroup) merged = replaceGroupSnapshot(merged, localGroup)
  }

  const protectedAudit = local.audit.filter(item =>
    protectMeta ? !item.groupId || protectedGroups.has(item.groupId) : Boolean(item.groupId && protectedGroups.has(item.groupId)),
  )
  return { ...merged, audit: mergeAudits(protectedAudit, remote.audit) }
}

/** Apply a successful bracket save while optionally preserving edits made during the request. */
export function mergeSavedGroup(local: EventData, saved: RaceGroup, remoteAudit: AuditItem[], preserveLocal: boolean): EventData {
  const current = findGroup(local, saved.id)
  const group = preserveLocal && current ? { ...current, revision: saved.revision } : saved
  const merged = replaceGroupSnapshot(local, group)
  return { ...merged, audit: mergeAudits(local.audit, remoteAudit) }
}
