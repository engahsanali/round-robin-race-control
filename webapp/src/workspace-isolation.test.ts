import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { createEvent } from './domain'
import events from '../netlify/functions/events'

const state = { session: null as { id: string; email: string; confirmed_at: string } | null }
vi.mock('@netlify/blobs', () => ({
  getStore() {
    const blobs = new Map<string, { data: unknown; etag: string; metadata?: unknown }>()
    return {
      get: async (key: string) => structuredClone(blobs.get(key)?.data ?? null),
      getWithMetadata: async (key: string) => structuredClone(blobs.get(key) ?? null),
      getMetadata: async (key: string) => blobs.get(key) ?? null,
      list: async ({ prefix }: { prefix: string }) => ({ blobs: [...blobs.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }),
      setJSON: async (key: string, data: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string; metadata?: unknown }) => {
        const existing = blobs.get(key)
        if ((options?.onlyIfNew && existing) || (options?.onlyIfMatch && existing?.etag !== options.onlyIfMatch)) return { modified: false }
        blobs.set(key, { data: structuredClone(data), etag: crypto.randomUUID(), metadata: options?.metadata })
        return { modified: true }
      },
    }
  },
}))

const origin = 'https://race.example'
const alice = { id: '10000000-0000-4000-8000-000000000001', email: 'alice@example.test', confirmed_at: '2026-01-01' }
const bob = { id: '10000000-0000-4000-8000-000000000002', email: 'bob@example.test', confirmed_at: '2026-01-01' }
afterEach(() => vi.unstubAllGlobals())

function run(method: string, path: string, params: Record<string, string> = {}, body?: unknown) {
  const request = new Request(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
  return events(request, { params, cookies: { get: () => state.session?.id }, site: { url: origin } } as unknown as Context)
}

it('keeps events, writes and history private, and revokes projected spectator access', async () => {
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    expect(url.href).toBe(origin + '/.netlify/identity/user')
    expect(init.headers).toEqual({ Authorization: 'Bearer ' + state.session?.id })
    return Response.json(state.session)
  })
  state.session = { ...alice, confirmed_at: '' }
  expect((await run('GET', '/api/history')).status).toBe(401)
  state.session = alice
  const draft = createEvent('Private fixture event', '2026-11-20', 'Test venue')
  draft.payments.fixture = { nameKey: 'fixture', displayName: 'Fixture', paid: 15, prize: 5 }
  const created = await run('POST', '/api/events', {}, { event: draft })
  expect(created.status).toBe(201)
  const { event } = await created.json()
  const id = event.id
  const path = '/api/events/' + id
  const group = event.mainClasses[0].groups[0]
  expect((await run('GET', path, { id })).status).toBe(200)

  state.session = bob
  expect((await run('GET', path, { id })).status).toBe(404)
  expect((await run('PUT', path, { id }, { event, expectedVersion: 1 })).status).toBe(404)
  expect((await run('PUT', path + '/groups/' + group.id, { id, groupId: group.id }, { group, expectedRevision: 0, audit: [] })).status).toBe(404)
  expect((await run('GET', path + '/podiums', { id })).status).toBe(404)
  expect((await (await run('GET', '/api/history')).json()).history).toEqual([])

  state.session = alice
  const published = await run('PUT', path + '/publication', { id }, { published: true })
  expect(published.status).toBe(200)
  const { code } = await published.json()
  state.session = null
  expect((await run('GET', path, { id })).status).toBe(401)
  const publicEvent = await run('GET', '/api/watch/' + code, { code })
  expect(publicEvent.status).toBe(200)
  expect((await publicEvent.json()).event).toMatchObject({ payments: {}, audit: [], entryFee: 0 })
  state.session = alice
  expect((await run('PUT', path + '/publication', { id }, { published: false })).status).toBe(200)
  state.session = null
  expect((await run('GET', '/api/watch/' + code, { code })).status).toBe(404)
})
