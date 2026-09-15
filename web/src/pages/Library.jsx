import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search, CheckCircle2, Circle, Film,
  ArrowRight, FolderOpen, RefreshCw, ShieldCheck, ChevronLeft, ChevronRight, Upload, Loader2, Trash2,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { api } from '../lib/api';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';
import { bytes, relativeTime } from '../lib/format';


const STATUS = {
  todo: { label: 'Not started', icon: Circle, tone: 'text-ink-500' },
  done: { label: 'Has ground truth', icon: CheckCircle2, tone: 'text-pitch-400' },
};

function StatTile({ label, value, tone, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`panel-inset flex-1 px-4 py-3 text-left transition ${
        active ? 'border-pitch-500/40 bg-pitch-500/[0.07]' : 'hover:border-white/15'
      }`}
    >
      <p className={`font-mono text-2xl font-bold leading-none tabular ${tone}`}>{value}</p>
      <p className="label-text mt-1.5">{label}</p>
    </button>
  );
}

function TaskRow({ v, onOpen, onDelete }) {
  const s = STATUS[v.status];
  const Icon = s.icon;
  // A project with no events is not "0% reviewed" — there is nothing to review
  // yet. Treat it as untouched everywhere it shows up.
  const p = v.project?.eventCount ? v.project : null;

  const mix = p?.byType
    ? EVENT_LABELS.map((l) => ({ l, n: p.byType[l] ?? 0 })).filter((x) => x.n > 0)
    : [];
  const total = mix.reduce((sum, x) => sum + x.n, 0) || 1;

  return (
    <motion.button
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => onOpen(v)}
      className="group grid w-full grid-cols-[20px_minmax(0,1fr)_110px_84px_92px_136px_20px] items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.04]"
    >
      <Icon size={15} className={`shrink-0 ${s.tone}`} title={s.label} />

      <span className="min-w-0">
        <span className="block truncate font-mono text-xs text-ink-100">{v.name}</span>
        {v.proxy === 'encoding' ? (
          <span className="block truncate text-2xs text-pitch-400">preparing playback…</span>
        ) : v.proxy === 'needed' ? (
          <span className="block truncate text-2xs text-amber-400" title="This clip's codec can't be shown by a browser — it will be converted when opened">needs converting</span>
        ) : v.proxy === 'failed' ? (
          <span className="block truncate text-2xs text-avoid-500">conversion failed</span>
        ) : v.proxy === 'unavailable' ? (
          <span className="block truncate text-2xs text-ink-600" title="Install ffmpeg on the host to convert HEVC/Veo clips">codec may need ffmpeg</span>
        ) : p && (
          <span className="block truncate text-2xs text-ink-500">
            {p.updatedAt ? `edited ${relativeTime(p.updatedAt)}` : ''}
          </span>
        )}
      </span>

      <span className="min-w-0">
        {v.assignedTo ? (
          <span className="truncate text-2xs text-ink-300" title={`Assigned to ${v.assignedTo}`}>
            {v.assignedTo}
          </span>
        ) : (
          <span className="text-2xs text-ink-600">unassigned</span>
        )}
      </span>

      <span className="text-right font-mono text-2xs text-ink-500 tabular">{bytes(v.size)}</span>

      <span className="text-right font-mono text-xs tabular">
        {p ? <span className="text-pitch-400">{p.eventCount}</span> : <span className="text-ink-600">—</span>}
      </span>

      {/* Label mix, so a finished clip shows its shape at a glance */}
      <span className="flex h-1.5 gap-px overflow-hidden rounded-full bg-ink-800">
        {mix.map(({ l, n }) => (
          <span
            key={l}
            title={`${labelTitle(l)}: ${n}`}
            style={{ width: `${(n / total) * 100}%`, background: LABEL_META[l].color }}
          />
        ))}
      </span>

      <span className="relative flex items-center justify-end">
        <ArrowRight size={14} className="text-ink-700 transition group-hover:opacity-0" />
        <span
          role="button"
          tabIndex={-1}
          title={`Remove ${v.name}`}
          onClick={(e) => { e.stopPropagation(); onDelete(v); }}
          className="absolute inset-y-0 right-0 grid place-items-center rounded p-1 text-ink-600 opacity-0 transition hover:bg-avoid-500/15 hover:text-avoid-500 group-hover:opacity-100"
        >
          <Trash2 size={14} />
        </span>
      </span>
    </motion.button>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const openTask = useStore((s) => s.openTask);
  const toast = useStore((s) => s.toast);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null); // {name, pct} while importing
  const fileInput = useRef(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [opening, setOpening] = useState(null);
  const pageSize = useStore((s) => s.settings.pageSize) || 50;

  /**
   * The page lives in the URL, not in component state.
   *
   * That is what makes it survive a refresh — the address is unchanged, so the
   * same page comes back. Opening a clip and returning navigates to a fresh
   * address with no page param, which resets to the first page, exactly as
   * asked for.
   */
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const setPage = (n) => {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete('page');
    else next.set('page', String(n));
    setParams(next, { replace: true });
  };

  const deleteVideo = async (v) => {
    const labeled = v.project?.eventCount ? ` and its ${v.project.eventCount} saved action${v.project.eventCount === 1 ? '' : 's'}` : '';
    if (!window.confirm(`Remove ${v.name}${labeled}? This deletes the video file and its ground truth for everyone.`)) return;
    try {
      await api.deleteVideo(v.name);
      toast(`Removed ${v.name}`, 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const importVideo = async (file) => {
    if (!file) return;
    if (!/\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name)) return toast('Pick a video file (mp4, webm, mov, mkv)', 'error');
    setUploading({ name: file.name, pct: 0 });
    try {
      await api.uploadVideo(file, (f) => setUploading({ name: file.name, pct: Math.round(f * 100) }));
      toast(`Imported ${file.name}`, 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.listVideos());
    } catch (err) {
      // A 401 already routes to sign-in; a toast on top is just noise.
      if (!err.silent && err.status !== 401) toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const list = data?.videos ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((v) => {
      if (status !== 'all' && v.status !== status) return false;
      if (q && !v.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, query, status]);

  const open = async (v) => {
    setOpening(v.name);
    try {
      const project = await openTask(v.name);
      navigate(`/p/${project.id}/annotate`);
    } catch (err) {
      toast(err.message, 'error');
      setOpening(null);
    }
  };

  /** The point of a queue: skip the picker and go straight to the next clip. */
  const openNext = () => {
    const next = (data?.videos ?? []).find((v) => v.status === 'todo');
    if (next) open(next);
    else toast('Every clip has ground truth', 'success');
  };

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  // A filter can shrink the list under the current page; fall back to the last.
  const safePage = Math.min(page, pageCount);
  const pageItems = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

  const s = data?.summary;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-pitch-500/25 bg-pitch-500/[0.08] px-3 py-1">
              <ShieldCheck size={12} className="text-pitch-400" />
              <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-pitch-400">
                15-label football taxonomy
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Clips to label</h1>
            {data?.dir && (
              <p className="mt-1 flex items-center gap-1.5 font-mono text-2xs text-ink-500">
                <FolderOpen size={11} />
                {data.dir}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => fileInput.current?.click()} disabled={!!uploading} className="btn-ghost text-xs" title="Add a video to the shared folder">
              {uploading ? <><Loader2 size={15} className="animate-spin" /> {uploading.pct}%</> : <><Upload size={15} /> Import video</>}
            </button>
            <button onClick={load} className="btn-ghost px-2.5 py-2" title="Rescan the video folder">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <input ref={fileInput} type="file" accept="video/*,.mp4,.webm,.mov,.mkv,.m4v" className="hidden"
              onChange={(e) => { importVideo(e.target.files[0]); e.target.value = ''; }} />
            <button onClick={openNext} disabled={!s || s.total === 0} className="btn-primary text-xs">
              Next unlabelled <ArrowRight size={14} />
            </button>
          </div>
        </header>

        {/* Progress across the corpus, doubling as the status filter */}
        {s && (
          <div className="mb-5 flex gap-2">
            <StatTile label="Clips" value={s.total} tone="text-white" active={status === 'all'} onClick={() => { setStatus('all'); setPage(1); }} />
            <StatTile label="Not started" value={s.todo} tone="text-ink-300" active={status === 'todo'} onClick={() => { setStatus('todo'); setPage(1); }} />
            <StatTile label="Annotated" value={s.done} tone="text-pitch-400" active={status === 'done'} onClick={() => { setStatus('done'); setPage(1); }} />
          </div>
        )}

        <div className="panel flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-white/[0.06] p-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={`Search ${s?.total ?? ''} clips by filename…`}
                className="field py-2 pl-9 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-[20px_minmax(0,1fr)_110px_84px_92px_136px_20px] gap-3 border-b border-white/[0.06] px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-600">
            <span />
            <span>Clip</span>
            <span>Assigned to</span>
            <span className="text-right">Size</span>
            <span className="text-right">Actions</span>
            <span>Label mix</span>
            <span />
          </div>

          <div className="max-h-[52vh] overflow-y-auto p-1.5">
            {loading ? (
              <div className="space-y-1.5 p-1.5">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="skeleton h-10 rounded-lg" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <Film size={24} className="mb-3 text-ink-600" />
                <p className="text-xs font-medium text-ink-300">
                  {data?.videos?.length ? 'No clip matches' : 'No videos found'}
                </p>
                <p className="mt-1 font-mono text-2xs text-ink-600">{data?.dir}</p>
              </div>
            ) : (
              pageItems.map((v) => <TaskRow key={v.name} v={v} onOpen={open} onDelete={deleteVideo} />)
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-3 py-2 text-2xs text-ink-500">
            <span>
              <span className="font-mono text-ink-200">
                {visible.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, visible.length)}
              </span>{' '}
              of <span className="font-mono text-ink-200">{visible.length}</span>
            </span>
            {opening && <span className="text-pitch-400">opening {opening}…</span>}

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                className="rounded-md p-1 text-ink-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                title="Previous page"
              >
                <ChevronLeft size={14} />
              </button>

              <input
                type="number"
                min={1}
                max={pageCount}
                value={safePage}
                onChange={(e) => setPage(Math.min(pageCount, Math.max(1, Number(e.target.value) || 1)))}
                className="w-12 rounded-md border border-white/10 bg-ink-900/80 py-0.5 text-center font-mono text-2xs text-ink-100 tabular"
              />
              <span className="font-mono text-ink-600">/ {pageCount}</span>

              <button
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= pageCount}
                className="rounded-md p-1 text-ink-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
