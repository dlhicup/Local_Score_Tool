import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Keyboard, Download, Undo2, Redo2, Plus, AlertCircle,
} from 'lucide-react';
import VideoStage from '../components/VideoStage';
import Timeline from '../components/Timeline';
import Inspector from '../components/Inspector';
import KeyGuide from '../components/KeyGuide';
import ReviewChanges from '../components/ReviewChanges';
import Shortcuts from '../components/Shortcuts';
import ActionMenu from '../components/ActionMenu';
import ConfirmDelete from '../components/ConfirmDelete';
import { useStore } from '../store/useStore';
import { useHotkeys } from '../lib/useHotkeys';
import { labelTitle, UNSURE_KEY } from '../lib/labels';
import { frameStep, DEFAULT_FPS, REPORTING_FPS } from '../lib/fps';
import { startStepping, stopStepping, setStepListener, setStepRate } from '../lib/stepper';

const NEAR = 0.6; // seconds either side of the playhead counted as "now"

// Whether the key reference is open is a property of the browser, not of a
// clip or an account, so it lives in localStorage.
const KEYGUIDE_KEY = 'scoregt.keyguide';

// Timeline geometry, mirrored from Timeline.jsx so the workspace can give the
// strip exactly the height its lanes need. Keep in step with LANE_H/RULER_H.
const LANE_H = 24;
const RULER_H = 28;
const TIMELINE_CHROME = 39; // toolbar row + the panel's top and bottom borders
// How many lanes the strip makes room for before the lane area starts
// scrolling. Sizing it to every lane a clip uses made the strip 400px tall on a
// busy clip and squeezed the picture; the lane column already mirrors the
// track's vertical scroll, so the rest are a short scroll away.
const TIMELINE_VISIBLE_LANES = 6;
// Never shorter than this (the toolbar plus a lane or two still has to read),
// and never more than this share of the workspace, so the picture stays usable.
const TIMELINE_MIN = 130;
const TIMELINE_MAX_SHARE = '40%';

/**
 * The annotating workspace, in one of two modes.
 *
 * `review` opens somebody else's finished clip to be corrected, and keeps a
 * record of the correction: what was added, removed, retimed or marked unsure,
 * written into the clip's own file on save. `annotate` is the same workspace
 * with no record kept.
 */
