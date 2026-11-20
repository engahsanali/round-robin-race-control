import type { EventData } from './types'

export interface LocalDraft {
  id: string
  event: EventData
  scopes: string[]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytes(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}

function base64(value: Uint8Array) {
  let raw = ''
  for (let index = 0; index < value.length; index += 8192) raw += String.fromCharCode(...value.subarray(index, index + 8192))
  return btoa(raw)
}

export function createRecovery(userId: string, key: string) {
  const prefix = `rr-private-v2:${userId}:`
  const cipher = crypto.subtle.importKey('raw', bytes(key), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const pending = new Map<string, symbol>()

  async function save(draft: LocalDraft) {
    const path = prefix + draft.id
    const version = Symbol()
    if (draft.scopes.length) pending.set(path, version)
    else pending.delete(path)
    try {
      if (!draft.scopes.length) { localStorage.removeItem(path); return true }
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(path) }, await cipher, encoder.encode(JSON.stringify(draft)),
      )
      if (pending.get(path) === version) {
        localStorage.setItem(path, base64(iv) + '.' + base64(new Uint8Array(ciphertext)))
        pending.delete(path)
      }
      return true
    } catch { return false }
  }

  async function list() {
    try {
      const paths = Object.keys(localStorage).filter(path => path.startsWith(prefix))
      const drafts = await Promise.all(paths.map(async path => {
        try {
          const [iv, ciphertext] = (localStorage.getItem(path) ?? '').split('.')
          const result = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(path) }, await cipher, bytes(ciphertext),
          )
          return JSON.parse(decoder.decode(result)) as LocalDraft
        } catch { return null }
      }))
      return drafts.filter((draft): draft is LocalDraft => Boolean(draft?.event?.id && draft.scopes?.length))
        .sort((a, b) => b.event.updatedAt.localeCompare(a.event.updatedAt))
    } catch { return [] }
  }
  return { save, list }
}
