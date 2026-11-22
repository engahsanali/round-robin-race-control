import type { AccountEventSummary } from './account-api'
import type { ConfirmedPodium } from './results'
import type { AuditItem, EventData, RaceGroup } from './types'
import { apiPath } from './base'

export class SaveConflict extends Error {
  constructor(public remote: EventData) { super('This event changed on another device.') }
}

export class GroupSaveConflict extends Error {
  constructor(public remote: RaceGroup, public audit: AuditItem[]) { super('This bracket changed in another tab.') }
}

export class AccessDenied extends Error {}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(apiPath(path), { cache: 'no-store', credentials: 'same-origin', ...init })
  const data = await response.json().catch(() => ({ error: 'Invalid response.' }))
  if (response.status === 409 && data.event) throw new SaveConflict(data.event as EventData)
  if (response.status === 409 && data.group) throw new GroupSaveConflict(data.group as RaceGroup, Array.isArray(data.audit) ? data.audit as AuditItem[] : [])
  if ([401, 403, 404].includes(response.status)) throw new AccessDenied(data.error || 'This event is unavailable.')
  if (!response.ok) throw new Error(data.error || 'Request failed.')
  return data
}

export async function createRemote(event: EventData): Promise<{ event: EventData }> {
  const data = await request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) })
  if (!data?.event) throw new Error('Event service is unavailable.')
  return data
}

export async function loadRemote(id: string, watch = false): Promise<{ event: EventData; role: 'owner' | 'viewer' }> {
  const data = await request(watch ? `/api/watch/${encodeURIComponent(id)}` : `/api/events/${encodeURIComponent(id)}`)
  if (!data?.event || !data?.role) throw new Error('Event service is unavailable.')
  return data
}

export async function updateRemote(event: EventData): Promise<EventData> {
  const data = await request(`/api/events/${encodeURIComponent(event.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, expectedVersion: event.version }),
  })
  if (!data?.event) throw new Error('Event service is unavailable.')
  return data.event as EventData
}

export async function updateRemoteGroup(eventId: string, group: RaceGroup, audit: AuditItem[]): Promise<{ group: RaceGroup; audit: AuditItem[] }> {
  const data = await request(`/api/events/${encodeURIComponent(eventId)}/groups/${encodeURIComponent(group.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group, audit, expectedRevision: group.revision ?? 0 }),
  })
  if (!data?.group || !Array.isArray(data.audit)) throw new Error('Bracket service is unavailable.')
  return { group: data.group as RaceGroup, audit: data.audit as AuditItem[] }
}

export function eventResource<T>(eventId: string, resource: 'publication' | 'podiums', value?: unknown): Promise<T> {
  const path = `/api/events/${encodeURIComponent(eventId)}/${resource}`
  return request(path, value === undefined ? {} : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  })
}

export function workspaceHistory() {
  return request('/api/history') as Promise<{ history: { event: AccountEventSummary; podiums: ConfirmedPodium[] }[] }>
}
