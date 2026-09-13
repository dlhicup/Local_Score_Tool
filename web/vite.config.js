import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Development only. The studio itself is served by the API process on
    // :9044 from web/dist — one origin, built assets, no proxy in the video
    // path. Run `npm run build` to update what :9044 serves.
    host: true,
    port: 5173,
    strictPort: true,
    // 127.0.0.1, not 'localhost': localhost can resolve to ::1 first, which
    // would miss an API bound to IPv4 loopback.
    proxy: { '/api': { target: 'http://127.0.0.1:8790', changeOrigin: true } },
  },
});