export default function Review({ mode = 'annotate' }) {
  const { id } = useParams();
  const reviewing = mode === 'review';
  const opening = useRef(null);
  const navigate = useNavigate();
  const {
    project, openProject, events, videoUrl, attachVideo, currentTime, seek,
    selectedId, selectedIds, select, clearSelection, addEvent, deleteEvent, deleteSelection, nudge, undo, redo,
    saveProject, dirty, setPlaying, playing, setPlaybackRate, toast, setTag,
    past, future, loadingProject, settings, keyMap, setHeaderDelete,
    deleteCurrentProject, setReviewing,
  } = useStore();

  const step = settings.nudgeStep || frameStep(DEFAULT_FPS);
  const seekStep = settings.seekStep || 1;

  /**
   * Frame stepping is driven by the stepper, not by the keyboard. A held arrow
   * starts it on key-down and stops it on key-up; in between it shows one
   * frame, waits for that frame to be painted, and only then moves to the
   * next. Losing focus or hiding the tab has to stop it too: the key-up for a
   * key released in another window never arrives, and a stepper nobody is
   * holding would walk to the end of the clip.
   */
  useEffect(() => {
    setStepListener((t) => {
      const s = useStore.getState();
      s.setCurrentTime(t);
      if (s.playing) s.setPlaying(false);
    });
    const STEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', ',', '.']);
    const onUp = (e) => { if (STEP_KEYS.has(e.key)) stopStepping(e.key); };
    const onBlur = () => stopStepping();
    const onHide = () => { if (document.hidden) stopStepping(); };
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      stopStepping();
      setStepListener(null);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  // The pace a held arrow steps at is a preference, so it follows Settings.
  useEffect(() => {
    setStepRate(settings.holdStepFps);
  }, [settings.holdStepFps]);

  const [showKeys, setShowKeys] = useState(false);
  // The key reference beside the picture. Remembered per browser: an annotator
  // who knows the fifteen keys should not have to close it every session.
  const [keysOpen, setKeysOpen] = useState(() => {
    try { return localStorage.getItem(KEYGUIDE_KEY) !== 'closed'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEYGUIDE_KEY, keysOpen ? 'open' : 'closed'); } catch { /* storage blocked */ }
  }, [keysOpen]);
  const [menu, setMenu] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** Right-click anywhere in the workspace offers the action list. */
  // Stable identity, or it defeats the memo on Timeline every render.
  const openMenu = useCallback((e, atTime) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, atTime });
  }, []);

  useEffect(() => {
    // Skip while a delete is in flight: the project is already gone, and
    // re-fetching it would 404 and surface an error on the way out.
    if (deleting) return;
    if (project && project.id === id) return;
    if (opening.current === id) return; // one fetch per id, StrictMode included
    opening.current = id;
    openProject(id, { reviewing }).then((p) => {
      // The server resolves any id that names a real clip, so a failure here
      // means the URL points at nothing — go back to the queue rather than
      // leave an empty workspace sitting on a broken link.
      if (!p) navigate('/', { replace: true });
    });
  }, [id, project, openProject, deleting, navigate, reviewing]);

  /**
   * Switching between annotating and reviewing the same clip does not reload
   * it — the clip is already open, so only the mode changes, and with it the
   * baseline the review is measured against.
   */
  useEffect(() => {
    if (project && project.id === id) setReviewing(reviewing);
  }, [id, project, reviewing, setReviewing]);

  const duration = project?.video?.duration ?? 0;

  const nearby = useMemo(
    () => events.filter((e) => Math.abs(e.timestamp - currentTime) < NEAR),
    [events, currentTime],
  );

  const stats = useMemo(() => ({ total: events.length }), [events]);

  /**
   * The timeline shows one lane per event type the clip actually uses. Size
   * the strip to those lanes up to TIMELINE_VISIBLE_LANES, so a clip using
   * three types gets a compact strip rather than a fixed slab, and a clip using
   * fourteen gets a readable one that scrolls rather than eating the picture.
   */
  const laneCount = useMemo(() => new Set(events.map((e) => e.type)).size, [events]);
  const timelineRow =
    TIMELINE_CHROME + RULER_H + Math.min(Math.max(laneCount, 1), TIMELINE_VISIBLE_LANES) * LANE_H;

  /** Move the selection through the list in timeline order and follow the video. */
  const stepSelection = useCallback(
    (dir) => {
      if (!events.length) return;
      const i = events.findIndex((e) => e.id === selectedId);
      const next = i === -1 ? (dir > 0 ? 0 : events.length - 1) : Math.min(events.length - 1, Math.max(0, i + dir));
      const ev = events[next];
      select(ev.id);
      seek(ev.timestamp);
    },
    [events, selectedId, select, seek],
  );

  useHotkeys(
    (e) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // The same action as the Save button: write this clip's ground truth
        // and stay on it. Allowed even when nothing has changed, so the file
        // can always be (re)written on demand.
        return saveProject().catch(() => {});
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          return setPlaying(!playing);
        case 'ArrowLeft':
        case 'ArrowRight':
        case ',':
        case '.': {
          e.preventDefault();
          // OS autorepeat is ignored on purpose: each repeat used to issue a
          // fresh seek that abandoned the one before it, so a held key showed
          // nothing until it was released. The stepper paces itself by frames
          // actually shown instead, and runs until the key comes up.
          if (e.repeat) return;
          const dir = e.key === 'ArrowLeft' || e.key === ',' ? -1 : 1;
          // Plain: one frame, for frame-accurate marking. Shift+arrow: one
          // second at a time, for covering ground quickly.
          const frames = e.shiftKey && e.key.startsWith('Arrow') ? Math.round(seekStep * REPORTING_FPS) : 1;
          return startStepping(e.key, dir, { frames });
        }
        case 'ArrowUp':
          e.preventDefault();
          return stepSelection(-1);
        case 'ArrowDown':
          e.preventDefault();
          return stepSelection(1);
        case 'Delete':
        case 'Backspace':
          // Removes a shift-dragged span if there is one, else the one event.
          if (selectedIds.length || selectedId) {
            e.preventDefault();
            return deleteSelection();
          }
          return;
        case 'Escape':
          if (selectedIds.length) {
            e.preventDefault();
            return clearSelection();
          }
          return;
        case '[':
          if (selectedId) return nudge(selectedId, -step);
          return;
        case ']':
          if (selectedId) return nudge(selectedId, step);
          return;
        case '?':
          return setShowKeys((v) => !v);
        default:
          break;
      }

      if (['1', '2', '3', '4', '5'].includes(e.key)) {
        return setPlaybackRate([0.25, 0.5, 1, 1.5, 2][Number(e.key) - 1]);
      }

      const label = keyMap()[e.key.toLowerCase()];
      if (label) {
        e.preventDefault();
        addEvent(label, currentTime);
        toast(`${labelTitle(label)} at ${currentTime.toFixed(2)}s`, 'success');
        return;
      }

      // The one tag key. Checked after the label keys so that rebinding a
      // label onto it still works; the defaults do not collide.
      if (e.key.toLowerCase() === UNSURE_KEY) {
        e.preventDefault();
        const id = setTag((ev) => ({ unsure: ev.unsure ? undefined : true }));
        if (!id) toast('Select an action first, or stop the playhead near one', 'info');
        return;
      }
    },
    [currentTime, playing, selectedId, selectedIds, events, stepSelection, step, seekStep, dirty, saveProject, setTag],
  );

  // Saving already writes groundtruth/<clip>.json, so the only header action
  // left is discarding this clip's ground truth.
  useEffect(() => {
    setHeaderDelete(() => setConfirmDelete(true));
    return () => setHeaderDelete(null);
  }, [setHeaderDelete]);

  /** Throw away this clip's ground truth and go back to the queue. */
  const removeGroundTruth = async () => {
    setDeleting(true);
    try {
      await deleteCurrentProject();
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loadingProject && !project) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="skeleton h-8 w-40 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Workspace */}
      {/* Flex rather than an arbitrary grid template: a class built from a
          template literal is not always emitted by the CSS scanner, and a
          missing column silently turned the inspector into an overlay. */}
      <div className="flex min-h-0 w-full min-w-0 flex-1 gap-3 p-3">
        {/* Rows are set inline, not as a grid-rows-[...] class: the height is
            computed, and a class built from a template literal is not always
            emitted by the CSS scanner. */}
        <div
          className="grid min-h-0 min-w-0 flex-1 gap-3"
          style={{
            gridTemplateRows: `minmax(0, 1fr) minmax(0, max(${TIMELINE_MIN}px, min(${timelineRow}px, ${TIMELINE_MAX_SHARE})))`,
          }}
        >
          {/* min-w-0 on each row: a grid item's default min-width:auto refuses to
              shrink below its content, so the timeline track (duration x zoom —
              ~30,000px on a 42-minute clip) would stretch this column and push
              the video's picture far off-screen, leaving a black stage. */}
          <div className="min-h-0 min-w-0" onContextMenu={(e) => openMenu(e, currentTime)}>
            <VideoStage nearbyEvents={nearby} />
          </div>
          <div className="min-h-0 min-w-0">
            <Timeline events={events} duration={duration} onContextMenu={openMenu} />
          </div>
        </div>

        {/* The right column, never over the picture — only beside it. It holds
            the key reference always, and the inspector when an action is
            selected. Collapsing the reference gives the width back. */}
        <aside
          className={`shrink-0 overflow-y-auto transition-[width] duration-150 ${
            selectedId || keysOpen || reviewing ? 'w-[340px]' : 'w-9'
          }`}
        >
          <div className="space-y-3">
            {reviewing && <ReviewChanges />}
            {selectedId && <Inspector />}
            <KeyGuide open={keysOpen} onToggle={() => setKeysOpen((v) => !v)} />
          </div>
        </aside>
      </div>

      <ActionMenu
        open={Boolean(menu)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        atTime={menu?.atTime ?? 0}
        onPick={(label, at) => {
          addEvent(label, at);
          toast(`${labelTitle(label)} at ${at.toFixed(2)}s`, 'success');
        }}
        onClose={() => setMenu(null)}
      />

      <ConfirmDelete
        open={confirmDelete}
        clip={project?.video?.filename}
        actionCount={events.length}
        busy={deleting}
        onConfirm={removeGroundTruth}
        onClose={() => setConfirmDelete(false)}
      />

      <Shortcuts open={showKeys} onClose={() => setShowKeys(false)} />
    </div>
  );
}
