import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('./viewer', import.meta.url)),
  publicDir: 'public',
  build: {
    rollupOptions: {
      input: {
        zhangqianMuralTrial: fileURLToPath(new URL('./viewer/zhangqian-mural-trial.html', import.meta.url)),
        tripoLab: fileURLToPath(new URL('./viewer/tripo-lab.html', import.meta.url)),
        mural: fileURLToPath(new URL('./viewer/mural.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./viewer/index.html', import.meta.url)),
        yuezhi: fileURLToPath(new URL('./viewer/yuezhi.html', import.meta.url)),
      },
    },
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api/processing/v1': 'http://127.0.0.1:8798',
    },
    fs: {
      allow: [repoRoot],
    },
  },
})
