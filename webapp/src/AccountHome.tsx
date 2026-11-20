import { useEffect, useState } from 'react'
import { getSettings, oauthLogin } from '@netlify/identity'
import type { FormEvent } from 'react'
import { createEvent } from './domain'
import type { EventData } from './types'
import { accountRequest, filterAccountEvents } from './account-api'
import type { AccountEventSummary, AccountProfile, AccountAction } from './account-api'
import './account.css'

export interface AccountHomeProps {
  account: AccountProfile | null
  events: AccountEventSummary[]
  onRefresh: () => Promise<void>
  onOpen: (id: string) => void
  onCreate: (event: EventData) => Promise<void>
  onSignOut: () => Promise<void>
  forceAuth?: boolean
  onImportResults?: (file: File) => Promise<void>
}

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset' | 'verify'

function Credit() {
  return <footer className="account-credit">Free to use. Created by Ahsan Ali at <a href="https://ahsantechlabs.com/">AhsanTechLabs.com</a>.</footer>
}

export default function AccountHome(props: AccountHomeProps) {
  const { account } = props
  return <div className="account-shell">
    <header className="account-header"><span className="brand-mark">RR</span><strong>Race Manager</strong></header>
    {account && !props.forceAuth ? <OrganiserHome key={account.id} {...props} account={account} /> : <SignIn onRefresh={props.onRefresh} />}
    <Credit />
  </div>
}

