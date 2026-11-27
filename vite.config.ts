import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The Asentum explorer API does not send CORS headers, so the browser cannot
// reach it directly. Both dev (here) and production (vercel.json) expose a
// same-origin proxy at /api/explorer that forwards to explorer.asentum.com/api.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const explorerTarget = (env.VITE_EXPLORER_URL || 'https://explorer.asentum.com').replace(/\/+$/, '');
  const explorerProxy = {
    '/api/explorer': {
      target: explorerTarget,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/explorer/, '/api'),
    },
  };
  return {
    plugins: [react()],
    server: { proxy: explorerProxy },
    preview: { proxy: explorerProxy },
  };
});
