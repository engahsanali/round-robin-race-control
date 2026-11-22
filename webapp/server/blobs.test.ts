import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getStore } from './blobs'

let dir = ''
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'rr-blobs-')); process.env.RR_DATA_DIR = dir })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('file blob store', () => {
  it('round-trips JSON with metadata and lists by prefix', async () => {
    const store = getStore({ name: 'test-store' })
    expect((await store.setJSON('workspaces/u1/event/abc', { a: 1 }, { onlyIfNew: true, metadata: { id: 'abc' } })).modified).toBe(true)
    await store.set('workspaces/u1/group/abc/g.1', JSON.stringify({ g: 1 }))
    await store.set('other/x', 'y')
    expect(await store.get('workspaces/u1/event/abc', { type: 'json' })).toEqual({ a: 1 })
    expect((await store.getMetadata('workspaces/u1/event/abc'))?.metadata).toEqual({ id: 'abc' })
    expect((await store.list({ prefix: 'workspaces/u1/' })).blobs.map(blob => blob.key)).toEqual(['workspaces/u1/event/abc', 'workspaces/u1/group/abc/g.1'])
    expect(await store.get('missing/key')).toBeNull()
  })

  it('rejects stale and duplicate conditional writes atomically', async () => {
    const store = getStore('test-store')
    const first = await store.setJSON('group/e/g', { revision: 0 }, { onlyIfNew: true })
    expect((await store.setJSON('group/e/g', { revision: 9 }, { onlyIfNew: true })).modified).toBe(false)
    const results = await Promise.all([1, 2, 3, 4].map(revision => store.setJSON('group/e/g', { revision }, { onlyIfMatch: first.etag })))
    expect(results.filter(result => result.modified)).toHaveLength(1)
    const saved = await store.getWithMetadata('group/e/g', { type: 'json' })
    expect(saved?.etag).toBe(results.find(result => result.modified)?.etag)
  })
})
