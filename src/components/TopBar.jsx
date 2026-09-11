import { useRef } from 'react';
import { Undo2, Redo2, Save, FolderOpen, Upload, HelpCircle, Video } from 'lucide-react';
import { useStore } from '../store';

const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;

/**
 * The header. Saving prefers a folder handle (File System Access API) so each
 * Save drops videoname.json straight into a chosen directory — like the
 * platform writing to groundtruth/ — and falls back to a browser download.
 */
export default function TopBar({ dirHandle, setDirHandle }) {
  const { fileName, events, dirty, past, future, videoUrl } = useStore();
  const openVideo = useStore((s) => s.openVideo);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const buildGroundTruth = useStore((s) => s.buildGroundTruth);
  const gtFileName = useStore((s) => s.gtFileName);
  const markSaved = useStore((s) => s.markSaved);
  const loadGroundTruth = useStore((s) => s.loadGroundTruth);

  const vidInput = useRef(null);
  const gtInput = useRef(null);

  const chooseFolder = async () => {
    if (!window.showDirectoryPicker) return window.__toast?.('This browser can’t pick a folder — Save will download', 'err');
    try {
      const h = await window.showDirectoryPicker();
      setDirHandle(h);
      window.__toast?.(`Ground truth will save into “${h.name}”`, 'ok');
    } catch { /* cancelled */ }
  };

  const save = async () => {
    if (!videoUrl) return;
    const body = buildGroundTruth();
    const name = gtFileName();
    if (dirHandle) {
      try {
        const fh = await dirHandle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(body);
        await w.close();
        markSaved();
        window.__toast?.(`Saved ${events.length} actions → ${name}`, 'ok');
        return;
      } catch { window.__toast?.('Folder write failed — downloading instead', 'err'); }
    }
    const blob = new Blob([body], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    markSaved();
    window.__toast?.(`Saved ${name}`, 'ok');
  };
  // expose so the keyboard handler can call the same save
  window.__save = save;

  const loadGT = (file) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const n = loadGroundTruth(JSON.parse(rd.result));
        window.__toast?.(`Loaded ${n} actions from ${file.name}`, 'ok');
      } catch { window.__toast?.('Couldn’t read that JSON', 'err'); }
    };
    rd.readAsText(file);
  };

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] bg-ink-800 px-4 py-2.5">
      <div className="flex items-center gap-2 font-bold tracking-tight">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-pitch-500/15 text-sm">⚽</span>
        Local Score Tool
        <span className="text-2xs font-normal text-ink-600">football ground truth</span>
      </div>
      {fileName && (
        <span className="truncate text-sm text-ink-400">
          <b className="text-ink-100">{fileName}</b>
        </span>
      )}
      <div className="flex-1" />
      <span className="font-mono text-xs text-ink-500">
        <b className="text-pitch-400">{events.length}</b> action{events.length === 1 ? '' : 's'}
        {dirty && ' · unsaved'}
      </span>
      <div className="flex items-center gap-0.5 rounded-lg border border-white/10 p-0.5">
        <button className="btn-icon !h-8 !w-8" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
        <button className="btn-icon !h-8 !w-8" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
      </div>
      <button className="btn-ghost !py-2" onClick={() => gtInput.current?.click()} title="Load an existing videoname.json"><Upload size={15} /> Load GT</button>
      <button className={`btn-ghost !py-2 ${dirHandle ? 'border-pitch-500/40 text-pitch-400' : ''}`} onClick={chooseFolder} title="Choose a folder to save into">
        <FolderOpen size={15} /> {dirHandle ? dirHandle.name : 'Output folder…'}
      </button>
      <button className="btn-ghost !py-2" onClick={() => vidInput.current?.click()} title="Open a different video"><Video size={15} /> Open</button>
      <button className="btn-primary !py-2" onClick={save} disabled={!videoUrl} title="Save ground truth (Ctrl+S)"><Save size={15} /> Save GT</button>
      <button className="btn-icon" onClick={useStore.getState().toggleHelp} title="Shortcuts (?)"><HelpCircle size={16} /></button>

      <input ref={vidInput} type="file" accept="video/*" className="hidden"
        onChange={(e) => { const f = e.target.files[0]; if (f && (f.type.startsWith('video/') || VIDEO_RE.test(f.name))) openVideo(f); }} />
      <input ref={gtInput} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => { loadGT(e.target.files[0]); e.target.value = ''; }} />
    </header>
  );
}
