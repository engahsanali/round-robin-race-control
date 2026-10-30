import type { AuditItem, EventData, RaceGroup } from './types'

const INDEX = 'round-robin-event-index'

export class SaveConflict extends Error {
  constructor(public remote: EventData) { super('This event changed on another device.') }
}

export class GroupSaveConflict extends Error {
  constructor(public remote: RaceGroup, public audit: AuditItem[]) { super('This bracket changed in another tab.') }
}

function index(): string[] {
  try { return JSON.parse(localStorage.getItem(INDEX) ?? '[]') as string[] } catch { return [] }
}

export function saveLocal(event: EventData, ownerKey?: string) {
  localStorage.setItem(`round-robin-event:${event.id}`, JSON.stringify(event))
  localStorage.setItem(INDEX, JSON.stringify([event.id, ...index().filter(id => id !== event.id)].slice(0, 20)))
  if (ownerKey) localStorage.setItem(`round-robin-key:${event.id}`, ownerKey)
}

export function loadLocal(id: string): EventData | null {
  try { return JSON.parse(localStorage.getItem(`round-robin-event:${id}`) ?? 'null') as EventData | null } catch { return null }
}

export function localEvents(): EventData[] {
  return index().map(loadLocal).filter(Boolean) as EventData[]
}

export function savedKey(id: string): string {
  const match = location.hash.match(/(?:^#|&)key=([^&]+)/)
  const fromHash = match ? decodeURIComponent(match[1]) : ''
  if (fromHash) localStorage.setItem(`round-robin-key:${id}`, fromHash)
  return fromHash || localStorage.getItem(`round-robin-key:${id}`) || ''
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
