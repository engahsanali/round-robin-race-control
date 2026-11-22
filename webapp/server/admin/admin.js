// Race Manager admin dashboard (no framework, no inline script).
const app = document.getElementById('app')
const signout = document.getElementById('signout')
const api = async (path, options = {}) => {
  const response = await fetch('api' + path, { credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')')
  return data
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const when = value => value ? new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Perth', dateStyle: 'medium', timeStyle: 'short' }) + ' AWST' : '—'
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content }
let state = { users: [], unlinked: [], sort: 'createdAt', dir: -1, query: '', status: 'all', tab: 'users' }

async function start() {
  const me = await api('/me').catch(() => ({ signedIn: false }))
  if (me.signedIn) return dashboard()
  signout.hidden = true
  app.replaceChildren(h(`<form class="card login" id="login">
    <h2>Admin sign in</h2>
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    ${me.totp ? '<label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label>' : ''}
    <p class="error" id="err"></p><button class="primary">Sign in</button></form>`))
  document.getElementById('login').addEventListener('submit', async event => {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    try { await post('/login', form); dashboard() } catch (error) { document.getElementById('err').textContent = error.message }
  })
}

signout.addEventListener('click', async () => { await post('/logout').catch(() => {}); start() })

const columns = [
  ['email', 'User'], ['signupMethod', 'Signed up via'], ['createdAt', 'Signed up'], ['verifiedAt', 'Verified'], ['lastLoginAt', 'Last login'],
  ['loginCount', 'Logins'], ['events', 'Events'], ['brackets', 'Brackets'], ['heatsRun', 'Races run'], ['lastActive', 'Last active'], ['status', 'Status'],
]
const value = (user, key) => ({
  events: user.totals.events, brackets: user.totals.brackets, heatsRun: user.totals.heatsRun,
  lastActive: [user.lastSeenAt, user.totals.lastEventUpdate, user.lastLoginAt].filter(Boolean).sort().at(-1) || '',
  status: user.disabledAt ? 'disabled' : user.verifiedAt ? 'active' : 'unverified',
}[key] ?? user[key] ?? '')

async function dashboard() {
  signout.hidden = false
  const data = await api('/users')
  state.users = data.users; state.unlinked = data.unlinkedWorkspaces
  render()
}

function render() {
  const tabs = `<div class="tabs">${['users', 'audit', 'add'].map(tab => `<button data-tab="${tab}" aria-pressed="${state.tab === tab}">${{ users: 'Users & leaderboard', audit: 'Admin audit log', add: 'Add user / link old data' }[tab]}</button>`).join('')}</div>`
  if (state.tab === 'audit') return renderAudit(tabs)
  if (state.tab === 'add') return renderAdd(tabs)
  const q = state.query.toLowerCase()
  const rows = state.users.filter(user => (!q || (user.email + ' ' + user.name + ' ' + user.nickname).toLowerCase().includes(q)) && (state.status === 'all' || value(user, 'status') === state.status))
    .sort((a, b) => { const x = value(a, state.sort), y = value(b, state.sort); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * state.dir })
  const total = key => state.users.reduce((sum, user) => sum + value(user, key), 0)
  app.replaceChildren(h(`${tabs}
    <div class="grid">
      <div class="stat"><span class="muted">Users</span><b>${state.users.length}</b></div>
      <div class="stat"><span class="muted">Signed up last 7 days</span><b>${state.users.filter(u => Date.now() - Date.parse(u.createdAt) < 7 * 864e5).length}</b></div>
      <div class="stat"><span class="muted">Events</span><b>${total('events')}</b></div>
      <div class="stat"><span class="muted">Races run</span><b>${total('heatsRun')}</b></div>
      <div class="stat"><span class="muted">Reset requests</span><b>${state.users.filter(u => u.resetRequested).length}</b></div>
      <div class="stat"><span class="muted">Unlinked old workspaces</span><b>${state.unlinked.length}</b></div>
    </div>
    <div class="card"><div class="row">
      <label>Search<input id="q" value="${esc(state.query)}" placeholder="email, name or nickname"></label>
      <label>Status<select id="status">${['all', 'active', 'unverified', 'disabled'].map(s => `<option ${s === state.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Leaderboard<select id="board"><option value="">Sort by column</option><option value="heatsRun">Most races run</option><option value="events">Most events</option><option value="loginCount">Most logins</option><option value="lastActive">Most recently active</option></select></label>
    </div></div>
    <div class="card" style="overflow-x:auto"><table><thead><tr>${columns.map(([key, label]) => `<th data-sort="${key}">${label}${state.sort === key ? (state.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(user => `<tr data-id="${user.id}">
      <td><b>${esc(user.email)}</b><br><span class="muted">${esc(user.name)}${user.nickname ? ' · ' + esc(user.nickname) : ''}</span>${user.resetRequested ? ' <span class="pill bad">reset requested</span>' : ''}</td>
      <td>${esc(user.signupMethod)}</td><td>${when(user.createdAt)}</td><td>${user.verifiedAt ? '<span class="pill ok">yes</span>' : '<span class="pill">no</span>'}</td>
      <td>${when(user.lastLoginAt)}</td><td class="num">${user.loginCount}</td><td class="num">${user.totals.events}</td><td class="num">${user.totals.brackets}</td>
      <td class="num">${user.totals.heatsRun}</td><td>${when(value(user, 'lastActive'))}</td>
      <td><span class="pill ${value(user, 'status') === 'active' ? 'ok' : value(user, 'status') === 'disabled' ? 'bad' : ''}">${value(user, 'status')}</span></td></tr>`).join('') || `<tr><td colspan="${columns.length}" class="muted">No users yet.</td></tr>`}</tbody></table></div>
    <div id="detail"></div>`))
  bindTabs()
  document.getElementById('q').addEventListener('input', event => { state.query = event.target.value; render(); const box = document.getElementById('q'); box.focus(); box.setSelectionRange(box.value.length, box.value.length) })
  document.getElementById('status').addEventListener('change', event => { state.status = event.target.value; render() })
  document.getElementById('board').addEventListener('change', event => { if (event.target.value) { state.sort = event.target.value; state.dir = -1; render() } })
  app.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { state.dir = state.sort === th.dataset.sort ? -state.dir : 1; state.sort = th.dataset.sort; render() }))
  app.querySelectorAll('tbody tr[data-id]').forEach(tr => tr.addEventListener('click', () => detail(tr.dataset.id)))
}

function bindTabs() { app.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; render() })) }