function SignIn({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [mode, setMode] = useState<AuthMode>(() => {
    const query = new URLSearchParams(location.search)
    const hash = new URLSearchParams(location.hash.slice(1))
    if (query.get('verify') === '1' || hash.has('confirmation_token')) return 'verify'
    return query.get('recover') === '1' || hash.has('recovery_token') ? 'reset' : 'login'
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  useEffect(() => {
    let current = true
    void getSettings().then(settings => { if (current) setGoogleEnabled(Boolean(settings.providers.google)) }).catch(() => {})
    return () => { current = false }
  }, [])
  const titles = { login: 'Sign in', signup: 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password', verify: 'Verify your email' }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const hash = new URLSearchParams(location.hash.slice(1))
    const tokenHash = hash.get('token_hash') ?? hash.get(mode === 'reset' ? 'recovery_token' : 'confirmation_token') ?? ''
    let action: AccountAction
    if (mode === 'signup') action = { action: 'signup', email, password, name: String(form.get('name') ?? '').trim(), nickname: String(form.get('nickname') ?? '').trim() }
    else if (mode === 'verify') action = { action: 'verify', tokenHash }
    else if (mode === 'reset') action = { action: 'reset', password, tokenHash }
    else if (mode === 'forgot') action = { action: 'forgot', email }
    else action = { action: 'login', email, password }
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await accountRequest(action)
      if (mode === 'signup') setMessage(result.message || 'Check your email to verify your account, then sign in.')
      else if (mode === 'forgot') setMessage('If that address has an account, a password reset email will arrive shortly.')
      else {
        if (mode === 'reset' || mode === 'verify') {
          history.replaceState({}, '', location.pathname)
          setMode('login')
          setMessage(result.message || (mode === 'reset' ? 'Password updated. You can now sign in.' : 'Email verified. You can now sign in.'))
        }
        await onRefresh()
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Please try again.') }
    finally { setBusy(false) }
  }
  return <main className="account-auth">
    <div className="account-intro"><h1>Your races, saved together.</h1><p>Sign in to organise events, revisit race history and keep track of podium finishes.</p></div>
    <section className="account-card">
      <h2>{titles[mode]}</h2>
      {googleEnabled && (mode === 'login' || mode === 'signup') && <p><button type="button" className="secondary" onClick={() => {
        try { oauthLogin('google') } catch { setError('Google sign-in could not be started.') }
      }}>Continue with Google</button></p>}
      {(mode === 'login' || mode === 'signup') && <div className="account-tabs" aria-label="Account access">
        <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); setMessage('') }}>Sign in</button>
        <button type="button" aria-pressed={mode === 'signup'} onClick={() => { setMode('signup'); setError(''); setMessage('') }}>Sign up</button>
      </div>}
      <form onSubmit={submit} className="account-form">
        {mode === 'signup' && <>
          <label>Your name<input name="name" autoComplete="name" required maxLength={100} /></label>
          <label>Nickname <span className="account-muted">(optional)</span><input name="nickname" autoComplete="nickname" maxLength={60} /></label>
        </>}
        {mode === 'verify' && <p className="account-help">Confirm this email address to finish setting up your account.</p>}
        {mode !== 'reset' && mode !== 'verify' && <label>Email<input name="email" type="email" required autoComplete="email" maxLength={254} /></label>}
        {mode !== 'forgot' && mode !== 'verify' && <label>Password<input name="password" type="password" required minLength={mode === 'login' ? 1 : 15} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={mode === 'login' ? undefined : 'account-password-help'} /></label>}
        {(mode === 'signup' || mode === 'reset') && <p id="account-password-help" className="account-help">Use at least 15 characters. Spaces and simple words are welcome.</p>}
        {error && <p role="alert" className="account-error">{error}</p>}
        {message && <p role="status" className="account-notice">{message}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'verify' ? 'Verify email' : mode === 'forgot' ? 'Send reset email' : mode === 'reset' ? 'Save new password' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>
      {mode === 'login' ? <button className="account-text-button" onClick={() => { setMode('forgot'); setError(''); setMessage('') }}>Forgot password?</button>
        : <button className="account-text-button" onClick={() => { setMode('login'); setError(''); setMessage('') }}>Back to sign in</button>}
    </section>
  </main>
}

function OrganiserHome({ account, events, onRefresh, onOpen, onCreate, onSignOut, onImportResults }: AccountHomeProps & { account: AccountProfile }) {
  const [section, setSection] = useState<'events' | 'settings'>('events')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const matching = filterAccountEvents(events, query, status, from, to)
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await work() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Please try again.') }
    finally { setBusy(false) }
  }
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const draft = createEvent(String(form.get('name') ?? ''), String(form.get('date') ?? ''), String(form.get('venue') ?? ''))
    draft.entryFee = account.entryFee
    void run(() => onCreate(draft))
  }
  const claim = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const link = String(new FormData(form).get('link') ?? '').trim()
    void run(async () => {
      const result = await accountRequest({ action: 'claim', link })
      form.reset()
      await onRefresh()
      setMessage(result.message || 'The event is now in your account.')
    })
  }
  const importBackup = (file?: File) => {
    if (!file) return
    void run(async () => {
      if (file.size > 1_500_000) throw new Error('Choose an event backup smaller than 1.5 MB.')
      const parsed = JSON.parse(await file.text()) as EventData
      if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.mainClasses) || !Array.isArray(parsed.finalsClasses) || !Array.isArray(parsed.reraces)) {
        throw new Error('Choose a Race Manager JSON event backup.')
      }
      await onCreate({ ...parsed, id: '', version: 0, name: parsed.name + ' copy', audit: [] })
    })
  }
  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const pointFields = ['first', 'second', 'third'] as const
    const filled = pointFields.filter(field => String(form.get(field) ?? '').trim() !== '')
    if (filled.length !== 0 && filled.length !== 3) { setError('Enter all three podium point values, or leave all three blank.'); return }
    const points = filled.length ? {
      first: Number(form.get('first')), second: Number(form.get('second')), third: Number(form.get('third')),
    } : undefined
    void run(async () => {
      const result = await accountRequest({
        action: 'profile', name: String(form.get('name') ?? '').trim(), nickname: String(form.get('nickname') ?? '').trim(),
        timezone: String(form.get('timezone') ?? '').trim(), entryFee: Number(form.get('entryFee')), points,
      })
      await onRefresh()
      setMessage(result.message || 'Settings saved.')
    })
  }
  return <main className="account-dashboard">
    <div className="account-dashboard-heading"><div><p className="eyebrow">Your account</p><h1>{account.nickname || account.name || 'My Events'}</h1><p className="account-muted">{account.email}</p></div>
      <button className="secondary" disabled={busy} onClick={() => void run(onSignOut)}>Sign out</button>
    </div>
    <nav className="account-tabs" aria-label="Account sections">
      <button aria-pressed={section === 'events'} onClick={() => setSection('events')}>My Events</button>
      <button aria-pressed={section === 'settings'} onClick={() => setSection('settings')}>Profile and settings</button>
    </nav>
    {error && <p role="alert" className="account-error">{error}</p>}
    {message && <p role="status" className="account-notice">{message}</p>}
    {section === 'events' ? <>
      <section className="account-card">
        <div className="account-section-heading"><h2>My Events</h2><button className="secondary compact" disabled={busy} onClick={() => void run(onRefresh)}>Refresh</button></div>
        <div className="account-filters">
          <label>Search events<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Event or venue" /></label>
          <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All events</option><option value="draft">Draft</option><option value="live">Live</option><option value="complete">Completed</option></select></label>
          <label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
        </div>
        {matching.length ? <div className="account-events">{matching.map(event => <button key={event.id} onClick={() => onOpen(event.id)}>
          <strong>{event.name}</strong><span>{event.date || 'Date to be confirmed'}{event.venue ? ' · ' + event.venue : ''}</span><span className="account-event-status">{event.status === 'complete' ? 'Completed' : event.status === 'live' ? 'Live' : 'Draft'}</span>
        </button>)}</div> : <p className="account-empty">{events.length ? 'No events match these filters.' : 'Create an event or claim a saved event to start your history.'}</p>}
      </section>
      <div className="account-two-column">
        <section className="account-card"><h2>Create an event</h2><form className="account-form" onSubmit={create}>
          <label>Event name<input name="name" required maxLength={120} /></label>
          <label>Date<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label>Venue<input name="venue" maxLength={160} /></label>
          <button className="primary" disabled={busy}>Create event</button>
        </form></section>
        <section className="account-card"><h2>Bring back an event</h2><p className="account-help">Paste the private admin link for an event you organised.</p><form className="account-form" onSubmit={claim}>
          <label>Private event link<input type="url" name="link" required autoComplete="off" maxLength={2000} /></label>
          <button className="secondary" disabled={busy}>Add event to my account</button>
        </form>
          <label className="account-file-label">Import event backup<input type="file" accept=".json,application/json" disabled={busy} onChange={event => { importBackup(event.target.files?.[0]); event.target.value = '' }} /></label>
          {onImportResults && <label className="account-file-label">Import historical results<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void run(() => onImportResults(file)); event.target.value = '' }} /></label>}
        </section>
      </div>
    </> : <section className="account-card account-settings"><h2>Profile and settings</h2><form key={JSON.stringify(account)} className="account-form" onSubmit={saveProfile}>
      <label>Your name<input name="name" required maxLength={100} autoComplete="name" defaultValue={account.name} /></label>
      <label>Nickname<input name="nickname" maxLength={60} autoComplete="nickname" defaultValue={account.nickname} /></label>
      <label>Timezone<input name="timezone" required maxLength={80} defaultValue={account.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} placeholder="Australia/Perth" /></label>
      <label>Default fee per entry<input name="entryFee" type="number" required min="0" max="1000" step="0.01" defaultValue={account.entryFee} /></label>
      <fieldset><legend>Points per podium finish</legend><p className="account-help">Leave all three blank until your club's points rules are confirmed.</p>
        <div className="account-point-fields">{(['first', 'second', 'third'] as const).map((field, index) => <label key={field}>{['1st place', '2nd place', '3rd place'][index]}<input name={field} type="number" min="0" max="100000" step="0.01" defaultValue={account.points?.[field] ?? ''} /></label>)}</div>
      </fieldset>
      <button className="primary" disabled={busy}>Save settings</button>
    </form>
      <button className="account-text-button" disabled={busy} onClick={() => void run(async () => {
        await accountRequest({ action: 'forgot', email: account.email })
        setMessage('Check your email for a password reset link.')
      })}>Email me a password reset link</button>
    </section>}
  </main>
}
