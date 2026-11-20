import type { AuditItem, EventData, RaceGroup } from './types'

const EVENT_PREFIX = 'round-robin-event:'
const DRAFT_PREFIX = 'round-robin-draft:'

export interface LocalDraft {
  id: string
  event: EventData
  scopes: string[]
}

export class SaveConflict extends Error {
  constructor(public remote: EventData) { super('This event changed on another device.') }
}

export class GroupSaveConflict extends Error {
  constructor(public remote: RaceGroup, public audit: AuditItem[]) { super('This bracket changed in another tab.') }
}

export function saveLocal(event: EventData, ownerKey?: string) {
  try {
    const key = `round-robin-key:${event.id}`
    if (!ownerKey && localStorage.getItem(key)) return true
    if (ownerKey) localStorage.setItem(key, ownerKey)
    localStorage.setItem(EVENT_PREFIX + event.id, JSON.stringify(event))
    return true
  } catch { return false }
}

export function saveLocalDraft(draft: LocalDraft) {
  try {
    const key = DRAFT_PREFIX + draft.id
    if (draft.scopes.length) localStorage.setItem(key, JSON.stringify(draft))
    else localStorage.removeItem(key)
    return true
  } catch { return false }
}

export function localDrafts(): LocalDraft[] {
  try {
    return Object.keys(localStorage).filter(key => key.startsWith(DRAFT_PREFIX))
      .map(key => JSON.parse(localStorage.getItem(key) ?? 'null') as LocalDraft | null)
      .filter((draft): draft is LocalDraft => Boolean(draft?.event?.id && draft.scopes?.length))
      .sort((a, b) => b.event.updatedAt.localeCompare(a.event.updatedAt))
  } catch { return [] }
}

export function loadLocal(id: string): EventData | null {
  try { return JSON.parse(localStorage.getItem(EVENT_PREFIX + id) ?? 'null') as EventData | null } catch { return null }
}

export function localEvents(): EventData[] {
  try {
    return Object.keys(localStorage).filter(key => key.startsWith(EVENT_PREFIX))
      .map(key => loadLocal(key.slice(EVENT_PREFIX.length)))
      .filter((event): event is EventData => Boolean(event))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch { return [] }
}

export function savedKey(id: string): string {
  const fromHash = new URLSearchParams(location.search).get('event') === id
    ? new URLSearchParams(location.hash.slice(1)).get('key') : null
  try {
    return fromHash || localStorage.getItem(`round-robin-key:${id}`) || ''
  } catch { return fromHash || '' }
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(path, init)
  const data = await response.json().catch(() => ({ error: 'Invalid response.' }))
  if (response.status === 409 && data.event) throw new SaveConflict(data.event as EventData)
  if (response.status === 409 && data.group) throw new GroupSaveConflict(data.group as RaceGroup, Array.isArray(data.audit) ? data.audit as AuditItem[] : [])
  if (!response.ok) throw new Error(data.error || 'Request failed.')
  return data
}

export async function createRemote(event: EventData): Promise<{ event: EventData; ownerKey: string }> {
  const data = await request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) })
  if (!data?.event || !data?.ownerKey) throw new Error('Event service is unavailable.')
  return data
}

export async function loadRemote(id: string, ownerKey = ''): Promise<{ event: EventData; role: 'owner' | 'viewer' }> {
  const data = await request(`/api/events/${encodeURIComponent(id)}`, { headers: ownerKey ? { 'x-event-key': ownerKey } : {} })
  if (!data?.event || !data?.role) throw new Error('Event service is unavailable.')
  return data
}

export async function updateRemote(event: EventData, ownerKey: string): Promise<EventData> {
  const data = await request(`/api/events/${encodeURIComponent(event.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-event-key': ownerKey },
    body: JSON.stringify({ event, expectedVersion: event.version }),
  })
  if (!data?.event) throw new Error('Event service is unavailable.')
  return data.event as EventData
}

export async function updateRemoteGroup(eventId: string, group: RaceGroup, audit: AuditItem[], ownerKey: string): Promise<{ group: RaceGroup; audit: AuditItem[] }> {
  const data = await request(`/api/events/${encodeURIComponent(eventId)}/groups/${encodeURIComponent(group.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-event-key': ownerKey },
    body: JSON.stringify({ group, audit, expectedRevision: group.revision ?? 0 }),
  })
  if (!data?.group || !Array.isArray(data.audit)) throw new Error('Bracket service is unavailable.')
  return { group: data.group as RaceGroup, audit: data.audit as AuditItem[] }
}
