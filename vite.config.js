import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A purely local tool: `npm run dev` serves it on localhost, `npm run build`
// emits a static bundle. No API, no proxy — video is read from disk in the
// browser and ground truth is written back to disk from the browser.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 9070, strictPort: false, open: false },
});
