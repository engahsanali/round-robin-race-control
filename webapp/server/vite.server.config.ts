// Bundles server/index.ts and the Netlify function sources into one Node file.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@netlify/blobs': local('./blobs.ts'),
      '@netlify/identity': local('./identity.ts'),
    },
  },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: local('./index.ts'),
    outDir: local('../dist-server'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'server.mjs' } },
  },
})
