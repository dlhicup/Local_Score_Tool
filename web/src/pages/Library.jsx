import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Search, CheckCircle2, Circle, Film,
  ArrowRight, FolderOpen, RefreshCw, ShieldCheck, ChevronLeft, ChevronRight, Upload, Loader2, Trash2,
  Download, EyeOff,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { api } from '../lib/api';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';
import { bytes, relativeTime } from '../lib/format';
import { saveQueue } from '../lib/queue';
import { FILTER_PARAMS, recallLibraryFilters, rememberLibraryFilters } from '../lib/libraryFilters';



/**
 * A clip's type is the folder it sits in under video/ — "Full match",
 * "30s clips", "gt", or whatever folders exist. The filter offers exactly the
 * folders there are, so a new folder is a new filter with nothing to change.
 * A clip loose at the top of video/ has no type and shows as Unsorted.
 */
const UNSORTED = '__none__';
const typeOf = (v) => v.category || UNSORTED;
const typeLabel = (key) => (key === UNSORTED ? 'Unsorted' : key);

/**
 * A colour per folder, from its name, so a folder keeps its colour as others
 * come and go: the dot beside it in the Type filter and under each clip.
 */
const DOTS = ['bg-sky-400', 'bg-violet-400', 'bg-teal-400', 'bg-fuchsia-400', 'bg-indigo-400', 'bg-cyan-400'];
function tintIndex(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % DOTS.length;
}
function typeDot(key) {
  return key === UNSORTED ? 'bg-ink-500' : DOTS[tintIndex(key)];
}

/**
 * Where a clip is in the two-step review. Only a clip with labels has a place
 * in it at all: one with none has nothing to review, and showing it under
 * "needs 1st review" would bury the clips that actually do.
 *
 * A clip a reviewer set aside as too poor to work on is out of the review
 * altogether, whatever its marks say, and listed under Ignored instead.
 */
const REVIEW_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'need1', label: 'Needs 1st review' },
  { key: 'need2', label: 'Needs 2nd review' },
  { key: 'done', label: 'Both passed' },
  { key: 'ignored', label: 'Ignored' },
];
function reviewBucket(v) {
  if (v.project?.ignored) return 'ignored';
  if (!v.project?.eventCount) return null;
  const level = v.project.reviewLevel ?? 0;
  return level === 0 ? 'need1' : level === 1 ? 'need2' : 'done';
}

/**
 * One grid for the head and every row, written out in full so Tailwind sees
 * the class — a class built from pieces at runtime is never generated.
 */
const GRID = 'grid-cols-[minmax(0,1fr)_168px_148px_284px]';

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
/**
 * The two review boxes. A passed box is filled, and clicking it takes that
 * review off again, after asking. The review due next is outlined in amber, so
 * what is waiting stands out; one that cannot happen yet stays faint. Beside
 * them, the same words the Review filter uses.
 */
function ReviewBoxes({ v, p, onClear, onUnignore }) {
  const level = p?.reviewLevel ?? 0;
  const stamps = [p?.firstReview ?? null, p?.secondReview ?? null];
  const words = !p ? null : level === 0 ? 'Needs 1st' : level === 1 ? 'Needs 2nd' : 'Both passed';
  // Set aside as too poor to work on: the marks are kept but faded, and
  // "Ignored" stands where the words would, putting it back when clicked.
  const ignored = v.project?.ignored ?? null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`flex shrink-0 items-center gap-[3px] ${ignored ? 'opacity-40' : ''}`}>
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
          const due = Boolean(p) && n === level + 1;
          return (
            <span
              key={n}
              title={!p ? 'Nothing to review: this clip has no labels' : due ? `${name}: due next` : '2nd review comes after the 1st'}
              className={`${box} border ${due ? 'border-amber-400/60 text-amber-400' : 'border-white/[0.08] text-ink-600'}`}
            >
              {n}
            </span>
          );
        })}
      </span>
      {ignored ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUnignore(v); }}
          title={`Ignored: ${ignored.reason || 'no reason given'}${ignored.at ? `, ${relativeTime(ignored.at)}` : ''}${ignored.by ? ` by ${ignored.by}` : ''}. Click to put it back in the review lists.`}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-2xs font-medium text-rose-300 transition hover:bg-rose-500/15"
        >
          <EyeOff size={11} className="shrink-0" />
          <span className="truncate">Ignored</span>
        </button>
      ) : (
        words && <span className={`truncate text-2xs ${level === 2 ? 'text-pitch-400' : 'text-ink-300'}`}>{words}</span>
      )}
    </span>
  );
}

