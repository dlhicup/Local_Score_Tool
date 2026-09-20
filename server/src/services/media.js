import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * A clip's duration and frame size, read from the clip.
 *
 * These used to be cached on disk beside the annotations. They are a property
 * of the video file, though, not something the studio decides — so asking the
 * file is both simpler and always right, and it means a clip dropped into the
 * folder needs nothing else to show up complete.
 *
 * Cached in memory per name:size:mtime, so a listing of a thousand clips costs
 * one probe each on the first request and nothing afterwards. Returns nulls
 * when ffprobe is missing, which is not fatal: the annotate page learns the
 * real duration from the video element as soon as the clip loads.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const VIDEO_DIR = path.resolve(ROOT, process.env.VIDEO_DIR || 'video');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE =
  process.env.FFPROBE_PATH ||
  (FFMPEG === 'ffmpeg' ? 'ffprobe' : path.join(path.dirname(FFMPEG), `ffprobe${path.extname(FFMPEG)}`));

const EMPTY = { duration: null, width: null, height: null };
const cache = new Map();

function runFfprobe(file) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      file,
    ];
    const p = spawn(FFPROBE, args);
    let out = '';
    p.on('error', () => resolve(null)); // ffprobe not installed
    p.stdout.on('data', (d) => {
      out += d;
      if (out.length > 200_000) p.kill();
    });
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

export async function probeVideo(name) {
  const file = path.join(VIDEO_DIR, path.basename(name));
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return { ...EMPTY };

  const key = `${path.basename(name)}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  if (cache.has(key)) return cache.get(key);

  const info = await runFfprobe(file);
  const v = info?.streams?.[0] ?? {};
  const meta = {
    duration: Number.isFinite(Number(info?.format?.duration)) ? Number(Number(info.format.duration).toFixed(3)) : null,
    width: Number.isFinite(Number(v.width)) ? Number(v.width) : null,
    height: Number.isFinite(Number(v.height)) ? Number(v.height) : null,
    size: stat.size,
  };
  cache.set(key, meta);
  return meta;
}
