import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // VITE_BASE=/roundrobin/ builds the app for the ahsantechlabs.com VPS sub-path.
  base: process.env.VITE_BASE || '/',
  // VITE_AUTH=local swaps the Netlify Identity browser client for the self-hosted one.
  resolve: process.env.VITE_AUTH === 'local' ? { alias: { '@netlify/identity': fileURLToPath(new URL('./src/identity-local.ts', import.meta.url)) } } : {},
  plugins: [react()],
})
