import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search, CheckCircle2, Circle, Film,
  ArrowRight, FolderOpen, RefreshCw, ShieldCheck, ChevronLeft, ChevronRight, Upload, Loader2, Trash2,
  Download,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { api } from '../lib/api';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';
import { bytes, relativeTime } from '../lib/format';
import { saveQueue } from '../lib/queue';
import { FILTER_PARAMS, recallLibraryFilters, rememberLibraryFilters } from '../lib/libraryFilters';


const STATUS = {
  todo: { label: 'Not started', icon: Circle, tone: 'text-ink-500' },
  done: { label: 'Has ground truth', icon: CheckCircle2, tone: 'text-pitch-400' },
};

/**
 * A clip's type is the folder it sits in under video/ — "Full match",
 * "30s clips", "gt", or whatever folders exist. The filter offers exactly the
 * folders there are, so a new folder is a new filter with nothing to change.
 * A clip loose at the top of video/ has no type and shows as Unsorted.
 */
const UNSORTED = '__none__';
const typeOf = (v) => v.category || UNSORTED;
const typeLabel = (key) => (key === UNSORTED ? 'Unsorted' : key);

/** A tint per folder, from its name, so a folder keeps its colour as others come and go. */
const TINTS = [
  'border-sky-500/30 bg-sky-500/10 text-sky-300',
  'border-violet-500/30 bg-violet-500/10 text-violet-300',
  'border-teal-500/30 bg-teal-500/10 text-teal-300',
  'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300',
  'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
];
const DOTS = ['bg-sky-400', 'bg-violet-400', 'bg-teal-400', 'bg-fuchsia-400', 'bg-indigo-400', 'bg-cyan-400'];
function tintIndex(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TINTS.length;
}
function typeTint(key) {
  return key === UNSORTED ? 'border-white/10 bg-white/[0.03] text-ink-500' : TINTS[tintIndex(key)];
}
/** The same colour as the folder's pill in the rows, as a dot for the filter. */
function typeDot(key) {
  return key === UNSORTED ? 'bg-ink-500' : DOTS[tintIndex(key)];
}

/**
 * Where a clip is in the two-step review. Only a clip with labels has a place
 * in it at all: one with none has nothing to review, and showing it under
 * "needs 1st review" would bury the clips that actually do.
 */
const REVIEW_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'need1', label: 'Needs 1st review' },
  { key: 'need2', label: 'Needs 2nd review' },
  { key: 'done', label: 'Both passed' },
];
function reviewBucket(v) {
  if (!v.project?.eventCount) return null;
  const level = v.project.reviewLevel ?? 0;
  return level === 0 ? 'need1' : level === 1 ? 'need2' : 'done';
}

/**
 * One grid for the head and every row, written out in full so Tailwind sees
 * the class — a class built from pieces at runtime is never generated.
 */
const GRID = 'grid-cols-[20px_minmax(0,1fr)_80px_88px_64px_56px_64px_248px_20px]';

/**
 * One group of the filter column: a title, then each choice as a full-width
 * row with how many clips it would show. The chosen one is lit. A `mark` is
 * whatever helps the eye find it — a folder's colour, a review box.
 */
