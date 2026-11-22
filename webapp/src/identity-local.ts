// Browser stand-in for @netlify/identity in the self-hosted build (VITE_AUTH=local).
import { apiPath } from './base'
export async function getSettings() {
  const settings = await fetch(apiPath('/api/auth/config'), { credentials: 'same-origin' }).then(r => r.json()).catch(() => ({ google: false }))
  return { autoconfirm: true, disableSignup: false, providers: { google: Boolean(settings.google), github: false, gitlab: false, bitbucket: false, facebook: false, email: true, saml: false } }
}
export function oauthLogin(provider: string) {
  if (provider !== 'google') throw new Error('Only Google sign-in is available.')
  location.assign(apiPath('/api/auth/google/start'))
}
export async function handleAuthCallback() { return null }
export async function logout() { /* the server clears the session cookie on sign-out */ }
