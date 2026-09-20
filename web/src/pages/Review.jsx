import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Keyboard, Download, Undo2, Redo2, Plus, AlertCircle,
} from 'lucide-react';
import VideoStage from '../components/VideoStage';
import Timeline from '../components/Timeline';
import Inspector from '../components/Inspector';
import Shortcuts from '../components/Shortcuts';
import ActionMenu from '../components/ActionMenu';
import ConfirmDelete from '../components/ConfirmDelete';
import { useStore } from '../store/useStore';
import { useHotkeys } from '../lib/useHotkeys';
import { labelTitle, TEAMS, TEAM_META, SURE_LEVELS, BODY_PARTS, GOAL_VIEWS } from '../lib/labels';
import { frameStep, DEFAULT_FPS, REPORTING_FPS } from '../lib/fps';
import { getVideoEl } from '../lib/videoRef';

const NEAR = 0.6; // seconds either side of the playhead counted as "now"

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

export default function Review() {
  const { id } = useParams();
  const opening = useRef(null);
  const navigate = useNavigate();
  const {
    project, openProject, events, videoUrl, attachVideo, currentTime, seek,
    selectedId, selectedIds, select, clearSelection, addEvent, deleteEvent, deleteSelection, nudge, undo, redo,
    saveProject, dirty, setPlaying, playing, setPlaybackRate, toast, setTag, ballPick, setBallPick,
    past, future, loadingProject, settings, keyMap, setHeaderDelete,
    deleteCurrentProject,
  } = useStore();

  const step = settings.nudgeStep || frameStep(DEFAULT_FPS);
  const seekStep = settings.seekStep || 1;

  // Move the playhead by whole frames on the 25 fps reporting clock, snapping
  // to the frame grid so precise annotation always sits exactly on a frame.
  const stepFrame = useCallback(
    (frames) => {
      // Read the live element, not the store: frame stepping must be relative
      // to where the video actually is, and it must always land paused.
      const el = getVideoEl();
      const now = el ? el.currentTime : currentTime;
      if (el && !el.paused) el.pause();
      if (playing) setPlaying(false);
      const f = Math.max(0, Math.round(now * REPORTING_FPS) + frames);
      seek(f / REPORTING_FPS);
    },
    [currentTime, playing, setPlaying, seek],
  );

  const [showKeys, setShowKeys] = useState(false);
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
    openProject(id).then((p) => {
      // The server resolves any id that names a real clip, so a failure here
      // means the URL points at nothing — go back to the queue rather than
      // leave an empty workspace sitting on a broken link.
      if (!p) navigate('/', { replace: true });
    });
  }, [id, project, openProject, deleting, navigate]);

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
        // and stay on it. With nothing to save there is nothing to do.
        if (!dirty) return;
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
          e.preventDefault();
          // Plain: one frame back, for frame-accurate marking. Shift: one
          // second, for covering ground quickly.
          return e.shiftKey ? seek(currentTime - seekStep) : stepFrame(-1);
        case 'ArrowRight':
          e.preventDefault();
          return e.shiftKey ? seek(currentTime + seekStep) : stepFrame(1);
        case 'ArrowUp':
          e.preventDefault();
          return stepSelection(-1);
        case 'ArrowDown':
          e.preventDefault();
          return stepSelection(1);
        case ',':
          e.preventDefault();
          return stepFrame(-1);
        case '.':
          e.preventDefault();
          return stepFrame(1);
        case 'Delete':
        case 'Backspace':
          // Removes a shift-dragged span if there is one, else the one event.
          if (selectedIds.length || selectedId) {
            e.preventDefault();
            return deleteSelection();
          }
          return;
        case 'Escape':
          if (ballPick) {
            e.preventDefault();
            return setBallPick(false);
          }
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

      // ---- tag keys, from the labelling guide ----------------------------
      // Checked after the label keys so that rebinding a label onto one of
      // these still works; the defaults do not collide.
      const k = e.key.toLowerCase();

      const team = TEAMS.find((t) => TEAM_META[t].key === k);
      if (team) {
        e.preventDefault();
        return setTag({ team });
      }

      const sure = SURE_LEVELS.find((l) => l.key === e.key);
      if (sure) {
        e.preventDefault();
        return setTag({ sure: sure.value });
      }

      if (k === 'b') {
        e.preventDefault();
        // Shift+B is the other valid answer: the ball is not visible here.
        if (e.shiftKey) { setBallPick(false); return setTag({ ball_xy: null }); }
        if (!selectedId) return toast('Select an action first, then click the ball', 'info');
        return setBallPick(!ballPick);
      }

      // Cycle the two smallest tags rather than spend four more keys on them.
      if (k === 'v' || k === 'n') {
        e.preventDefault();
        const ev = events.find((x) => x.id === selectedId);
        if (!ev) return;
        const list = k === 'v' ? BODY_PARTS : GOAL_VIEWS;
        const field = k === 'v' ? 'body' : 'goal_view';
        const next = list[(list.indexOf(ev[field]) + 1) % list.length];
        return setTag({ [field]: next }, ev.id);
      }
    },
    [currentTime, playing, selectedId, selectedIds, events, stepSelection, step, seekStep, stepFrame, dirty, saveProject, setTag, ballPick, setBallPick],
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

        {selectedId && (
          <aside className="w-[340px] shrink-0 overflow-y-auto">
            <Inspector />
          </aside>
        )}
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
