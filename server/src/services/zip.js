import zlib from 'node:zlib';

/**
 * A minimal zip writer, for handing back one file per clip in a single
 * download.
 *
 * Hand-rolled rather than pulled in: the format's stored/deflated form is a few
 * headers around data `zlib` already produces, and a self-hosted tool that four
 * people run on one PC does not need another dependency to keep current. Only
 * what a download needs is here — no reading, no streaming, no directories,
 * no zip64. A review log for a thousand clips is still a few megabytes, which
 * is a buffer, not a stream.
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * MS-DOS date and time, which is what the format stores. Before 1980 is not
 * representable; clamp rather than write a negative year.
 */
function dosTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.valueOf()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Build a zip from `{ name, data }` entries. `data` is a string or Buffer.
 *
 * Every name is written as UTF-8 with the language-encoding flag set, so a clip
 * called "Veo – Münster" survives being unzipped on a machine whose codepage is
 * not UTF-8 — which is most of them.
 */
export function zipSync(entries, { at = new Date() } = {}) {
  const { time, date } = dosTime(at);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const crc = crc32(raw);

    // Deflate unless it makes the entry bigger, which it does for tiny files.
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const method = stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // flags: name is UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // no comment

  return Buffer.concat([...locals, centralBuf, end]);
}

/**
 * A clip name turned into a filename that survives every archive tool and
 * filesystem, while still being recognisable. Windows alone forbids \ / : * ?
 * " < > | and trailing dots.
 */
export function safeEntryName(name, { ext = 'csv', fallback = 'clip' } = {}) {
  const base = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 120)
    .trim();
  return `${base || fallback}.${ext}`;
}
