import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import type { AuditItem, EventData, GroupRecord, RaceClass, RaceGroup } from '../../src/types'

const store = getStore({ name: 'round-robin-events', consistency: 'strong' })
const EVENT_LIMIT = 1_500_000
const GROUP_LIMIT = 500_000

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function randomToken(bytes = 24) {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  return Buffer.from(data).toString('base64url')
}

function auditItemIsSafe(item: AuditItem) {
  return Boolean(item && typeof item.id === 'string' && item.id.length <= 100 && typeof item.at === 'string' && item.at.length <= 40 &&
    typeof item.message === 'string' && item.message.length <= 300 && ['edit', 'draw', 'result', 'payment', 'create'].includes(item.action) &&
    (!item.groupId || typeof item.groupId === 'string') && (!item.heatId || typeof item.heatId === 'string'))
}

function groupIsSafe(group: RaceGroup) {
  if (!group || typeof group.id !== 'string' || typeof group.label !== 'string' || group.label.length > 120) return false
  if (!['main', 'finals', 'rerace'].includes(group.kind) || !Array.isArray(group.entrants) || group.entrants.length !== 21 || !Array.isArray(group.heats)) return false
  if (group.revision !== undefined && (!Number.isInteger(group.revision) || group.revision < 0 || group.revision > 1_000_000_000)) return false
  if (group.heats.length > 200) return false
  if (group.entrants.some(e => !e || typeof e.id !== 'string' || typeof e.name !== 'string' || e.name.length > 100 || typeof e.carNumber !== 'string' || e.carNumber.length > 12)) return false
  return group.heats.every(heat => {
    if (!heat || typeof heat.id !== 'string' || !Number.isInteger(heat.round) || !Number.isInteger(heat.heat) || !Array.isArray(heat.lanes) || heat.lanes.length !== 3) return false
    if (heat.winnerId && !heat.lanes.includes(heat.winnerId)) return false
    return heat.lanes.every(id => id === null || group.entrants.some(entry => entry.id === id))
  })
}

function eventIsSafe(event: EventData) {
  if (!event || typeof event !== 'object' || typeof event.name !== 'string' || event.name.length > 120 || typeof event.venue !== 'string' || event.venue.length > 160) return false
  if (typeof event.date !== 'string' || event.date.length > 20 || !Number.isFinite(event.entryFee) || event.entryFee < 0 || event.entryFee > 1000) return false
  if (!['draft', 'live', 'complete'].includes(event.status) || !Array.isArray(event.mainClasses) || event.mainClasses.length !== 4 || !Array.isArray(event.finalsClasses) || event.finalsClasses.length !== 4 || !Array.isArray(event.reraces) || event.reraces.length !== 6) return false
  const classes = [...event.mainClasses, ...event.finalsClasses]
  if (classes.some(c => !c || typeof c.name !== 'string' || c.name.length > 80 || !Array.isArray(c.groups) || c.groups.length !== 6)) return false
  if (![...classes.flatMap(c => c.groups), ...event.reraces].every(groupIsSafe)) return false
  if (!event.payments || typeof event.payments !== 'object' || Array.isArray(event.payments) || !Array.isArray(event.audit) || event.audit.length > 250 || !event.audit.every(auditItemIsSafe)) return false
  return JSON.stringify(event).length < EVENT_LIMIT
}

function allGroups(event: EventData) {
  return [...event.mainClasses.flatMap(cls => cls.groups), ...event.finalsClasses.flatMap(cls => cls.groups), ...event.reraces]
}

function findGroup(event: EventData, groupId: string) {
  return allGroups(event).find(group => group.id === groupId)
}

function replaceGroup(event: EventData, group: RaceGroup): EventData {
  const replaceClasses = (classes: RaceClass[]) => classes.map(cls => ({ ...cls, groups: cls.groups.map(item => item.id === group.id ? group : item) }))
  return {
    ...event,
    mainClasses: replaceClasses(event.mainClasses),
    finalsClasses: replaceClasses(event.finalsClasses),
    reraces: event.reraces.map(item => item.id === group.id ? group : item),
  }
}