async function detail(id) {
  const box = document.getElementById('detail')
  const { user, stats, activity } = await api('/users/' + id)
  box.replaceChildren(h(`<div class="card"><h2>${esc(user.email)}</h2>
    <div class="grid">
      <div class="stat"><span class="muted">Name</span><b>${esc(user.name) || '—'}</b>${esc(user.nickname)}</div>
      <div class="stat"><span class="muted">Signed up</span>${when(user.createdAt)}<br>via ${esc(user.signupMethod)}${user.signupIp ? '<br>IP ' + esc(user.signupIp) : ''}</div>
      <div class="stat"><span class="muted">Email verified</span>${user.verifiedAt ? when(user.verifiedAt) : 'No'}</div>
      <div class="stat"><span class="muted">Last login / seen</span>${when(user.lastLoginAt)}<br>${when(user.lastSeenAt)}</div>
      <div class="stat"><span class="muted">Logins</span><b>${user.loginCount}</b></div>
      <div class="stat"><span class="muted">Events · brackets · races</span><b>${stats.totals.events} · ${stats.totals.brackets} · ${stats.totals.heatsRun}</b>${stats.podiums} podium sets, ${stats.published} public displays</div>
      <div class="stat"><span class="muted">Account</span>${user.disabledAt ? 'Disabled ' + when(user.disabledAt) : 'Enabled'}<br>${user.hasPassword ? 'Password set' : 'No password yet'}<br>${user.googleSub ? 'Google linked' : ''}<br><span class="muted">User ${esc(user.id)}<br>Workspace ${esc(user.workspaceId)}</span></div>
    </div>
    <div class="actions">
      <button data-act="reset-link" class="primary">Create reset link</button>
      <button data-act="email-reset">Email reset link</button>
      ${user.verifiedAt ? '' : '<button data-act="email-verify">Email verification link</button>'}
      <button data-act="temp-password">Set temporary password</button>
      <button data-act="logout">Force sign-out</button>
      ${user.verifiedAt ? '' : '<button data-act="verify">Mark email verified</button>'}
      ${user.disabledAt ? '<button data-act="enable">Enable</button>' : '<button data-act="disable" class="danger">Disable</button>'}
      <button data-act="delete" class="danger">Delete login…</button>
    </div>
    ${state.unlinked.length ? `<div class="row"><label>Give this user an old workspace<select id="ws">${state.unlinked.map(w => `<option value="${w.workspaceId}">${w.workspaceId.slice(0, 8)}… · ${w.totals.events} events</option>`).join('')}</select></label><button data-act="link-workspace">Link workspace</button></div>` : ''}<div id="result"></div>
    <h3>Events</h3><table><thead><tr><th>Event</th><th>Date</th><th>Status</th><th>Brackets</th><th>Entrants</th><th>Races run</th><th>Updated</th></tr></thead>
    <tbody>${stats.events.map(e => `<tr><td>${esc(e.name)}<br><span class="muted">${esc(e.venue)}</span></td><td>${esc(e.date)}</td><td>${esc(e.status)}</td><td class="num">${e.brackets}</td><td class="num">${e.entrants}</td><td class="num">${e.heatsRun} / ${e.races}</td><td>${when(e.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No events.</td></tr>'}</tbody></table>
    <h3>Recent activity</h3><table><tbody>${activity.slice(0, 40).map(a => `<tr><td>${when(a.at)}</td><td>${esc(a.type)}</td><td class="muted">${esc(a.detail || '')} ${a.ip ? 'IP ' + esc(a.ip) : ''}</td></tr>`).join('') || '<tr><td class="muted">None yet.</td></tr>'}</tbody></table></div>`))
  box.scrollIntoView({ behavior: 'smooth' })
  box.querySelectorAll('[data-act]').forEach(button => button.addEventListener('click', async () => {
    const act = button.dataset.act
    const body = { action: act }
    if (act === 'link-workspace') { body.workspaceId = document.getElementById('ws').value; if (!confirm('Replace this user’s workspace with the selected old one?')) return }
    else if (act === 'delete') { body.confirm = prompt('Delete this login? Race data is kept. Type the user’s email to confirm:'); if (!body.confirm) return }
    else if (['disable', 'temp-password', 'logout'].includes(act) && !confirm('Are you sure?')) return
    const out = document.getElementById('result')
    try {
      const result = await post('/users/' + id + '/action', body)
      const secret = result.link || result.password
      out.replaceChildren(h(secret ? `<p>${esc(result.note || '')}</p><div class="secret">${esc(secret)}</div>` : `<p class="muted">Done. ${esc(result.note || '')}</p>`))
      const data = await api('/users'); state.users = data.users; state.unlinked = data.unlinkedWorkspaces
      if (act === 'delete') return render()
    } catch (error) { out.replaceChildren(h(`<p class="error">${esc(error.message)}</p>`)) }
  }))
}

async function renderAudit(tabs) {
  const { audit } = await api('/audit')
  app.replaceChildren(h(`${tabs}<div class="card"><table><thead><tr><th>When</th><th>Action</th><th>User</th><th>IP</th></tr></thead><tbody>
    ${audit.map(a => `<tr><td>${when(a.at)}</td><td>${esc(a.action)}</td><td>${esc(a.email || '')}</td><td class="muted">${esc(a.ip)}</td></tr>`).join('') || '<tr><td class="muted">Nothing yet.</td></tr>'}</tbody></table></div>`))
  bindTabs()
}

function renderAdd(tabs) {
  app.replaceChildren(h(`${tabs}<form class="card" id="add"><h2>Add a user</h2>
    <p class="muted">Creates a verified account with no password and gives you a 72-hour link for them to choose one. Pick an old workspace to hand them the race data saved before the move.</p>
    <div class="row"><label>Email<input name="email" type="email" required></label><label>Name<input name="name"></label>
    <label>Old workspace<select name="workspaceId"><option value="">None (new, empty)</option>${state.unlinked.map(w => `<option value="${w.workspaceId}">${w.workspaceId.slice(0, 8)}… · ${w.totals.events} events, ${w.totals.heatsRun} races</option>`).join('')}</select></label></div>
    <p><button class="primary">Create user and link</button></p><div id="result"></div></form>
    <div class="card"><h3>Old workspaces not linked to anyone</h3><table><tbody>${state.unlinked.map(w => `<tr><td>${esc(w.workspaceId)}</td><td>${w.totals.events} events · ${w.totals.brackets} brackets · ${w.totals.heatsRun} races</td><td>${when(w.totals.lastEventUpdate)}</td></tr>`).join('') || '<tr><td class="muted">None.</td></tr>'}</tbody></table>
    <p class="muted">To give an existing user an old workspace, open them on the Users tab.</p></div>`))
  bindTabs()
  document.getElementById('add').addEventListener('submit', async event => {
    event.preventDefault()
    const out = document.getElementById('result')
    try {
      const result = await post('/users', Object.fromEntries(new FormData(event.currentTarget)))
      out.replaceChildren(h(`<p>Send this link to ${esc(result.user.email)}. It is shown only now and works once within 72 hours.</p><div class="secret">${esc(result.link)}</div>`))
      const data = await api('/users'); state.users = data.users; state.unlinked = data.unlinkedWorkspaces
    } catch (error) { out.replaceChildren(h(`<p class="error">${esc(error.message)}</p>`)) }
  })
}

start()
