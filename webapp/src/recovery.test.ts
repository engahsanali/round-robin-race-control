import { afterEach, expect, it, vi } from 'vitest'
import { createEvent } from './domain'
import { createRecovery } from './recovery'

afterEach(() => vi.unstubAllGlobals())

it('stores pending private edits encrypted and requires the same account key for recovery', async () => {
  const storage: Record<string, unknown> = {
    setItem(key: string, value: string) { storage[key] = value },
    getItem(key: string) { return storage[key] ?? null },
    removeItem(key: string) { delete storage[key] },
  }
  vi.stubGlobal('localStorage', storage)
  const key = Buffer.alloc(32, 42).toString('base64url')
  const draft = { id: 'fixture-draft', event: createEvent('Private fixture event', '2026-11-20', ''), scopes: ['$event'] }
  draft.event.id = 'fixture-event'
  expect(await createRecovery('alice', key).save(draft)).toBe(true)
  expect(JSON.stringify(storage)).not.toContain(draft.event.name)
  expect(await createRecovery('bob', key).list()).toEqual([])
  expect(await createRecovery('alice', Buffer.alloc(32, 9).toString('base64url')).list()).toEqual([])
  expect((await createRecovery('alice', key).list()).map(item => item.event.name)).toEqual([draft.event.name])
})