function mergeAudits(...lists: AuditItem[][]) {
  const seen = new Set<string>()
  return lists.flat().filter(item => {
    if (!item?.id || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 250)
}

function groupKey(eventId: string, groupId: string) {
  return `group/${eventId}/${groupId}`
}

async function groupSnapshot(base: EventData, groupId: string) {
  const baseGroup = findGroup(base, groupId)
  if (!baseGroup) return null
  const stored = await store.getWithMetadata(groupKey(base.id, groupId), { type: 'json' }) as { data: GroupRecord; etag?: string } | null
  if (stored?.data && groupIsSafe(stored.data.group) && stored.data.group.id === groupId && stored.data.group.kind === baseGroup.kind &&
      Array.isArray(stored.data.audit) && stored.data.audit.every(auditItemIsSafe)) {
    return { record: stored.data, etag: stored.etag }
  }
  const updatedAt = base.updatedAt || base.createdAt || new Date(0).toISOString()
  return {
    record: { group: { ...baseGroup, revision: baseGroup.revision ?? 0 }, audit: base.audit.filter(item => item.groupId === groupId), updatedAt } satisfies GroupRecord,
    etag: undefined,
  }
}

async function hydrateEvent(base: EventData): Promise<EventData> {
  const prefix = `group/${base.id}/`
  const listed = await store.list({ prefix })
  const records = await Promise.all(listed.blobs.map(blob => store.get(blob.key, { type: 'json' }) as Promise<GroupRecord | null>))
  let hydrated = base
  const audits: AuditItem[][] = [base.audit]
  let updatedAt = base.updatedAt
  for (const record of records) {
    if (!record?.group || !groupIsSafe(record.group) || !findGroup(base, record.group.id)) continue
    hydrated = replaceGroup(hydrated, record.group)
    if (Array.isArray(record.audit) && record.audit.every(auditItemIsSafe)) audits.push(record.audit)
    if (typeof record.updatedAt === 'string' && record.updatedAt > updatedAt) updatedAt = record.updatedAt
  }
  return { ...hydrated, audit: mergeAudits(...audits), updatedAt }
}

async function authorized(id: string, key: string | null) {
  if (!key) return false
  const auth = await store.get(`auth/${id}`, { type: 'json' }) as { keyHash?: string } | null
  return Boolean(auth?.keyHash && auth.keyHash === await digest(key))
}

function publicEvent(event: EventData): EventData {
  return { ...event, payments: {}, audit: [] }
}

export default async (req: Request, context: Context) => {
  try {
    const id = context.params.id
    const groupId = context.params.groupId
    if (req.method === 'POST' && !id) {
      const raw = await req.text()
      if (raw.length > EVENT_LIMIT) return json({ error: 'Event is too large.' }, 413)
      const body = JSON.parse(raw) as { event?: EventData }
      if (!body.event || !eventIsSafe(body.event)) return json({ error: 'Invalid event data.' }, 400)
      const eventId = randomToken(9)
      const ownerKey = randomToken(24)
      const now = new Date().toISOString()
      const addRevisions = (classes: RaceClass[]) => classes.map(cls => ({ ...cls, groups: cls.groups.map(group => ({ ...group, revision: group.revision ?? 0 })) }))
      const event = {
        ...body.event,
        id: eventId,
        version: 1,
        mainClasses: addRevisions(body.event.mainClasses),
        finalsClasses: addRevisions(body.event.finalsClasses),
        reraces: body.event.reraces.map(group => ({ ...group, revision: group.revision ?? 0 })),
        createdAt: now,
        updatedAt: now,
      }
      await Promise.all([
        store.setJSON(`event/${eventId}`, event),
        store.setJSON(`auth/${eventId}`, { keyHash: await digest(ownerKey), createdAt: now }),
      ])
      return json({ event, ownerKey }, 201)
    }

    if (!id || !/^[A-Za-z0-9_-]{8,32}$/.test(id)) return json({ error: 'Event not found.' }, 404)
    const baseBlob = await store.getWithMetadata(`event/${id}`, { type: 'json' }) as { data: EventData; etag?: string } | null
    const base = baseBlob?.data
    if (!base) return json({ error: 'Event not found.' }, 404)
    const owner = await authorized(id, req.headers.get('x-event-key'))

    if (req.method === 'GET' && !groupId) {
      const event = await hydrateEvent(base)
      return json({ event: owner ? event : publicEvent(event), role: owner ? 'owner' : 'viewer' })
    }
    if (!owner) return json({ error: 'This event requires its admin link.' }, 401)

    if (req.method === 'PUT' && groupId) {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(groupId)) return json({ error: 'Bracket not found.' }, 404)
      const raw = await req.text()
      if (raw.length > GROUP_LIMIT) return json({ error: 'Bracket is too large.' }, 413)
      const body = JSON.parse(raw) as { group?: RaceGroup; audit?: AuditItem[]; expectedRevision?: number }
      const current = await groupSnapshot(base, groupId)
      if (!current) return json({ error: 'Bracket not found.' }, 404)
      const revision = current.record.group.revision ?? 0
      if (body.expectedRevision !== revision) return json({ error: 'This bracket changed in another tab.', group: current.record.group, audit: current.record.audit }, 409)
      if (!body.group || body.group.id !== groupId || body.group.kind !== current.record.group.kind || !groupIsSafe(body.group) ||
          !Array.isArray(body.audit) || body.audit.length > 250 || !body.audit.every(item => auditItemIsSafe(item) && item.groupId === groupId)) {
        return json({ error: 'Invalid bracket data.' }, 400)
      }
      const now = new Date().toISOString()
      const record: GroupRecord = { group: { ...body.group, revision: revision + 1 }, audit: body.audit, updatedAt: now }
      const options = current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true }
      const result = await store.setJSON(groupKey(id, groupId), record, options)
      if (!result.modified) {
        const latest = await groupSnapshot(base, groupId)
        return json({ error: 'This bracket changed in another tab.', group: latest?.record.group ?? current.record.group, audit: latest?.record.audit ?? current.record.audit }, 409)
      }
      return json({ group: record.group, audit: record.audit, updatedAt: now })
    }

    if (req.method === 'PUT' && !groupId) {
      const raw = await req.text()
      if (raw.length > EVENT_LIMIT) return json({ error: 'Event is too large.' }, 413)
      const body = JSON.parse(raw) as { event?: EventData; expectedVersion?: number }
      if (body.expectedVersion !== base.version) return json({ error: 'This event changed on another device.', event: await hydrateEvent(base) }, 409)
      if (!body.event || body.event.id !== id || !eventIsSafe(body.event)) return json({ error: 'Invalid event data.' }, 400)
      const now = new Date().toISOString()
      const saved: EventData = {
        ...base,
        name: body.event.name,
        date: body.event.date,
        venue: body.event.venue,
        entryFee: body.event.entryFee,
        status: body.event.status,
        payments: body.event.payments,
        audit: body.event.audit,
        version: base.version + 1,
        createdAt: base.createdAt,
        updatedAt: now,
      }
      if (!baseBlob.etag) return json({ error: 'The event could not be safely updated.' }, 503)
      const result = await store.setJSON(`event/${id}`, saved, { onlyIfMatch: baseBlob.etag })
      if (!result.modified) {
        const latest = await store.get(`event/${id}`, { type: 'json' }) as EventData
        return json({ error: 'This event changed on another device.', event: await hydrateEvent(latest) }, 409)
      }
      return json({ event: await hydrateEvent(saved) })
    }
    return json({ error: 'Method not allowed.' }, 405)
  } catch (error) {
    console.error(error)
    return json({ error: 'The event service could not complete this request.' }, 500)
  }
}

export const config: Config = { path: ['/api/events', '/api/events/:id', '/api/events/:id/groups/:groupId'] }
