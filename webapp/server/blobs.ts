// File-system replacement for the subset of @netlify/blobs used by the
// Netlify functions. One Node process owns the data directory, so a per-key
// promise chain makes onlyIfNew / onlyIfMatch writes atomic.
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

type Metadata = Record<string, unknown>
type GetType = 'json' | 'text'
interface SetOptions { onlyIfMatch?: string; onlyIfNew?: boolean; metadata?: Metadata }
interface Entry { data: string; etag: string; metadata: Metadata }

const root = () => process.env.RR_DATA_DIR || '/data'
const locks = new Map<string, Promise<unknown>>()

function segments(key: string) {
  if (typeof key !== 'string' || !key || key.length > 600) throw new Error('Invalid blob key')
  return key.split('/').map(part => {
    if (!part) throw new Error('Invalid blob key')
    return encodeURIComponent(part).replace(/\./g, '%2E')
  })
}

const etagOf = (data: string) => '"' + createHash('sha256').update(data).digest('hex').slice(0, 32) + '"'

async function withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve()
  const next = previous.then(task, task)
  const settled = next.catch(() => undefined)
  locks.set(id, settled)
  try { return await next } finally { if (locks.get(id) === settled) locks.delete(id) }
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.' + randomBytes(6).toString('hex') + '.tmp'
  await writeFile(temp, content, { mode: 0o600 })
  await rename(temp, path)
}

export class Store {
  constructor(private readonly name: string) {}
  private dataPath(key: string) { return join(root(), this.name, 'blobs', ...segments(key)) }
  private metaPath(key: string) { return join(root(), this.name, 'meta', ...segments(key)) + '.json' }

  private async read(key: string): Promise<Entry | null> {
    let data: string
    try { data = await readFile(this.dataPath(key), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'EISDIR') return null
      throw error
    }
    let metadata: Metadata = {}
    try { metadata = JSON.parse(await readFile(this.metaPath(key), 'utf8')) } catch { /* no metadata */ }
    return { data, etag: etagOf(data), metadata }
  }

  private decode(data: string, type?: GetType) {
    return type === 'json' ? JSON.parse(data) : data
  }

  async get(key: string, options: { type?: GetType } = {}) {
    const entry = await this.read(key)
    return entry ? this.decode(entry.data, options.type) : null
  }

  async getWithMetadata(key: string, options: { type?: GetType } = {}) {
    const entry = await this.read(key)
    return entry ? { data: this.decode(entry.data, options.type), etag: entry.etag, metadata: entry.metadata } : null
  }

  async getMetadata(key: string) {
    const entry = await this.read(key)
    return entry ? { etag: entry.etag, metadata: entry.metadata } : null
  }

  async set(key: string, value: string, options: SetOptions = {}) {
    if (typeof value !== 'string') throw new TypeError('Blob value must be a string')
    return withLock(this.name + '\u0000' + key, async () => {
      const current = await this.read(key)
      if (options.onlyIfNew && current) return { modified: false, etag: current.etag }
      if (options.onlyIfMatch !== undefined && current?.etag !== options.onlyIfMatch) return { modified: false, etag: current?.etag }
      if (options.metadata) await atomicWrite(this.metaPath(key), JSON.stringify(options.metadata))
      await atomicWrite(this.dataPath(key), value)
      return { modified: true, etag: etagOf(value) }
    })
  }

  async setJSON(key: string, value: unknown, options: SetOptions = {}) {
    return this.set(key, JSON.stringify(value), options)
  }

  async list(options: { prefix?: string } = {}) {
    const base = join(root(), this.name, 'blobs')
    const blobs: { key: string; etag: string }[] = []
    const walk = async (dir: string): Promise<void> => {
      let items
      try { items = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const item of items) {
        const full = join(dir, item.name)
        if (item.isDirectory()) { await walk(full); continue }
        if (!item.isFile() || item.name.endsWith('.tmp')) continue
        const key = relative(base, full).split(sep).map(decodeURIComponent).join('/')
        if (options.prefix && !key.startsWith(options.prefix)) continue
        blobs.push({ key, etag: etagOf(await readFile(full, 'utf8')) })
      }
    }
    await walk(base)
    blobs.sort((a, b) => a.key.localeCompare(b.key))
    return { blobs, directories: [] as string[] }
  }
}

const stores = new Map<string, Store>()
export function getStore(input: string | { name: string }) {
  const name = typeof input === 'string' ? input : input.name
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('Invalid store name')
  let store = stores.get(name)
  if (!store) stores.set(name, store = new Store(name))
  return store
}
