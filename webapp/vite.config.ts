import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // VITE_BASE=/roundrobin/ builds the app for the ahsantechlabs.com VPS sub-path.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
})