function FilterGroup({ title, options, value, onChange }) {
  return (
    <section>
      <h3 className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wider text-ink-500">{title}</h3>
      <div className="space-y-0.5">
        {options.map((o) => {
          const on = value === o.key;
          return (
            <button
              key={o.key}
              onClick={() => onChange(o.key)}
              aria-pressed={on}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                on ? 'bg-pitch-500/[0.12] text-white' : 'text-ink-300 hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              {o.mark && <span className="flex w-5 shrink-0 justify-center">{o.mark}</span>}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <span className={`font-mono text-2xs tabular ${on ? 'text-pitch-400' : 'text-ink-500'}`}>{o.count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The two review boxes in miniature, so the Review filter reads like the rows. */
function MiniBoxes({ level }) {
  const box = 'h-2 w-2 rounded-[2px]';
  return (
    <span className="flex gap-[2px]">
      <span className={`${box} ${level >= 1 ? 'bg-pitch-500' : 'border border-white/25'}`} />
      <span className={`${box} ${level >= 2 ? 'bg-pitch-500' : 'border border-white/25'}`} />
    </span>
  );
}

/**
 * The two review stages as boxes. A passed one is filled, and clicking it
 * takes it off — the 1st takes the 2nd with it, since the 2nd cannot stand
 * alone. One not yet passed is an outline that only explains itself; it is
 * not a button, because there is nothing to click it for.
 */
function ReviewBoxes({ v, p, onClear }) {
  const level = p?.reviewLevel ?? 0;
  const stamps = [p?.firstReview ?? null, p?.secondReview ?? null];
  return (
    <span className="flex items-center gap-[3px]">
      {[1, 2].map((n) => {
        const name = n === 1 ? '1st review' : '2nd review';
        const box = 'grid h-[18px] w-[18px] place-items-center rounded font-mono text-[10px] font-bold';
        if (n <= level) {
          const at = stamps[n - 1]?.at;
          return (
            <button
              key={n}
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear(v, n); }}
              title={`${name} passed${at ? ` ${relativeTime(at)}` : ''} — click to take it off${n === 1 && level === 2 ? ' (the 2nd goes with it)' : ''}`}
              className={`${box} bg-pitch-500 text-ink-950 transition hover:bg-avoid-500 hover:text-white`}
            >
              {n}
            </button>
          );
        }
        const title = !p
          ? 'Nothing to review: this clip has no labels'
          : n === 2 && level === 0
            ? '2nd review comes after the 1st'
            : `${name} not passed yet`;
        const reachable = Boolean(p) && (n === 1 || level >= 1);
        return (
          <span key={n} title={title} className={`${box} border ${reachable ? 'border-white/20 text-ink-500' : 'border-white/[0.06] text-ink-700'}`}>
            {n}
          </span>
        );
      })}
    </span>
  );
}


function TaskRow({ v, onOpen, onDelete, onClearReviewed }) {
  const type = typeOf(v);
  const s = STATUS[v.status];
  const Icon = s.icon;
  // A project with no events is not "0% reviewed" — there is nothing to review
  // yet. Treat it as untouched everywhere it shows up.
  const p = v.project?.eventCount ? v.project : null;
  // Which of the two reviews the clip has passed: 0, 1 or 2.
  const level = p?.reviewLevel ?? 0;
  // How many reviews this clip has been through. Drives whether there is a
  // log to download for it at all.
  const reviewCount = p?.reviewCount ?? 0;

  const mix = p?.byType
    ? EVENT_LABELS.map((l) => ({ l, n: p.byType[l] ?? 0 })).filter((x) => x.n > 0)
    : [];
  const total = mix.reduce((sum, x) => sum + x.n, 0) || 1;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(v, 'annotate')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(v, 'annotate'); }
      }}
      className={`group grid w-full cursor-pointer ${GRID} items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.04]`}
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
        <span
          title={type === UNSORTED ? 'Not in a folder: loose at the top of video/' : `video/${type}/`}
          className={`block truncate rounded border px-1.5 py-0.5 text-center text-[10px] font-semibold ${typeTint(type)}`}
        >
          {typeLabel(type)}
        </span>
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

      {/* Two ways in. Review is for correcting a clip somebody has already
          labeled, and records what it changed, so there is nothing for it to do
          until there are labels — it stays disabled and says why. */}
      <span className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          disabled={!p}
          onClick={(e) => { e.stopPropagation(); onOpen(v, 'review'); }}
          title={
            !p
              ? 'Nothing to review yet: this clip has no labels'
              : level === 0
                ? `Open for its 1st review — ${p.eventCount} action${p.eventCount === 1 ? '' : 's'}, your changes recorded`
                : level === 1
                  ? 'Open for its 2nd review — your changes recorded'
                  : 'Both reviews passed — open to review it again'
          }
          className={`rounded-md border px-2 py-1 text-2xs font-semibold transition ${
            !p
              ? 'cursor-not-allowed border-white/[0.06] text-ink-700'
              : level === 2
                ? 'border-white/10 text-ink-300 hover:border-white/25 hover:text-white'
                : 'border-amber-500/40 bg-amber-500/[0.10] text-amber-400 hover:bg-amber-500/20'
          }`}
        >
          Review
        </button>
        <ReviewBoxes v={v} p={p} onClear={onClearReviewed} />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(v, 'annotate'); }}
          title={p ? 'Open for annotating' : 'Start labelling this clip'}
          className="rounded-md border border-pitch-500/40 bg-pitch-500/[0.10] px-2 py-1 text-2xs font-semibold text-pitch-400 transition hover:bg-pitch-500/20"
        >
          Annotate
        </button>

        {/* This clip's review log, without opening it. A link rather than a
            button so the browser downloads it; stopPropagation because the row
            itself opens the clip. Only offered where there is a log. */}
        {/* This clip's review log, without opening it. Plain text, because the
            log is written to be read; the header has the spreadsheet forms.
            A link rather than a button so the browser downloads it, and
            stopPropagation because the row itself opens the clip. */}
        {reviewCount > 0 ? (
          <a
            href={api.reviewLogUrl({ clip: v.name, format: 'txt' })}
            download
            onClick={(e) => e.stopPropagation()}
            title={`Download the review log for ${v.name}: ${reviewCount} review${reviewCount === 1 ? '' : 's'}, written out in full`}
            className="flex w-[46px] items-center justify-center gap-1 rounded-md border border-white/[0.07] py-1 text-2xs font-semibold text-ink-400 transition hover:border-pitch-500/40 hover:bg-pitch-500/10 hover:text-pitch-400"
          >
            <Download size={11} /> Log
          </a>
        ) : (
          <span
            title="No review log: this clip has not been reviewed yet"
            className="w-[46px] py-1 text-center text-2xs text-ink-700"
          >
            no log
          </span>
        )}
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
    </motion.div>
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
  const [query, setQuery] = useState(() => recallLibraryFilters().q ?? '');
  const [opening, setOpening] = useState(null);
  const pageSize = useStore((s) => s.settings.pageSize) || 50;

  /**
   * The page lives in the URL, not in component state.
   *
   * That is what makes it survive a refresh — the address is unchanged, so the
   * same page comes back. Coming back from a clip goes to an address with the
   * filters but no page param, so it starts again at the first page, as asked
   * for.
   */
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const setPage = (n) => {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete('page');
    else next.set('page', String(n));
    setParams(next, { replace: true });
  };

  // The filters live in the URL beside the page, for the same reason: a
  // refresh, or coming back from a clip, finds the list as it was left.
  const category = params.get('cat') || 'all';
  const review = REVIEW_FILTERS.some((f) => f.key === params.get('rev')) ? params.get('rev') : 'all';
  const status = ['todo', 'done'].includes(params.get('st')) ? params.get('st') : 'all';
  /** Change one filter; any change goes back to the first page. */
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    next.delete('page');
    setParams(next, { replace: true });
  };
  const setStatus = (v) => setFilter('st', v);

  const filtered = category !== 'all' || status !== 'all' || review !== 'all' || query.trim() !== '';
  const clearFilters = () => {
    setQuery('');
    const next = new URLSearchParams(params);
    for (const k of ['cat', 'st', 'rev', 'page']) next.delete(k);
    setParams(next, { replace: true });
  };

  /**
   * Remember the filters and the search for this tab, so every way back from
   * a clip finds them as they were left: the rail's Library link and the logo
   * carry them, and the browser's Back has them in the address.
   *
   * A Library opened at a bare address (typed in, or after a clip's ground
   * truth is deleted) takes the remembered ones; an address that names a
   * filter of its own is taken as it is. A plain effect, not a layout one: on
   * a fresh page load the router only starts listening after the layout
   * effects, and a change of address made before then would be lost.
   */
  const arrived = useRef(true);
  useEffect(() => {
    const first = arrived.current;
    arrived.current = false;
    if (first && !FILTER_PARAMS.some((k) => params.has(k))) {
      const saved = recallLibraryFilters();
      if (FILTER_PARAMS.some((k) => saved[k])) {
        const next = new URLSearchParams(params);
        for (const k of FILTER_PARAMS) if (saved[k]) next.set(k, saved[k]);
        next.delete('page');
        setParams(next, { replace: true });
        return; // remembered on the next pass, once the address has them
      }
    }
    rememberLibraryFilters({ cat: category, st: status, rev: review, q: query });
  }, [params, setParams, category, status, review, query]);

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

  /** Take a review mark off a clip from the list, without opening it. */
  const clearReviewed = async (v, stage) => {
    const both = stage === 1 && (v.project?.reviewLevel ?? 0) === 2;
    const what = both ? 'both review marks' : `the ${stage === 1 ? '1st' : '2nd'} review mark`;
    if (!window.confirm(`Take ${what} off ${v.name}? Its actions are not touched.`)) return;
    try {
      await api.clearReviewed(v.project.id, stage);
      toast(`Took ${what} off ${v.name}`, 'success');
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

  // How many reviews are on record across the corpus, so the download button
  // can say what it would give you — or say that there is nothing yet.
  const [logs, setLogs] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.listVideos());
      api.reviewLogSummary().then(setLogs).catch(() => setLogs(null));
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

  const all = data?.videos ?? [];

  // The category is the outermost choice, so every count below it is
  // counted within it: pick "30s clips" and "Needs 1st review" says how many
  // 30-second clips need one, which is the number that is actually useful.
  const inCategory = useMemo(
    () => (category === 'all' ? all : all.filter((v) => typeOf(v) === category)),
    [all, category],
  );

  // The folders there are, alphabetically, with Unsorted last.
  const types = useMemo(() => {
    const seen = [...new Set(all.map(typeOf))];
    return seen.filter((k) => k !== UNSORTED).sort((a, b) => a.localeCompare(b))
      .concat(seen.includes(UNSORTED) ? [UNSORTED] : []);
  }, [all]);

  const counts = useMemo(() => {
    const cat = { all: all.length };
    for (const v of all) cat[typeOf(v)] = (cat[typeOf(v)] ?? 0) + 1;
    const rev = { all: inCategory.length, need1: 0, need2: 0, done: 0 };
    const st = { all: inCategory.length, todo: 0, done: 0 };
    for (const v of inCategory) {
      const b = reviewBucket(v);
      if (b) rev[b] += 1;
      st[v.status] = (st[v.status] ?? 0) + 1;
    }
    return { cat, rev, st };
  }, [all, inCategory]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inCategory.filter((v) => {
      if (status !== 'all' && v.status !== status) return false;
      if (review !== 'all' && reviewBucket(v) !== review) return false;
      if (q && !v.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [inCategory, query, status, review]);

  /** What the list is, in words — shown beside Previous and Next in a clip. */
  const listLabel = [
    category === 'all' ? 'All clips' : typeLabel(category),
    review === 'all' ? null : REVIEW_FILTERS.find((f) => f.key === review).label.toLowerCase(),
    status === 'all' ? null : status === 'todo' ? 'not started' : 'annotated',
    query.trim() ? `matching "${query.trim()}"` : null,
  ].filter(Boolean).join(' · ');

  /**
   * `review` opens the same workspace with a record kept of what gets changed;
   * `annotate` opens it with none. Clicking the row itself annotates, which is
   * what it has always done.
   */
  const open = async (v, mode = 'annotate') => {
    // Previous and Next in the workspace walk exactly this list.
    saveQueue(visible, listLabel);
    setOpening(v.name);
    try {
      const project = await openTask(v.name);
      navigate(`/p/${project.id}/${mode === 'review' ? 'review' : 'annotate'}`);
    } catch (err) {
      toast(err.message, 'error');
      setOpening(null);
    }
  };

  /** The point of a queue: skip the picker and go straight to the next clip. */
  const openNext = () => {
    const next = inCategory.find((v) => v.status === 'todo');
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
      <div className="mx-auto max-w-7xl px-6 py-8">
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

            {/* Ground truth handed in for a clip that is not in video/. The
                work is on disk and would otherwise simply not appear, which
                is the one failure this layout exists to prevent. */}
            {data?.unmatched?.length > 0 && (
              <div className="mt-3 max-w-[60ch] rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2">
                <p className="text-2xs font-semibold text-amber-400">
                  {data.unmatched.length} ground-truth file{data.unmatched.length === 1 ? '' : 's'} with no matching clip
                </p>
                <p className="mt-0.5 text-2xs leading-snug text-ink-400">
                  Put the video in <span className="font-mono">video/</span> under the same name and it will appear here
                  with its actions.
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {data.unmatched.slice(0, 6).map((u) => (
                    <li key={u.rel} className="truncate font-mono text-2xs text-ink-500" title={u.rel}>
                      {u.rel}
                    </li>
                  ))}
                  {data.unmatched.length > 6 && (
                    <li className="text-2xs text-ink-600">…and {data.unmatched.length - 6} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* The review log, as a file. Plain links, so the browser downloads
                them the way it downloads anything else. Disabled rather than
                hidden when nothing has been reviewed yet: the absence of a
                control is not an answer to "where are the logs". */}
            <div
              className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5"
              title={
                logs?.reviews
                  ? `${logs.reviews} review${logs.reviews === 1 ? '' : 's'} across ${logs.clips} clip${logs.clips === 1 ? '' : 's'}`
                    + `${logs.changes ? `, ${logs.changes} recorded changes` : ''} — one row per change`
                  : 'No reviews recorded yet. Open a clip with Review, change something, and save.'
              }
            >
              <span className="pl-2 pr-1 text-2xs font-semibold uppercase tracking-wider text-ink-500">
                Review log
              </span>
              {logs?.reviews ? (
                <>
                  <a
                    href={api.reviewLogUrl({ format: 'zip' })}
                    download
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
                    title="One file per video, zipped: a readable .txt and a sortable .csv for each, plus an _index.csv listing what is inside"
                  >
                    <Download size={12} /> per video
                  </a>
                  <a
                    href={api.reviewLogUrl({ format: 'txt' })}
                    download
                    className="rounded-md px-2 py-1 text-2xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
                    title="Every clip's log written out as text, one file"
                  >
                    text
                  </a>
                  <a
                    href={api.reviewLogUrl({ format: 'csv' })}
                    download
                    className="rounded-md px-2 py-1 text-2xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
                    title="One spreadsheet for the whole corpus: every change, one row each, with the frame it happened on"
                  >
                    CSV
                  </a>
                  <a
                    href={api.reviewLogUrl({ format: 'json' })}
                    download
                    className="rounded-md px-2 py-1 text-2xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
                    title="The log exactly as the clip files store it"
                  >
                    JSON
                  </a>
                </>
              ) : (
                <span className="cursor-not-allowed px-2 py-1 text-2xs font-semibold text-ink-700">none yet</span>
              )}
            </div>

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

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* The filters, down the left. They combine, the type is the outermost
              choice, and every count under it is counted within it — so
              "30s clips" then "Needs 1st review" says how many of those there are.
              On a narrow window the three groups sit side by side above the list. */}
          {data && (
            <aside className="grid grid-cols-3 gap-4 lg:w-52 lg:shrink-0 lg:grid-cols-1 lg:gap-5">
              <FilterGroup
                title="Type"
                value={category}
                onChange={(v) => setFilter('cat', v)}
                options={[
                  { key: 'all', label: 'All clips', count: counts.cat.all },
                  ...types.map((k) => ({
                    key: k,
                    label: typeLabel(k),
                    count: counts.cat[k] ?? 0,
                    mark: <span className={`h-2 w-2 rounded-full ${typeDot(k)}`} />,
                  })),
                ]}
              />
              <FilterGroup
                title="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { key: 'all', label: 'All', count: counts.st.all },
                  { key: 'todo', label: 'Not started', count: counts.st.todo, mark: <Circle size={11} className="text-ink-500" /> },
                  { key: 'done', label: 'Annotated', count: counts.st.done, mark: <CheckCircle2 size={11} className="text-pitch-400" /> },
                ]}
              />
              <FilterGroup
                title="Review"
                value={review}
                onChange={(v) => setFilter('rev', v)}
                options={REVIEW_FILTERS.map((f) => ({
                  key: f.key,
                  label: f.label,
                  count: f.key === 'all' ? counts.rev.all : counts.rev[f.key],
                  mark: f.key === 'all' ? null : <MiniBoxes level={{ need1: 0, need2: 1, done: 2 }[f.key]} />,
                }))}
              />
              {filtered && (
                <button
                  onClick={clearFilters}
                  className="col-span-3 justify-self-start px-2 text-2xs text-ink-500 underline underline-offset-2 transition hover:text-ink-200 lg:col-span-1"
                >
                  Clear filters
                </button>
              )}
            </aside>
          )}

          <div className="min-w-0 flex-1">
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
                    placeholder={`Search ${inCategory.length} clips by filename…`}
                    className="field py-2 pl-9 text-xs"
                  />
                </div>
              </div>

              {/* One horizontal scroller around the head and the rows together, so
                  a narrow window scrolls them in step rather than collapsing the
                  clip name — the only column whose content cannot be guessed — to
                  nothing, and rather than clipping the buttons off the right. */}
              <div className="overflow-x-auto">
                <div className="min-w-[968px]">
                <div className={`grid ${GRID} gap-3 border-b border-white/[0.06] px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-600`}>
                  <span />
                  <span>Clip</span>
                  <span>Type</span>
                  <span>Assigned to</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Actions</span>
                  <span>Label mix</span>
                  <span className="text-right">Open</span>
                  <span />
                </div>

                <div className="max-h-[64vh] overflow-y-auto p-1.5">
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
                    pageItems.map((v) => (
                        <TaskRow key={v.name} v={v} onOpen={open} onDelete={deleteVideo} onClearReviewed={clearReviewed} />
                      ))
                  )}
                </div>
                </div>
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
      </div>
    </div>
  );
}
