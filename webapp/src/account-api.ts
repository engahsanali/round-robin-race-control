export interface AccountProfile {
  id: string
  email: string
  name: string
  nickname: string
  timezone: string
  entryFee: number
  points?: { first: number; second: number; third: number }
}

export interface AccountEventSummary {
  id: string
  name: string
  date: string
  venue: string
  status: 'draft' | 'live' | 'complete'
  updatedAt: string
}

export interface AccountSnapshot {
  account: AccountProfile | null
  events: AccountEventSummary[]
}

export interface AccountResponse {
  account?: AccountProfile | null
  eventId?: string
  message?: string
}

export type AccountAction =
  | { action: 'signup'; email: string; password: string; name: string; nickname: string }
  | { action: 'login'; email: string; password: string }
  | { action: 'forgot'; email: string }
  | { action: 'verify'; tokenHash: string }
  | { action: 'reset'; password: string; tokenHash: string }
  | { action: 'signout' }
  | { action: 'profile'; name: string; nickname: string; timezone: string; entryFee: number; points?: AccountProfile['points'] }
  | { action: 'claim'; link: string }

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'The account service could not complete this request.')
  }
  if (!data || typeof data !== 'object') throw new Error('The account service returned an invalid response.')
  return data
}

export async function getAccount(): Promise<AccountSnapshot> {
  const response = await fetch('/api/account', { credentials: 'same-origin', cache: 'no-store' })
  const data = await readResponse(response)
  if (!Array.isArray(data.events)) throw new Error('The event list could not be loaded.')
  return data as AccountSnapshot
}

export async function accountRequest(action: AccountAction): Promise<AccountResponse> {
  const response = await fetch('/api/account', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  })
  return readResponse(response)
}

export function filterAccountEvents(
  events: AccountEventSummary[], query: string, status: string, from: string, to: string,
): AccountEventSummary[] {
  const search = query.trim().toLocaleLowerCase()
  return events.filter(event => {
    const matchesText = !search || (event.name + ' ' + event.venue).toLocaleLowerCase().includes(search)
    return matchesText && (status === 'all' || event.status === status) &&
      (!from || event.date >= from) && (!to || event.date <= to)
  })
}
