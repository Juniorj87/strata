import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Asentum explorer API does not send CORS headers, so the browser cannot
// reach it directly. Both dev (here) and production (vercel.json) expose a
// same-origin proxy at /api/explorer that forwards to explorer.asentum.com/api.
const explorerProxy = {
  '/api/explorer': {
    target: 'https://explorer.asentum.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/explorer/, '/api'),
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: explorerProxy },
  preview: { proxy: explorerProxy },
})
