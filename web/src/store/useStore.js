import { create } from 'zustand';
import { api, getToken, setToken, setUnauthorizedHandler } from '../lib/api';
import { EVENT_LABELS, LABEL_META } from '../lib/labels';
import { saveVideo, loadVideo } from '../lib/db';

const SETTINGS_KEY = 'scoregt.settings';

// Bumped whenever the defaults below change meaningfully, so an existing
// browser picks up the new tuning instead of silently keeping the old one.
const SETTINGS_VERSION = 4;

/** Manual annotation only — no model, no sampling, no key. */
const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  // One frame at the 25 fps reporting clock.
  nudgeStep: 0.04,
  seekStep: 1,
  pageSize: 50,
  autoAccept: true,
};

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    // Settings from the extraction era carry keys that no longer mean anything.
    // Drop them, keeping only the preference that still applies.
    if ((stored.version ?? 0) < SETTINGS_VERSION) {
      const migrated = { ...DEFAULT_SETTINGS, pageSize: stored.pageSize ?? DEFAULT_SETTINGS.pageSize };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const uid = (p = 'evt') => `${p}_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-4)}`;
const sortEvents = (list) => [...list].sort((a, b) => a.timestamp - b.timestamp);

export const useStore = create((set, get) => ({
  // -------------------------------------------------------------------- auth
  user: null,
  authChecked: false,

  /** Restore a session on load; a dead token drops straight to sign-in. */
  restoreSession: async () => {
    setUnauthorizedHandler(() => {
      get().releaseVideo();
      set({ user: null, project: null, events: [] });
    });
    if (!getToken()) return set({ authChecked: true });
    try {
      const { user } = await api.me();
      set({ user, authChecked: true });
    } catch {
      setToken('');
      set({ user: null, authChecked: true });
    }
  },

  signIn: async (username, password) => {
    const { token, user } = await api.login(username, password);
    setToken(token);
    set({ user });
    return user;
  },

  signOut: () => {
    setToken('');
    get().releaseVideo();
    set({ user: null, project: null, events: [], projects: [] });
  },

  setUser: (user) => set({ user }),

  /** Lets the workspace put its own actions in the shell header. */
  headerDelete: null,
  setHeaderDelete: (fn) => set({ headerDelete: fn }),

  /**
   * The active key -> action map: whatever this user saved, with the built-in
   * default for any action they never rebound.
   */
  keyMap: () => {
    const custom = get().user?.hotkeys ?? {};
    const map = {};
    for (const label of EVENT_LABELS) {
      const key = (custom[label] ?? LABEL_META[label].key ?? '').toLowerCase();
      if (key) map[key] = label;
    }
    return map;
  },

  /** The reverse view, for showing an action's current key. */
  hotkeyFor: (label) => (get().user?.hotkeys?.[label] ?? LABEL_META[label]?.key ?? '').toLowerCase(),

  saveHotkeys: async (hotkeys) => {
    const { user } = await api.saveHotkeys(hotkeys);
    set({ user });
    return user;
  },

  // ---------------------------------------------------------------- settings
  settings: loadSettings(),
  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return { settings };
    }),

  // ---------------------------------------------------------------- projects
  projects: [],
  projectsLoading: false,
  loadProjects: async () => {
    set({ projectsLoading: true });
    try {
      const { projects } = await api.listProjects();
      set({ projects, projectsLoading: false });
    } catch (err) {
      set({ projectsLoading: false });
      get().toast(err.message, 'error');
    }
  },

  project: null,
  events: [],
  dirty: false,
  loadingProject: false,

  openProject: async (id) => {
    set({ loadingProject: true });
    try {
      const { project, saved } = await api.getProject(id);
      set({
        project,
        saved: Boolean(saved),
        events: sortEvents(project.events ?? []),
        dirty: false,
        past: [],
        future: [],
        selectedId: null,
        selectedIds: [],
        loadingProject: false,
      });
      // Prefer the clip served from the video folder — it needs no re-picking
      // and survives a different browser. Fall back to the IndexedDB copy for
      // videos that were dragged in by hand.
      const filename = project.video?.filename;
      if (filename) get().useServerVideo(filename);
      return project;
    } catch (err) {
      set({ loadingProject: false });
      get().toast(err.message, 'error');
      return null;
    }
  },

  createProject: async ({ name, video }) => {
    const { project } = await api.createProject({ name, video });
    set((s) => ({ projects: [{ ...project, eventCount: 0 }, ...s.projects] }));
    return project;
  },

  saveProject: async ({ silent = false } = {}) => {
    const { project, events } = get();
    if (!project) return;
    try {
      const res = await api.saveProject(project.id, { ...project, events });
      const stored = res.project;
      set({ project: stored, events: sortEvents(stored.events), dirty: false, saved: Boolean(res.saved) });
      if (!silent) {
        const f = res.groundTruthFile;
        get().toast(
          f ? `Saved ${f.count} actions to ${f.path.split('/').pop()}` : 'Ground truth saved',
          'success',
        );
      }
    } catch (err) {
      // Rethrow so callers that paid for this data can react, not just toast.
      get().toast(err.message, 'error');
      throw err;
    }
  },

  /**
   * Throw away this clip's ground truth entirely — the working record and the
   * delivered file. The clip itself is untouched and returns to the queue as
   * unannotated, so the work can simply be redone.
   */
  deleteCurrentProject: async () => {
    const { project } = get();
    if (!project) return null;
    const clip = project.video?.filename ?? null;
    await api.deleteProject(project.id);
    get().releaseVideo();
    set({ project: null, saved: false, events: [], past: [], future: [], selectedId: null, selectedIds: [], dirty: false });
    get().toast(clip ? `Ground truth for ${clip} deleted` : 'Ground truth deleted');
    return clip;
  },

  renameProject: (name) => set((s) => ({ project: s.project ? { ...s.project, name } : null, dirty: true })),

  removeProject: async (id) => {
    await api.deleteProject(id);
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },

  // ------------------------------------------------------------------- video
  videoFile: null,
  videoUrl: null,
  videoMeta: null,

  videoLoading: false,
  videoProgress: 0,

  /**
   * Download the clip in full, then hand the player a blob URL.
   *
   * Annotating means constant seeking, and a partially buffered file stalls on
   * every jump into new territory. Paying the download once up front buys a
   * timeline that never freezes afterwards.
   */
  /** Drops the current clip from the player. */
  releaseVideo: () => {
    get().videoAbort?.abort();
    const prev = get().videoUrl;
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    set({ videoUrl: null, videoFile: null, videoMeta: null, videoLoading: false, videoProgress: 0, videoAbort: null });
  },

  /**
   * Play the clip straight from the server over byte ranges.
   *
   * The browser is far better at this than we were: it seeks anywhere the
   * moment it is asked, fetching only the bytes for that position, and with
   * preload="auto" it still pulls the whole file down in the background — so
   * the clip ends up fully local without ever showing a half-present video.
   * `videoProgress` is what the element has actually buffered, not what some
   * separate download believes it has.
   */
  useServerVideo: (filename) => {
    const prev = get().videoUrl;
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    get().videoAbort?.abort();
    const controller = new AbortController();

    // No src yet: the video appears once its blob is fully downloaded, so that
    // scrubbing — the whole job — is instant from the first frame shown.
    set({
      videoFile: null,
      videoUrl: null,
      videoMeta: null,
      videoLoading: true,
      videoProgress: 0,
      videoAbort: controller,
      currentTime: 0,
      playing: false,
      seekRequest: null,
    });

    api
      .fetchVideoBlob(filename, (f) => { if (!controller.signal.aborted) set({ videoProgress: f }); }, controller.signal)
      .then((url) => {
        if (controller.signal.aborted) return URL.revokeObjectURL(url);
        set({ videoUrl: url, videoLoading: false, videoProgress: 1 });
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        set({ videoLoading: false });
        get().toast(err.message, 'error');
      });
  },

  /**
   * Buffering progress, reported by the video element itself.
   *
   * There used to be a second, parallel download here to force the whole clip
   * into cache. It doubled every annotator's bandwidth — the element caches
   * media separately from fetch(), so the same bytes came down twice — and on
   * a shared connection that is what made loading feel frozen. The element's
   * own range requests are enough: any timestamp is reachable immediately.
   */
  setBuffered: (fraction) => set({ videoProgress: fraction, videoLoading: fraction < 0.995 }),




  /** Open a clip from the task list: find or create its ground truth, attach it. */
  /**
   * Save this clip, then move straight on to the next one in the queue.
   *
   * The whole job is a loop of annotate -> save -> next, so the button that
   * ends one clip should open the following one. If the save fails nothing
   * moves; if this was the last clip the queue itself is the right place to
   * land.
   */
  saveAndAdvance: async (navigate) => {
    const clip = get().project?.video?.filename;
    try {
      await get().saveProject({ silent: true });
    } catch {
      return; // saveProject has already said what went wrong
    }
    const next = await get().nextClipAfter(clip);
    if (!next) {
      get().toast(`Saved ${clip} — that was the last clip in your queue`, 'success');
      return navigate('/');
    }
    try {
      const project = await get().openTask(next.name);
      get().toast(`Saved ${clip} → now on ${next.name}`, 'success');
      navigate(`/p/${project.id}/annotate`);
    } catch (err) {
      get().toast(err.message, 'error');
      navigate('/');
    }
  },

  /**
   * The clip that follows this one in the annotator's own queue.
   *
   * "Their queue" matters: /videos already returns only what a user may touch,
   * so an annotator advances through their assignment and never lands on
   * someone else's clip. Ordering is by name, which is the numbering.
   */
  nextClipAfter: async (filename) => {
    if (!filename) return null;
    try {
      const { videos } = await api.listVideos();
      const list = [...videos].sort((a, b) => a.name.localeCompare(b.name));
      const i = list.findIndex((v) => v.name === filename);
      return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
    } catch {
      return null;
    }
  },

  openTask: async (name) => {
    const { project } = await api.openVideo(name);
    set({
      project,
      events: sortEvents(project.events ?? []),
      dirty: false,
      past: [],
      future: [],
      selectedId: null,
    });
    get().useServerVideo(name);
    return project;
  },

  attachVideo: (file, { silent = false } = {}) => {
    // A hand-attached file replaces whatever the server download was doing.
    get().releaseVideo();
    const prev = get().videoUrl;
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(file);
    set({ videoFile: file, videoUrl: url, videoMeta: null });
    const { project } = get();
    if (project) saveVideo(project.id, file);
    if (!silent) get().toast(`${file.name} attached`, 'success');
  },

  setVideoMeta: (meta) => {
    set((s) => ({
      videoMeta: meta,
      project: s.project
        ? {
            ...s.project,
            video: { ...s.project.video, ...meta, filename: s.videoFile?.name ?? s.project.video?.filename },
          }
        : null,
    }));
  },

  // -------------------------------------------------------------- playback
  currentTime: 0,
  playing: false,
  playbackRate: 1,
  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (p) => set({ playing: p }),
  setPlaybackRate: (r) => set({ playbackRate: r }),
  seekRequest: null,
  /**
   * `scrub` marks a seek as part of a drag. Those use fastSeek() so the picture
   * keeps up with the pointer; the precise seek happens when the drag ends.
   */
  seek: (t, { scrub = false } = {}) =>
    set({ seekRequest: { t: Math.max(0, t), scrub, n: Math.random() }, currentTime: Math.max(0, t) }),

  // ---------------------------------------------------------- event editing
  /**
   * Whether this clip's ground truth is on disk — the working record and the
   * deliverable both. Drives whether Delete has anything to remove.
   */
  saved: false,

  selectedId: null,
  /**
   * Shift-dragging the timeline picks a span of events. The single selection
   * drives the inspector; a span drives bulk actions. They are mutually
   * exclusive — entering one clears the other — so a delete is never ambiguous
   * about what it is about to remove.
   */
  selectedIds: [],
  select: (id) => set({ selectedId: id, selectedIds: [] }),
  selectRange: (ids) => set({ selectedIds: ids, selectedId: null }),
  clearSelection: () => set({ selectedId: null, selectedIds: [] }),
  past: [],
  future: [],

  /** Every mutation funnels through here so undo/redo can never miss one. */
  commit: (nextEvents, { label = 'edit' } = {}) =>
    set((s) => ({
      past: [...s.past.slice(-49), { events: s.events, label }],
      future: [],
      events: sortEvents(nextEvents),
      dirty: true,
    })),

  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        future: [{ events: s.events, label: prev.label }, ...s.future.slice(0, 49)],
        events: prev.events,
        dirty: true,
      };
    }),

  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return {
        future: s.future.slice(1),
        past: [...s.past, { events: s.events, label: next.label }],
        events: next.events,
        dirty: true,
      };
    }),

  addEvent: (type, timestamp, extra = {}) => {
    const ev = {
      id: uid(),
      type,
      timestamp: Number(Number(timestamp).toFixed(3)),
      endTimestamp: null,
      team: null,
      player: null,
      confidence: 1,
      source: 'human',
      status: 'accepted',
      description: '',
      agreement: 1,
      ...extra,
    };
    get().commit([...get().events, ev], { label: `add ${type}` });
    set({ selectedId: ev.id });
    return ev;
  },

  updateEvent: (id, patch) =>
    get().commit(
      get().events.map((e) =>
        e.id === id
          ? { ...e, ...patch, status: patch.status ?? (e.source === 'ai' && e.status === 'pending' ? 'edited' : e.status) }
          : e,
      ),
      { label: 'update' },
    ),

  deleteEvent: (id) => {
    const { events, selectedId } = get();
    get().commit(events.filter((e) => e.id !== id), { label: 'delete' });
    if (selectedId === id) set({ selectedId: null });
  },

  /** Removes whatever is selected — a span if there is one, else the one event. */
  deleteSelection: () => {
    const { events, selectedIds, selectedId } = get();
    const doomed = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []);
    if (!doomed.size) return 0;
    get().commit(events.filter((e) => !doomed.has(e.id)), {
      label: doomed.size > 1 ? `delete ${doomed.size} events` : 'delete',
    });
    set({ selectedId: null, selectedIds: [] });
    return doomed.size;
  },

  setStatus: (id, status) => get().commit(get().events.map((e) => (e.id === id ? { ...e, status } : e)), { label: status }),

  nudge: (id, delta) =>
    get().commit(
      get().events.map((e) =>
        e.id === id ? { ...e, timestamp: Math.max(0, Number((e.timestamp + delta).toFixed(3))) } : e,
      ),
      { label: 'nudge' },
    ),

  acceptAll: () =>
    get().commit(
      get().events.map((e) => (e.status === 'pending' ? { ...e, status: 'accepted' } : e)),
      { label: 'accept all' },
    ),

  replaceEvents: (events, label = 'import') => get().commit(events, { label }),

  // ------------------------------------------------------------------ toasts
  toasts: [],
  toast: (message, kind = 'info') => {
    const id = uid('t');
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export { DEFAULT_SETTINGS, uid };
