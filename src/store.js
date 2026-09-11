import { create } from 'zustand';
import { EVENT_LABELS, isValidLabel } from './lib/labels';
import { toFrame, toSeconds, REPORTING_FPS } from './lib/fps';

const uid = () => 'e' + Math.random().toString(36).slice(2, 10);
const sortEvents = (list) => [...list].sort((a, b) => a.t - b.t);

/**
 * All state for the local annotator. There is no server: the video is a local
 * object URL, and ground truth is written to disk from the browser. Timestamps
 * in seconds are the source of truth; frame numbers are derived only on save.
 */
export const useStore = create((set, get) => ({
  // -------- clip
  fileName: null,
  videoUrl: null,
  duration: 0,
  currentTime: 0,
  playing: false,
  seekReq: null, // {t, exact, n} — VideoStage applies then clears

  // -------- annotations
  events: [],
  selectedIds: [],
  past: [],
  future: [],
  dirty: false,

  // -------- ui
  menu: null, // {x, y, t}
  showHelp: false,
  dirName: null, // chosen output folder label

  // -------- clip lifecycle -------------------------------------------------
  openVideo: (file) => {
    const prev = get().videoUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      fileName: file.name,
      videoUrl: URL.createObjectURL(file),
      duration: 0,
      currentTime: 0,
      playing: false,
      seekReq: null,
      events: [],
      selectedIds: [],
      past: [],
      future: [],
      dirty: false,
      menu: null,
    });
  },
  setDuration: (d) => set({ duration: d || 0 }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (p) => set({ playing: p }),
  seek: (t) => set({ seekReq: { t: Math.max(0, t), exact: true, n: Math.random() }, currentTime: Math.max(0, t) }),
  clearSeek: () => set({ seekReq: null }),

  // -------- history --------------------------------------------------------
  commit: (nextEvents, { dirty = true } = {}) =>
    set((s) => ({
      past: [...s.past.slice(-79), s.events],
      future: [],
      events: sortEvents(nextEvents),
      dirty: dirty || s.dirty,
    })),
  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      return { past: s.past.slice(0, -1), future: [s.events, ...s.future.slice(0, 79)], events: s.past[s.past.length - 1], dirty: true, selectedIds: [] };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      return { future: s.future.slice(1), past: [...s.past, s.events], events: s.future[0], dirty: true, selectedIds: [] };
    }),

  // -------- editing --------------------------------------------------------
  addEvent: (type, t) => {
    if (!isValidLabel(type)) return null;
    const ev = { id: uid(), type, t: Number((Number(t) || 0).toFixed(3)) };
    get().commit([...get().events, ev]);
    set({ selectedIds: [ev.id] });
    return ev;
  },
  retimeEvent: (id, t) =>
    get().commit(get().events.map((e) => (e.id === id ? { ...e, t: Number(Math.max(0, t).toFixed(3)) } : e))),
  select: (id) => set({ selectedIds: id ? [id] : [] }),
  selectSpan: (a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    set({ selectedIds: get().events.filter((e) => e.t >= lo && e.t <= hi).map((e) => e.id) });
  },
  clearSelection: () => set({ selectedIds: [] }),
  deleteSelected: () => {
    const { events, selectedIds } = get();
    if (!selectedIds.length) return 0;
    const doomed = new Set(selectedIds);
    get().commit(events.filter((e) => !doomed.has(e.id)));
    set({ selectedIds: [] });
    return doomed.size;
  },

  // -------- menu / help ----------------------------------------------------
  openMenu: (x, y, t) => set({ menu: { x, y, t } }),
  closeMenu: () => set({ menu: null }),
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),

  // -------- ground truth ---------------------------------------------------
  /** The deliverable, byte-identical to the platform's gtfile.js output. */
  buildGroundTruth: () => {
    const rows = get()
      .events.filter((e) => isValidLabel(e.type))
      .map((e) => ({ frame: toFrame(e.t), action: e.type }))
      .sort((a, b) => a.frame - b.frame);
    return `{"groundtruth":[\n${rows.map((r) => '  ' + JSON.stringify(r)).join(',\n')}\n]}\n`;
  },
  gtFileName: () => (get().fileName || 'clip').replace(/\.[^.]+$/, '') + '.json',
  markSaved: () => set({ dirty: false }),

  /** Import an existing videoname.json to resume — frames back to seconds. */
  loadGroundTruth: (doc) => {
    const rows = Array.isArray(doc) ? doc : doc?.groundtruth ?? [];
    const events = rows
      .filter((r) => isValidLabel(r?.action))
      .map((r) => ({ id: uid(), type: r.action, t: Number((toSeconds(Number(r.frame) || 0)).toFixed(3)) }));
    set({ events: sortEvents(events), past: [], future: [], selectedIds: [], dirty: false });
    return events.length;
  },
}));

export { EVENT_LABELS, REPORTING_FPS };
