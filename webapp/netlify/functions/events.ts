import { getStore } from '@netlify/blobs'
import type { Store } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { addMissingClasses, CLASS_COUNT, LEGACY_CLASS_COUNT } from '../../src/race-layout'
import type { AuditItem, EventData, GroupRecord, RaceClass, RaceGroup } from '../../src/types'
import { buildPodium } from '../../src/results'
import type { ConfirmedPodium } from '../../src/results'
import { accounts as store, profileFor, readSession, workspace } from './lib/account-store'
import type { Session } from './lib/account-store'
import { isSameOriginWrite, json, matchesDigest, requestBody, token, validId } from './lib/account-security'

const legacyStore = getStore({ name: 'round-robin-events', consistency: 'strong' })
const EVENT_LIMIT = 1_500_000
const GROUP_LIMIT = 500_000

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
  if (group.entrants.some(e => !e || typeof e.id !== 'string' || typeof e.name !== 'string' || e.name.length > 100 || typeof e.carNumber !== 'string' || e.carNumber.length > 12 ||
    (e.competitorId !== undefined && !/^[a-z0-9_-]{1,60}$/.test(e.competitorId)))) return false
  return group.heats.every(heat => {
    if (!heat || typeof heat.id !== 'string' || !Number.isInteger(heat.round) || !Number.isInteger(heat.heat) || !Array.isArray(heat.lanes) || heat.lanes.length !== 3) return false
    if (heat.winnerId && !heat.lanes.includes(heat.winnerId)) return false
    return heat.lanes.every(id => id === null || group.entrants.some(entry => entry.id === id))
  })
}

