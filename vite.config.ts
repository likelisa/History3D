import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('./viewer', import.meta.url)),
  publicDir: 'public',
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
})
