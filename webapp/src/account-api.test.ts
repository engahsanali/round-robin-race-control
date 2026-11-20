import { describe, expect, it, vi, afterEach } from 'vitest'
import { accountRequest, filterAccountEvents } from './account-api'

afterEach(() => vi.unstubAllGlobals())

describe('private account API', () => {
  it('sends credentials and changes in a JSON request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Check your inbox' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await accountRequest({ action: 'forgot', email: 'organiser@example.test' })
    expect(fetchMock).toHaveBeenCalledWith('/api/account', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      body: JSON.stringify({ action: 'forgot', email: 'organiser@example.test' }),
    }))
  })

  it('keeps event history search and date filters scoped to the supplied list', () => {
    const events = [
      { id: 'one', name: 'Club final', date: '2026-10-31', venue: 'Track A', status: 'complete' as const, updatedAt: '' },
      { id: 'two', name: 'Club practice', date: '2026-11-20', venue: 'Track B', status: 'draft' as const, updatedAt: '' },
    ]
    expect(filterAccountEvents(events, 'track a', 'complete', '2026-10-01', '2026-10-31').map(event => event.id)).toEqual(['one'])
    expect(filterAccountEvents(events, '', 'all', '2026-11-01', '').map(event => event.id)).toEqual(['two'])
    expect(events).toHaveLength(2)
  })
})