function eventIsSafe(event: EventData) {
  if (!event || typeof event !== 'object' || typeof event.name !== 'string' || event.name.length > 120 || typeof event.venue !== 'string' || event.venue.length > 160) return false
  if (typeof event.date !== 'string' || event.date.length > 20 || !Number.isFinite(event.entryFee) || event.entryFee < 0 || event.entryFee > 1000) return false
  if (!['draft', 'live', 'complete'].includes(event.status) || !Array.isArray(event.mainClasses) || !Array.isArray(event.finalsClasses) || event.mainClasses.length !== event.finalsClasses.length ||
      ![LEGACY_CLASS_COUNT, CLASS_COUNT].includes(event.mainClasses.length) || !Array.isArray(event.reraces) || event.reraces.length !== 6) return false
  const classes = [...event.mainClasses, ...event.finalsClasses]
  if (classes.some(c => !c || typeof c.name !== 'string' || c.name.length > 80 || !Array.isArray(c.groups) || c.groups.length !== 6)) return false
  if (![...classes.flatMap(c => c.groups), ...event.reraces].every(groupIsSafe)) return false
  if (!event.payments || typeof event.payments !== 'object' || Array.isArray(event.payments) || !Array.isArray(event.audit) || event.audit.length > 250 || !event.audit.every(auditItemIsSafe)) return false
  if (Object.values(event.payments).some(payment => payment?.prize !== undefined && (!Number.isFinite(payment.prize) || payment.prize < 0))) return false
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

async function groupSnapshot(base: EventData, groupId: string, scope: string) {
  const baseGroup = findGroup(base, groupId)
  if (!baseGroup) return null
  const stored = await store.getWithMetadata(scope + groupKey(base.id, groupId), { type: 'json' }) as { data: GroupRecord; etag?: string } | null
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

async function hydrateEvent(base: EventData, storage: Store, scope = ''): Promise<EventData> {
  base = addMissingClasses(base)
  const prefix = scope + `group/${base.id}/`
  const listed = await storage.list({ prefix })
  const records = await Promise.all(listed.blobs.map(blob => storage.get(blob.key, { type: 'json' }) as Promise<GroupRecord | null>))
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

function summary(event: EventData) {
  const { id, name, date, venue, status, updatedAt } = event
  return { id, name, date, venue, status, updatedAt }
}

export async function listWorkspaceEvents(userId: string) {
  const { blobs } = await store.list({ prefix: workspace(userId) + 'event/' })
  const summaries = []
  for (let index = 0; index < blobs.length; index += 12) {
    const batch = await Promise.all(blobs.slice(index, index + 12).map(blob => store.getMetadata(blob.key)))
    summaries.push(...batch.map(item => item?.metadata as ReturnType<typeof summary> | undefined).filter(item => item?.id))
  }
  return summaries.sort((a, b) => (b?.date ?? '').localeCompare(a?.date ?? ''))
}

export async function claimLegacyEvent(userId: string, link: string, hostname: string) {
  let url: URL
  try { url = new URL(link) } catch { return null }
  // RR_LEGACY_LINK_HOSTS lets a self-hosted copy accept admin links created on the old Netlify host.
  const hosts = [hostname, ...(process.env.RR_LEGACY_LINK_HOSTS ?? '').split(',').map(item => item.trim()).filter(Boolean)]
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) return null
  const id = url.searchParams.get('event')
  const key = new URLSearchParams(url.hash.slice(1)).get('key')
  if (!validId(id) || !key || !/^[A-Za-z0-9_-]{24,80}$/.test(key)) return null
  const auth = await legacyStore.get('auth/' + id, { type: 'json' }) as { keyHash: string } | null
  if (!auth || !matchesDigest(key, auth.keyHash)) return null
  const base = await legacyStore.get('event/' + id, { type: 'json' }) as EventData | null
  if (!base) return null
  const event = await hydrateEvent(base, legacyStore)
  const claimKey = 'claims/' + id
  const claim = await store.setJSON(claimKey, { userId }, { onlyIfNew: true })
  if (!claim.modified && (await store.get(claimKey, { type: 'json' }) as { userId: string } | null)?.userId !== userId) return null
  await store.setJSON(workspace(userId) + 'event/' + id, event, { onlyIfNew: true, metadata: summary(event) })
  return id
}

type Publication = { code: string | null }
const shareKey = (scope: string, id: string) => scope + 'publication/' + id
const resultsKey = (scope: string, id: string) => scope + 'podiums/' + id

function spectatorEvent(event: EventData): EventData {
  const groups = (items: RaceGroup[]): RaceGroup[] => items.filter(group => group.heats.length).map(group => ({
    id: group.id, label: group.label, kind: group.kind, drawSeed: 0,
    entrants: group.entrants.filter(entry => group.heats.some(heat => heat.lanes.includes(entry.id)))
      .map(({ id, name, carNumber }) => ({ id, name, carNumber })),
    heats: group.heats.map(({ id, round, heat, lanes, winnerId }) => ({ id, round, heat, lanes, winnerId })),
  }))
  const classes = (items: RaceClass[]) => items.map(({ id, name, groups: items }) => ({ id, name, groups: groups(items) }))
  return {
    id: event.id, name: event.name, date: event.date, venue: event.venue, status: event.status,
    mainClasses: classes(event.mainClasses), finalsClasses: classes(event.finalsClasses), reraces: groups(event.reraces),
    payments: {}, audit: [], entryFee: 0, version: 0, createdAt: '', updatedAt: '',
  }
}

async function readSpectator(code: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return json({ error: 'Display not found.' }, 404)
  const published = await store.get('shares/' + code, { type: 'json' }) as { userId: string; id: string } | null
  if (!published) return json({ error: 'Display not found.' }, 404)
  const scope = workspace(published.userId)
  const active = await store.get(shareKey(scope, published.id), { type: 'json' }) as Publication | null
  if (active?.code !== code) return json({ error: 'Display not found.' }, 404)
  const base = await store.get(scope + 'event/' + published.id, { type: 'json' }) as EventData | null
  return base ? json({ event: spectatorEvent(await hydrateEvent(base, store, scope)), role: 'viewer' }) : json({ error: 'Display not found.' }, 404)
}

const classIdPattern = /^[A-Za-z0-9_-]{4,110}$/

async function managePodiums(req: Request, session: Session, scope: string, event: EventData) {
  const key = resultsKey(scope, event.id)
  const current = await store.getWithMetadata(key, { type: 'json' }) as { data: ConfirmedPodium[]; etag?: string } | null
  const podiums = current?.data ?? []
  if (req.method === 'GET') return json({ podiums })
  if (req.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405)
  const input = await requestBody(req, 8192)
  if (!input || !classIdPattern.test(typeof input.classId === 'string' ? input.classId : '') ||
      typeof input.sourceGroupId !== 'string' || !Array.isArray(input.finishers) || input.finishers.length > 3 ||
      !input.finishers.every((item: { entrantId?: unknown }) => typeof item?.entrantId === 'string')) return json({ error: 'Invalid podium.' }, 400)
  const previous = podiums.filter(result => result.classId === input.classId).at(-1)
  const revision = (previous?.revision ?? 0) + 1
  if (revision !== input.revision) return json({ error: 'This podium changed elsewhere. Reload before confirming.' }, 409)
  const hydrated = await hydrateEvent(event, store, scope)
  const profile = await profileFor(session)
  let confirmed
  try {
    confirmed = buildPodium(hydrated, input.classId, input.sourceGroupId, input.finishers.map((item: { entrantId: string }) => item.entrantId), {
      revision, confirmedAt: new Date().toISOString(), pointRules: previous ? previous.pointRules : profile.points,
      reason: typeof input.reason === 'string' ? input.reason : undefined,
      reraceGroupId: typeof input.reraceGroupId === 'string' ? input.reraceGroupId : undefined,
    })
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid podium.' }, 400) }
  if (confirmed.sourceRevision !== input.sourceRevision || confirmed.reraceRevision !== input.reraceRevision) {
    return json({ error: 'The source results changed. Reload before confirming.' }, 409)
  }
  const next = [...podiums, confirmed]
  const saved = await store.setJSON(key, next, current?.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true })
  return saved.modified ? json({ podiums: next }) : json({ error: 'Results changed elsewhere. Reload before confirming.' }, 409)
}

async function managePublication(req: Request, session: Session, scope: string, id: string) {
  const key = shareKey(scope, id)
  const previous = await store.getWithMetadata(key, { type: 'json' }) as { data: Publication; etag?: string } | null
  if (req.method === 'GET') return json({ code: previous?.data.code ?? null })
  if (req.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405)
  const body = await requestBody(req, 1024)
  if (typeof body?.published !== 'boolean') return json({ error: 'Invalid display setting.' }, 400)
  if (body.published && previous?.data.code) return json(previous.data)
  const code = body.published ? token() : null
  if (code) await store.setJSON('shares/' + code, { userId: session.id, id }, { onlyIfNew: true })
  const updated = await store.setJSON(key, { code }, previous?.etag ? { onlyIfMatch: previous.etag } : { onlyIfNew: true })
  return updated.modified ? json({ code }) : json({ error: 'Display settings changed elsewhere.' }, 409)
}

export default async (req: Request, context: Context) => {
  try {
    const id = context.params.id
    const endpoint = new URL(req.url).pathname
    const watch = context.params.code
    if (watch) return req.method === 'GET' ? await readSpectator(watch) : json({ error: 'Method not allowed.' }, 405)
    const session = await readSession(context)
    if (!session) return json({ error: 'Sign in to continue.' }, 401)
    if (req.method !== 'GET' && !isSameOriginWrite(req)) return json({ error: 'Invalid request origin.' }, 403)
    const scope = workspace(session.id)
    if (endpoint === '/api/history' && req.method === 'GET') {
      const summaries = await listWorkspaceEvents(session.id)
      const history = []
      for (let index = 0; index < summaries.length; index += 12) {
        const batch = await Promise.all(summaries.slice(index, index + 12).map(async event => ({
          event,
          podiums: event ? (await store.get(resultsKey(scope, event.id), { type: 'json' }) as ConfirmedPodium[] | null) ?? [] : [],
        })))
        history.push(...batch)
      }
      return json({ history })
    }
    const groupId = context.params.groupId
    if (req.method === 'POST' && !id) {
      const body = await requestBody(req, EVENT_LIMIT) as { event?: EventData }
      if (!body.event || !eventIsSafe(body.event)) return json({ error: 'Invalid event data.' }, 400)
      const eventId = token(12)
      const now = new Date().toISOString()
      const addRevisions = (classes: RaceClass[]) => classes.map(cls => ({ ...cls, groups: cls.groups.map(group => ({ ...group, revision: group.revision ?? 0 })) }))
      const draft = addMissingClasses({ ...body.event, id: eventId })
      const event = {
        ...draft,
        version: 1,
        mainClasses: addRevisions(draft.mainClasses),
        finalsClasses: addRevisions(draft.finalsClasses),
        reraces: draft.reraces.map(group => ({ ...group, revision: group.revision ?? 0 })),
        createdAt: now,
        updatedAt: now,
      }
      await store.setJSON(scope + 'event/' + eventId, event, { onlyIfNew: true, metadata: summary(event) })
      return json({ event }, 201)
    }

    if (!validId(id)) return json({ error: 'Event not found.' }, 404)
    const baseBlob = await store.getWithMetadata(scope + `event/${id}`, { type: 'json' }) as { data: EventData; etag?: string } | null
    const base = baseBlob?.data
    if (!base) return json({ error: 'Event not found.' }, 404)
    if (endpoint.endsWith('/podiums')) return await managePodiums(req, session, scope, base)
    if (endpoint.endsWith('/publication')) return await managePublication(req, session, scope, id)
    if (req.method === 'GET' && !groupId) return json({ event: await hydrateEvent(base, store, scope), role: 'owner' })

    if (req.method === 'PUT' && groupId) {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(groupId)) return json({ error: 'Bracket not found.' }, 404)
      const body = await requestBody(req, GROUP_LIMIT) as { group?: RaceGroup; audit?: AuditItem[]; expectedRevision?: number }
      const bracketBase = addMissingClasses(base)
      const current = await groupSnapshot(bracketBase, groupId, scope)
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
      const result = await store.setJSON(scope + groupKey(id, groupId), record, options)
      if (!result.modified) {
        const latest = await groupSnapshot(bracketBase, groupId, scope)
        return json({ error: 'This bracket changed in another tab.', group: latest?.record.group ?? current.record.group, audit: latest?.record.audit ?? current.record.audit }, 409)
      }
      return json({ group: record.group, audit: record.audit, updatedAt: now })
    }

    if (req.method === 'PUT' && !groupId) {
      const body = await requestBody(req, EVENT_LIMIT) as { event?: EventData; expectedVersion?: number }
      if (body.expectedVersion !== base.version) return json({ error: 'This event changed on another device.', event: await hydrateEvent(base, store, scope) }, 409)
      if (!body.event || body.event.id !== id || !eventIsSafe(body.event)) return json({ error: 'Invalid event data.' }, 400)
      // An older client can update cash paid without sending the prize field.
      const payments = Object.fromEntries(Object.entries(body.event.payments).map(([name, payment]) => {
        const prize = base.payments[name]?.prize
        return [name, payment && payment.prize === undefined && prize !== undefined ? { ...payment, prize } : payment]
      }))
      const now = new Date().toISOString()
      const saved: EventData = {
        ...base,
        name: body.event.name,
        date: body.event.date,
        venue: body.event.venue,
        entryFee: body.event.entryFee,
        status: body.event.status,
        payments,
        audit: body.event.audit,
        version: base.version + 1,
        createdAt: base.createdAt,
        updatedAt: now,
      }
      if (!baseBlob.etag) return json({ error: 'The event could not be safely updated.' }, 503)
      const result = await store.setJSON(scope + `event/${id}`, saved, { onlyIfMatch: baseBlob.etag, metadata: summary(saved) })
      if (!result.modified) {
        const latest = await store.get(scope + `event/${id}`, { type: 'json' }) as EventData
        return json({ error: 'This event changed on another device.', event: await hydrateEvent(latest, store, scope) }, 409)
      }
      return json({ event: await hydrateEvent(saved, store, scope) })
    }
    return json({ error: 'Method not allowed.' }, 405)
  } catch (error) {
    if (error instanceof RangeError) return json({ error: 'Request too large.' }, 413)
    if (error instanceof SyntaxError) return json({ error: 'Invalid request.' }, 400)
    return json({ error: 'The event service could not complete this request.' }, 500)
  }
}

export const config: Config = { path: ['/api/events','/api/events/:id','/api/events/:id/groups/:groupId','/api/events/:id/podiums','/api/events/:id/publication','/api/watch/:code','/api/history'] }