/** A clip's playback state while it is not plain browser video yet. */
const PROXY_NOTE = {
  encoding: { text: 'preparing playback…', tone: 'text-pitch-400' },
  needed: { text: 'needs converting', tone: 'text-amber-400', title: "This clip's codec can't be shown by a browser — it will be converted when opened" },
  failed: { text: 'conversion failed', tone: 'text-avoid-500' },
  unavailable: { text: 'codec may need ffmpeg', tone: 'text-ink-400', title: 'Install ffmpeg on the host to convert HEVC/Veo clips' },
};

/**
 * One clip, in four columns: what it is, what is on it, where its review
 * stands, and the ways to open it or take its files. Everything else about it,
 * its type, size, when it was edited and who has it, is one quiet line under
 * the name, so the columns hold only what changes from row to row.
 */
function TaskRow({ v, onOpen, onDelete, onClearReviewed, onUnignore }) {
  const type = typeOf(v);
  // A project with no events is not "0% reviewed" — there is nothing to review
  // yet. Treat it as untouched everywhere it shows up.
  const p = v.project?.eventCount ? v.project : null;
  // Which of the two reviews the clip has passed: 0, 1 or 2.
  const level = p?.reviewLevel ?? 0;
  // How many reviews this clip has been through: whether there is a log.
  const reviewCount = p?.reviewCount ?? 0;
  // Clicking the row opens a clip that already has actions for review, so
  // whatever gets corrected is recorded; one with none opens to annotate.
  // The two buttons still choose either way.
  const rowMode = p ? 'review' : 'annotate';
  const note = PROXY_NOTE[v.proxy];

  const mix = p?.byType
    ? EVENT_LABELS.map((l) => ({ l, n: p.byType[l] ?? 0 })).filter((x) => x.n > 0)
    : [];
  const total = mix.reduce((sum, x) => sum + x.n, 0) || 1;

  const half = 'px-2.5 py-1 text-2xs font-semibold transition';
  const fileLink = 'flex items-center gap-1 rounded px-1.5 py-1 text-2xs font-medium text-ink-400 transition hover:bg-white/[0.06] hover:text-white';

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="button"
      tabIndex={0}
      title={p ? 'Open for review' : 'Open to annotate'}
      onClick={() => onOpen(v, rowMode)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(v, rowMode); }
      }}
      className={`group grid w-full cursor-pointer ${GRID} items-center gap-4 px-4 py-2 text-left transition hover:bg-white/[0.03] focus-visible:bg-white/[0.05] focus-visible:shadow-[inset_2px_0_0_0_rgba(34,227,125,.7)] focus-visible:outline-none`}
    >
      {/* The clip, and one line about it */}
      <span className="min-w-0">
        <span title={v.name} className="block truncate font-mono text-[13px] text-ink-100">{v.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-ink-400">
          {note && (
            <>
              <span title={note.title} className={`shrink-0 ${note.tone}`}>{note.text}</span>
              <span className="text-ink-600">·</span>
            </>
          )}
          <span
            title={type === UNSORTED ? 'Not in a folder: loose at the top of video/' : `video/${type}/`}
            className="flex shrink-0 items-center gap-1.5"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${typeDot(type)}`} />
            {typeLabel(type)}
          </span>
          <span className="text-ink-600">·</span>
          <span className="shrink-0">{bytes(v.size)}</span>
          {p?.updatedAt && (
            <>
              <span className="text-ink-600">·</span>
              <span className="truncate">edited {relativeTime(p.updatedAt)}</span>
            </>
          )}
          {v.assignedTo && (
            <>
              <span className="text-ink-600">·</span>
              <span className="truncate text-ink-300" title={`Assigned to ${v.assignedTo}`}>{v.assignedTo}</span>
            </>
          )}
          {v.project?.ignored && (
            <>
              <span className="text-ink-600">·</span>
              <span className="truncate text-rose-300/80">ignored: {v.project.ignored.reason || 'no reason given'}</span>
            </>
          )}
        </span>
      </span>

      {/* How many actions, and their mix, so a finished clip shows its shape at a glance */}
      <span className="flex items-center gap-2.5">
        <span className={`w-9 shrink-0 text-right font-mono text-xs font-semibold tabular ${p ? 'text-ink-100' : 'text-ink-600'}`}>
          {p ? p.eventCount : '—'}
        </span>
        {/* No bar at all without labels: an empty one reads as "0%". */}
        {p && (
          <span className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full bg-white/[0.06]">
            {mix.map(({ l, n }) => (
              <span
                key={l}
                title={`${labelTitle(l)}: ${n}`}
                style={{ width: `${(n / total) * 100}%`, background: LABEL_META[l].color }}
              />
            ))}
          </span>
        )}
      </span>

      {/* Where its review stands */}
      <ReviewBoxes v={v} p={p} onClear={onClearReviewed} onUnignore={onUnignore} />

      {/* Open it either way, take its files, or remove it */}
      <span className="flex items-center gap-1">
        {/* Two ways in, as one control. Review is for correcting a clip that is
            already labeled, and records what it changed, so it is disabled
            until there are labels. The half a row click would take is the
            brighter one. */}
        <span className="inline-flex shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
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
            className={`${half} hover:bg-amber-500/15 hover:text-amber-300 disabled:cursor-not-allowed disabled:text-ink-600 disabled:hover:bg-transparent ${
              rowMode === 'review' ? 'text-white' : 'text-ink-300'
            }`}
          >
            Review
          </button>
          <span className="w-px bg-white/10" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(v, 'annotate'); }}
            title={p ? 'Open for annotating' : 'Start labelling this clip'}
            className={`${half} hover:bg-pitch-500/15 hover:text-pitch-400 ${rowMode === 'annotate' ? 'text-white' : 'text-ink-300'}`}
          >
            Annotate
          </button>
        </span>

        {/* Its files, without opening it: the label file exactly as it sits in
            groundtruth/, and the review log in plain text, written to be read.
            Links rather than buttons so the browser saves them, and
            stopPropagation because the row itself opens the clip. Each keeps
            its place when there is nothing to offer, so they line up. */}
        <span className="ml-1.5 flex w-[60px] shrink-0">
          {p && (
            <a
              href={api.labelFileUrl(p.id)}
              download
              onClick={(e) => e.stopPropagation()}
              title={`Download the label file for ${v.name}: ${p.eventCount} action${p.eventCount === 1 ? '' : 's'}, as saved`}
              className={fileLink}
            >
              <Download size={11} /> Labels
            </a>
          )}
        </span>
        <span className="flex w-[46px] shrink-0">
          {reviewCount > 0 && (
            <a
              href={api.reviewLogUrl({ clip: v.name, format: 'txt' })}
              download
              onClick={(e) => e.stopPropagation()}
              title={`Download the review log for ${v.name}: ${reviewCount} review${reviewCount === 1 ? '' : 's'}, written out in full`}
              className={fileLink}
            >
              <Download size={11} /> Log
            </a>
          )}
        </span>

        <button
          type="button"
          tabIndex={-1}
          title={`Remove ${v.name}`}
          onClick={(e) => { e.stopPropagation(); onDelete(v); }}
          className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded text-ink-500 opacity-0 transition hover:bg-avoid-500/15 hover:text-avoid-500 group-hover:opacity-100"
        >
          <Trash2 size={14} />
        </button>
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

  /** Put an ignored clip back in the review lists, from its row. */
  const unignore = async (v) => {
    const why = v.project?.ignored?.reason;
    if (!window.confirm(`Put ${v.name} back in the review lists?${why ? ` It was ignored for: ${why}.` : ''} Its actions and review marks are as they were.`)) return;
    try {
      await api.unignoreClip(v.project.id);
      toast(`${v.name} is back in the review lists`, 'success');
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
    const rev = { all: inCategory.length, need1: 0, need2: 0, done: 0, ignored: 0 };
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
   * `annotate` opens it with none. Clicking the row itself reviews a clip that
   * already has actions and annotates one that has none.
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
    const next = inCategory.find((v) => v.status === 'todo' && !v.project?.ignored);
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
                  mark: f.key === 'all'
                    ? null
                    : f.key === 'ignored'
                      ? <EyeOff size={11} className="text-rose-300" />
                      : <MiniBoxes level={{ need1: 0, need2: 1, done: 2 }[f.key]} />,
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
                <div className="min-w-[880px]">
                {/* The head sits inside the rows' own scroller, held at the top.
                    Outside it, the rows' scrollbar made them narrower than the head
                    and every column sat a scrollbar's width left of its name. */}
                <div className="max-h-[64vh] overflow-y-auto">
                <div className={`sticky top-0 z-10 grid ${GRID} gap-4 border-b border-white/[0.06] bg-ink-850 px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-400`}>
                  <span>Clip</span>
                  <span>Actions</span>
                  <span>Review</span>
                  <span>Open</span>
                </div>

                <div className="divide-y divide-white/[0.04]">
                  {loading ? (
                    <div className="space-y-1.5 p-3">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div key={i} className="skeleton h-11 rounded-lg" />
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
                        <TaskRow key={v.name} v={v} onOpen={open} onDelete={deleteVideo} onClearReviewed={clearReviewed} onUnignore={unignore} />
                      ))
                  )}
                </div>
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
