import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import metaRoutes from './routes/meta.js';
import authRoutes from './routes/auth.js';
import { withUser } from './middleware/auth.js';
import { ensureSeedAdmin } from './services/users.js';
import projectRoutes from './routes/projects.js';
import videoRoutes from './routes/videos.js';
import examRoutes from './routes/exam.js';
import reviewRoutes from './routes/review.js';
import { DATA_DIR } from './services/store.js';
import { VIDEO_DIR } from './routes/videos.js';
import { GT_DIR } from './services/gtfile.js';

const app = express();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB_DIST = process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : path.resolve(ROOT, 'web/dist');
const PORT = Number(process.env.PORT || 8790);
// The public entry: the built frontend and the API from one origin, so video
// bytes are not relayed through a dev-server proxy on their way out.
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT || 9044);
// Bound to loopback by default: the browser reaches the API through the Vite
// proxy, which runs on this machine, so nothing needs to reach 8790 from
// outside. Set HOST=0.0.0.0 to expose it deliberately.
const HOST = process.env.HOST || '127.0.0.1';

app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
// Squeezes JSON and HTML. Video is never compressed: a range response has to be
// byte-exact, and re-encoding the body would break seeking. The default filter
// already skips video/*, but say so outright rather than depend on it.
app.use(
  compression({
    filter: (req, res) => {
      const type = String(res.getHeader('Content-Type') || '');
      if (type.startsWith('video/')) return false;
      return compression.filter(req, res);
    },
  }),
);
// Frames arrive as base64 data URLs, so the default 100kb limit is far too small.
app.use(express.json({ limit: process.env.JSON_LIMIT || '96mb' }));

app.use(withUser);

app.get('/api/health', (_req, res) => res.json({ ok: true, dataDir: DATA_DIR }));

/**
 * The build currently on disk. A page whose own build id differs is running
 * code the server no longer serves — stale cache — and reloads itself once.
 */
app.get('/api/version', async (_req, res) => {
  try {
    const html = await readFile(path.join(WEB_DIST, 'index.html'), 'utf8');
    res.set('Cache-Control', 'no-store');
    res.json({ build: html.match(/assets\/index-([\w-]+)\.js/)?.[1] ?? 'unknown' });
  } catch {
    res.json({ build: 'unknown' });
  }
});
app.use('/api', authRoutes);
app.use('/api', metaRoutes);
app.use('/api', projectRoutes);
app.use('/api', videoRoutes);
app.use('/api', examRoutes);
app.use('/api', reviewRoutes);

// The built frontend. Hashed assets never change under the same name, so the
// browser may keep them forever; index.html must revalidate so a new build is
// picked up on the next visit.
app.use(
  express.static(WEB_DIST, {
    index: false,
    setHeaders: (res, filePath) => {
      res.setHeader(
        'Cache-Control',
        filePath.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-store, must-revalidate',
      );
    },
  }),
);
// Client-side routes (/p/:id/annotate, /users …) all serve the same shell.
app.get(/^\/(?!api\/).*/, (_req, res, next) => {
  res.sendFile(
    path.join(WEB_DIST, 'index.html'),
    { headers: { 'Cache-Control': 'no-store, must-revalidate', Pragma: 'no-cache', Expires: '0' } },
    (err) => err && next(err),
  );
});

app.use((req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message ?? 'Internal error' });
});

// A locked users.json must not stop the server booting: the store is re-read
// on every request, so seeding can simply be retried on the next start.
const seeded = await ensureSeedAdmin().catch((err) => {
  console.error(`Could not seed the first admin account: ${err.message}`);
  return null;
});
if (seeded) {
  console.log('');
  console.log('  Created the first admin account (sign in with just this username):');
  console.log(`    username: ${seeded.username}`);
  console.log('');
}

app.listen(PORT, HOST, () => {
  console.log(`Score GT API  →  http://${HOST}:${PORT}`);
  console.log(`Ground truth  →  ${DATA_DIR}`);
  console.log(`Video tasks   →  ${VIDEO_DIR}`);
  console.log(`GT files      →  ${GT_DIR}`);
});

if (existsSync(path.join(WEB_DIST, 'index.html'))) {
  app.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log(`Score GT app  →  http://0.0.0.0:${PUBLIC_PORT}  (serving web/dist)`);
  });
} else {
  console.log(`No web/dist build found — run \`npm run build\` to serve the app on :${PUBLIC_PORT}`);
}
