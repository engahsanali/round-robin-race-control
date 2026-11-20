import { expect, it } from 'vitest'
import { acceptsPassword, isSameOriginWrite } from '../netlify/functions/lib/account-security'

it('accepts simple passphrases and rejects short and very common passwords', () => {
  expect(acceptsPassword('calm trains move slowly')).toBe(true)
  expect(acceptsPassword('short easy')).toBe(false)
  expect(acceptsPassword('passwordpassword')).toBe(false)
  expect(acceptsPassword('a'.repeat(73))).toBe(false)
})

it('restricts browser writes to the origin that served the app', () => {
  const url = 'https://race.example/api/account'
  expect(isSameOriginWrite(new Request(url, { method: 'POST', headers: { Origin: 'https://race.example' } }))).toBe(true)
  expect(isSameOriginWrite(new Request(url, { method: 'POST', headers: { Origin: 'https://other.example' } }))).toBe(false)
  expect(isSameOriginWrite(new Request(url, { method: 'POST' }))).toBe(false)
})
