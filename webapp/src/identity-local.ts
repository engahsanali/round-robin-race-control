// Browser stand-in for @netlify/identity in the self-hosted build (VITE_AUTH=local).
// Accounts are handled by the Race Manager server; there is no Google sign-in.
export async function getSettings() {
  return { autoconfirm: true, disableSignup: false, providers: { google: false, github: false, gitlab: false, bitbucket: false, facebook: false, email: true, saml: false } }
}
export function oauthLogin(_provider: string): never { throw new Error('Google sign-in is not available.') }
export async function handleAuthCallback() { return null }
export async function logout() { /* the server clears the session cookie on sign-out */ }
