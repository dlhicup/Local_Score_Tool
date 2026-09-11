import { useRef, useState } from 'react';
import { Film } from 'lucide-react';
import { useStore } from '../store';

const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;

/** The empty state: pick or drop a video from local disk. Nothing uploads. */
export default function DropZone() {
  const openVideo = useStore((s) => s.openVideo);
  const [hot, setHot] = useState(false);
  const input = useRef(null);

  const take = (file) => {
    if (file && (file.type.startsWith('video/') || VIDEO_RE.test(file.name))) openVideo(file);
  };

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); setHot(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setHot(false)}
      onDrop={(e) => { e.preventDefault(); setHot(false); take(e.dataTransfer.files[0]); }}
      className={`grid h-full w-full place-items-center rounded-2xl border-2 border-dashed transition ${
        hot ? 'border-pitch-400 bg-pitch-500/10' : 'border-white/10'
      }`}
    >
      <div className="max-w-sm px-6 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-pitch-500/10 text-pitch-400">
          <Film size={26} />
        </div>
        <h2 className="text-lg font-semibold text-ink-100">Drop a football clip here</h2>
        <p className="mt-2 text-sm text-ink-500">
          The video never leaves your computer — it plays straight from disk, so scrubbing is instant.
        </p>
        <button onClick={() => input.current?.click()} className="btn-primary mt-5">
          Choose video…
        </button>
        <p className="mt-4 text-2xs text-ink-600">mp4 · webm · mov · mkv — nothing is uploaded</p>
        <input
          ref={input}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => take(e.target.files[0])}
        />
      </div>
    </div>
  );
}
