import { Router } from 'express';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProjects, readProject, writeProject, emptyProject, idForVideo } from '../services/store.js';
import { getAssignments } from '../services/users.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Admins see the whole corpus; an annotator sees only what they were given.
 * Enforced here rather than in the UI, so hiding a row is not the only thing
 * standing between a user and someone else's clip.
 */
async function visibleTo(user) {
  if (user?.role === 'admin') return null; // null = no restriction
  const assignments = await getAssignments();
  return new Set(Object.entries(assignments).filter(([, u]) => u === user?.username).map(([c]) => c));
}

const router = Router();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const VIDEO_DIR = path.resolve(ROOT, process.env.VIDEO_DIR || 'video');
// Lightweight 720p proxies for annotating. Encoded out of band; when a clip's
// proxy exists it is served instead of the original — ~3x less to download,
// with identical duration and frame timing. Originals are never modified.
const PROXY_DIR = path.resolve(ROOT, process.env.PROXY_DIR || 'video-proxy');
const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;

/** Never let a request escape the video directory. */
function resolveVideo(name) {
  const safe = path.basename(String(name || ''));
  if (!VIDEO_RE.test(safe)) return null;
  const full = path.join(VIDEO_DIR, safe);
  return full.startsWith(VIDEO_DIR + path.sep) ? full : null;
}

const MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
};

/**
 * The task list: every clip in the video directory, joined to its ground truth
 * if one exists. The join is by filename — that is the stable identifier here,
 * since the clips arrive already named by content hash.
 */
/**
 * Import a video into the shared folder. The file is streamed straight to disk
 * (no buffering, no upload-size middleware to trip over), named by the client
 * filename but confined to the video directory. Overwriting an existing name is
 * refused so one member cannot silently replace another's clip.
 */
router.post('/videos/upload', requireAuth, async (req, res, next) => {
  const name = path.basename(String(req.query.name || ''));
  const full = resolveVideo(name);
  if (!full) return res.status(400).json({ error: 'Not a video filename (mp4, webm, mov, mkv, m4v)' });
  try {
    if (await fs.access(full).then(() => true, () => false)) {
      return res.status(409).json({ error: `A clip named ${name} already exists` });
    }
    const tmp = `${full}.uploading`;
    await new Promise((resolve, reject) => {
      const ws = createWriteStream(tmp);
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    });
    const stat = await fs.stat(tmp);
    if (stat.size < 1024) { await fs.unlink(tmp).catch(() => {}); return res.status(400).json({ error: 'Upload was empty' }); }
    await fs.rename(tmp, full);
    res.status(201).json({ name, size: stat.size });
  } catch (err) {
    await fs.unlink(`${full}.uploading`).catch(() => {});
    next(err);
  }
});

