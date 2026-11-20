import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AccountHome from './AccountHome'

afterEach(() => vi.unstubAllGlobals())

const props = {
  account: null, events: [], onRefresh: async () => {}, onOpen: () => {},
  onCreate: async () => {}, onSignOut: async () => {},
}

it('shows a deliberate verification button while keeping the email token out of the markup', () => {
  vi.stubGlobal('location', { search: '?verify=1', hash: '#token_hash=private-token' })
  const html = renderToStaticMarkup(<AccountHome {...props} />)
  expect(html).toContain('Verify your email')
  expect(html).toContain('Verify email')
  expect(html).not.toContain('private-token')
  expect(html).not.toContain('name="password"')
})

it('offers password reset without collecting the account email again', () => {
  vi.stubGlobal('location', { search: '?recover=1', hash: '#token_hash=private-token' })
  const html = renderToStaticMarkup(<AccountHome {...props} />)
  expect(html).toContain('Save new password')
  expect(html).toContain('autoComplete="new-password"')
  expect(html).not.toContain('private-token')
  expect(html).not.toContain('name="email"')
})
