import fs from 'node:fs/promises';
import crypto from 'node:crypto';

/**
 * Write a file so a crash can never leave it half-written: the bytes go to a
 * sibling temp file and are swapped in with a single rename.
 *
 * The retry is for Windows. `rename` there is MoveFileEx, which cannot replace
 * a destination while anything holds a handle to it — and Defender or the
 * search indexer opens a file moments after it is written. The result is a
 * transient EBUSY/EPERM on a file nothing is really using. Retrying a few
 * times rides it out; giving up leaves no temp file behind.
 */
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES']);
const RETRIES = 6;

export async function writeFileAtomic(target, contents) {
  const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');

  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, target);
      return target;
    } catch (err) {
      if (!TRANSIENT.has(err.code) || attempt >= RETRIES) {
        // Never strand the temp file: a failed save should leave the directory
        // exactly as it found it.
        await fs.unlink(tmp).catch(() => {});
        throw err;
      }
      // 40ms, 80, 160, 320, 640, 1280 — about 2.5s in total, which covers a
      // scanner's grip without making a real failure feel like a hang.
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt));
    }
  }
}

/**
 * Clear temp files stranded by an older build (or a hard kill) so they do not
 * accumulate in the data directory forever.
 */
export async function sweepTempFiles(dir) {
  const names = await fs.readdir(dir).catch(() => []);
  await Promise.all(
    names.filter((n) => n.endsWith('.tmp')).map((n) => fs.unlink(`${dir}/${n}`).catch(() => {})),
  );
}