router.get('/videos', requireAuth, async (req, res, next) => {
  try {
    const allowed = await visibleTo(req.user);
    const [names, projects] = await Promise.all([
      fs.readdir(VIDEO_DIR).catch(() => []),
      listProjects(),
    ]);

    const byFile = new Map();
    for (const p of projects) {
      if (p.video?.filename) byFile.set(p.video.filename, p);
    }

    const assignments = await getAssignments();
    // One stat per clip, all in flight at once — a thousand serial round trips
    // to the filesystem is what made this list slow.
    const eligible = names.filter((name) => VIDEO_RE.test(name) && (!allowed || allowed.has(name)));
    const stats = await Promise.all(
      eligible.map((name) => fs.stat(path.join(VIDEO_DIR, name)).catch(() => null)),
    );
    const videos = [];
    for (let i = 0; i < eligible.length; i++) {
      const name = eligible[i];
      const stat = stats[i];
      if (!stat?.isFile()) continue;

      const p = byFile.get(name) ?? null;
      // Opening a clip creates its project, so a project alone proves nothing.
      // Ground truth exists only once there are actions in it.
      const hasGT = Boolean(p && p.eventCount > 0);

      videos.push({
        name,
        size: stat.size,
        mtime: stat.mtimeMs,
        assignedTo: assignments[name] ?? null,
        project: p
          ? {
              id: p.id,
              eventCount: p.eventCount,
              accepted: p.accepted,
              pending: p.pending,
              byType: p.byType,
              marks: p.marks,
              duration: p.duration,
              updatedAt: p.meta?.updatedAt ?? null,
              review: p.review ?? null,
            }
          : null,
        // Three states drive the whole list: untouched, extracted but not fully
        // reviewed, and signed off.
        status: hasGT ? 'done' : 'todo',
      });
    }

    videos.sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      videos,
      dir: VIDEO_DIR,
      summary: {
        total: videos.length,
        todo: videos.filter((v) => v.status === 'todo').length,
        done: videos.filter((v) => v.status === 'done').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Byte-range streaming, so the player can seek without downloading the file. */
router.get('/videos/file/:name', requireAuth, async (req, res, next) => {
  const full = resolveVideo(req.params.name);
  if (!full) return res.status(400).json({ error: 'Bad video name' });

  const allowed = await visibleTo(req.user);
  if (allowed && !allowed.has(path.basename(req.params.name))) {
    return res.status(403).json({ error: 'This clip is not assigned to you' });
  }

  try {
    // Prefer the proxy when its encode has landed (atomic rename, so a file
    // that exists is complete).
    let serve = full;
    const proxy = path.join(PROXY_DIR, path.basename(full));
    await fs.access(proxy).then(() => { serve = proxy; }, () => {});

    const stat = await fs.stat(serve);
    const type = MIME[path.extname(serve).toLowerCase()] ?? 'application/octet-stream';

    // Identity of these exact bytes. It changes the moment a clip's proxy
    // replaces its original, which is what makes the swap safe: a cached copy
    // of the original can never shadow the smaller file.
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const lastMod = new Date(stat.mtimeMs).toUTCString();
    // Cacheable for an hour without asking. must-revalidate here made every
    // range request revalidate — and a revalidation carrying a Range is
    // answered with bytes, never 304 — so the browser could not reuse a single
    // byte it already had: a page reload re-downloaded whole clips. The ETag
    // still swaps a cached original for its proxy within the hour.
    const CACHE = 'private, max-age=3600';
    const base = { 'Cache-Control': CACHE, ETag: etag, 'Last-Modified': lastMod, 'Accept-Ranges': 'bytes' };

    // A bare revalidation may be answered "unchanged". A *range* request may
    // not: the player is asking for bytes it does not have, and a bodyless 304
    // leaves it with nothing to play — it stalls the moment its buffer runs
    // out, however much of the clip is already cached.
    if (!req.headers.range && req.headers['if-none-match'] === etag) {
      res.writeHead(304, base);
      return res.end();
    }

    // A resume is only valid against the same bytes; if the file changed under
    // the client, ignore the range and send the whole thing afresh.
    const ifRange = req.headers['if-range'];
    const rangeOk = !ifRange || ifRange === etag || ifRange === lastMod;
    const range = rangeOk ? req.headers.range : null;

    /** Pipe a slice out, cleaning up if the client walks away mid-transfer. */
    const send = (opts) => {
      const stream = createReadStream(serve, opts);
      // .pipe() forwards neither source errors nor client aborts, so an
      // unhandled read error would take the process down and every abandoned
      // seek would leak a file descriptor.
      stream.on('error', (e) => {
        if (!res.headersSent) res.status(500);
        res.end();
        if (e.code !== 'ENOENT') console.error('video read failed:', e.message);
      });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    };

    if (!range) {
      res.writeHead(200, { ...base, 'Content-Length': stat.size, 'Content-Type': type });
      return send();
    }

    // Both forms: `bytes=START-[END]` and the suffix form `bytes=-N`, which
    // asks for the LAST n bytes — reading it as 0..n would serve the wrong
    // part of the file.
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m || (!m[1] && !m[2])) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    let start;
    let end;
    if (!m[1]) {
      const suffix = Math.min(Number(m[2]), stat.size);
      start = stat.size - suffix;
      end = stat.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= stat.size || start > end) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }

    res.writeHead(206, {
      ...base,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
      'Content-Type': type,
    });
    send({ start, end });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Video not found' });
    next(err);
  }
});

/** Find the ground truth for a clip, or start one. Idempotent by filename. */
router.post('/videos/:name/open', requireAuth, async (req, res, next) => {
  const full = resolveVideo(req.params.name);
  if (!full) return res.status(400).json({ error: 'Bad video name' });

  const allowed = await visibleTo(req.user);
  if (allowed && !allowed.has(path.basename(req.params.name))) {
    return res.status(403).json({ error: 'This clip is not assigned to you' });
  }

  try {
    const name = path.basename(req.params.name);
    const stat = await fs.stat(full);
    const id = idForVideo(name);

    // Same clip -> same id, so this is idempotent even under concurrent opens.
    const existing = await readProject(id).catch(() => null);
    if (existing) return res.json({ project: existing, created: false });

    const project = {
      ...emptyProject({ name, video: { filename: name, size: stat.size, ...(req.body?.video ?? {}) } }),
      id,
    };
    await writeProject(project);
    res.status(201).json({ project, created: true });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Video not found' });
    next(err);
  }
});

export { VIDEO_DIR };
export default router;
