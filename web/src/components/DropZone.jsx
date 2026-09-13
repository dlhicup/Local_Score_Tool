import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { UploadCloud, Film } from 'lucide-react';

const ACCEPT = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg'];

export default function DropZone({ onFile, compact = false }) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handle = useCallback(
    (file) => {
      if (!file) return;
      // Some browsers report an empty type for .mkv/.mov; fall back to extension.
      const okType = ACCEPT.includes(file.type) || file.type.startsWith('video/');
      const okExt = /\.(mp4|webm|mov|mkv|ogv|ogg|m4v)$/i.test(file.name);
      if (!okType && !okExt) {
        setError('That does not look like a video file.');
        return;
      }
      setError(null);
      onFile(file);
    },
    [onFile],
  );

  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files?.[0]);
  };

  return (
    <div className={compact ? 'h-full' : ''}>
      <motion.div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        animate={{ scale: over ? 1.01 : 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed transition-colors ${
          over ? 'border-pitch-500 bg-pitch-500/[0.07]' : 'border-white/10 bg-ink-850/60 hover:border-white/25'
        } ${compact ? 'flex h-full items-center justify-center px-5 py-6' : 'px-8 py-14'}`}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: 'radial-gradient(ellipse 60% 80% at 50% 0%, rgba(34,227,125,.12), transparent 70%)' }}
        />
        <div className="relative flex flex-col items-center text-center">
          <motion.div
            animate={{ y: over ? -4 : 0 }}
            className={`mb-4 flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] ${
              compact ? 'h-11 w-11' : 'h-16 w-16'
            }`}
          >
            {over ? (
              <Film size={compact ? 20 : 26} className="text-pitch-400" />
            ) : (
              <UploadCloud size={compact ? 20 : 26} className="text-ink-300" />
            )}
          </motion.div>
          <p className={`font-semibold text-white ${compact ? 'text-sm' : 'text-base'}`}>
            {over ? 'Release to load the match' : 'Drop a match video here'}
          </p>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-400">
            MP4, WebM, MOV or MKV. The file stays on this machine — only sampled frames are sent to the model.
          </p>
          {error && <p className="mt-3 text-xs font-medium text-avoid-500">{error}</p>}
        </div>
      </motion.div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </div>
  );
}
