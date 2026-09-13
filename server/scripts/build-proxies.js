#!/usr/bin/env node
/**
 * Build browser-safe H.264 proxies for every clip already in the video folder.
 *
 *   npm run proxies
 *
 * New imports get a proxy automatically; this is the one-shot for clips that
 * were imported before proxies existed (or while ffmpeg was not installed).
 * Safe to re-run — clips that already have a proxy are skipped. Needs ffmpeg on
 * PATH (or FFMPEG_PATH set). The server does not need to be stopped.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeProxyBlocking, ffmpegAvailable, PROXY_DIR } from '../src/services/proxy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VIDEO_DIR = path.resolve(ROOT, process.env.VIDEO_DIR || 'video');
const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;

if (!(await ffmpegAvailable())) {
  console.error('ffmpeg is not installed or not on PATH.');
  console.error('Install it (Windows: `winget install --id Gyan.FFmpeg -e`), reopen the terminal, then re-run: npm run proxies');
  process.exit(1);
}

const names = (await fs.readdir(VIDEO_DIR).catch(() => [])).filter((n) => VIDEO_RE.test(n)).sort();
if (!names.length) {
  console.log('No videos found in', VIDEO_DIR);
  process.exit(0);
}

console.log(`Building browser-safe proxies for ${names.length} clip(s)`);
console.log(`  from: ${VIDEO_DIR}`);
console.log(`  to:   ${PROXY_DIR}\n`);

let built = 0;
let skipped = 0;
let failed = 0;
for (const name of names) {
  process.stdout.write(`• ${name} … `);
  try {
    const result = await encodeProxyBlocking(name, (p) => {
      process.stdout.write(`\r• ${name} … ${Math.round(p * 100)}%    `);
    });
    if (result === 'ready') {
      skipped++;
      process.stdout.write(`\r• ${name} … already has a proxy\n`);
    } else {
      built++;
      process.stdout.write(`\r• ${name} … done                    \n`);
    }
  } catch (err) {
    failed++;
    process.stdout.write(`\r• ${name} … FAILED — ${err.message}\n`);
  }
}

console.log(`\nDone. Built ${built}, skipped ${skipped}, failed ${failed}.`);
