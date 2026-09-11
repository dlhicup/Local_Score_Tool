import { X } from 'lucide-react';
import { useStore } from '../store';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';
import { toFrame } from '../lib/fps';

/** The action list (right) and the add-action palette beneath it. */
export default function EventList() {
  const events = useStore((s) => s.events);
  const selectedIds = useStore((s) => s.selectedIds);
  const videoUrl = useStore((s) => s.videoUrl);
  const currentTime = useStore((s) => s.currentTime);
  const select = useStore((s) => s.select);
  const seek = useStore((s) => s.seek);
  const addEvent = useStore((s) => s.addEvent);
  const commit = useStore((s) => s.commit);

  const removeOne = (id) => {
    select(id);
    commit(events.filter((e) => e.id !== id));
    select(null);
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-white/[0.07] bg-ink-800">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3.5 py-3">
        <h3 className="label-text">Actions</h3>
        <span className="ml-auto font-mono text-sm text-pitch-400">{events.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {!events.length && (
          <div className="px-4 py-8 text-center text-sm leading-relaxed text-ink-600">
            No actions yet.<br />Load a video, then press a hotkey or right-click the timeline.
          </div>
        )}
        {events.map((e) => (
          <button
            key={e.id}
            onClick={() => { select(e.id); seek(e.t); }}
            className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
              selectedIds.includes(e.id) ? 'bg-ink-700' : 'hover:bg-white/[0.04]'
            }`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LABEL_META[e.type].color }} />
            <span className="min-w-0 flex-1 truncate text-sm text-ink-200">{labelTitle(e.type)}</span>
            <span className="shrink-0 font-mono text-xs text-ink-400 tabular">{e.t.toFixed(2)}s</span>
            <span className="shrink-0 font-mono text-2xs text-ink-600 tabular">f{toFrame(e.t)}</span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(ev) => { ev.stopPropagation(); removeOne(e.id); }}
              className="rounded p-0.5 text-ink-600 opacity-0 transition hover:bg-avoid-500/15 hover:text-avoid-500 group-hover:opacity-100"
              title="Delete"
            >
              <X size={14} />
            </span>
          </button>
        ))}
      </div>

      <div className="shrink-0 border-t border-white/[0.06] p-3">
        <h4 className="label-text mb-2">Add action · click or press key</h4>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_LABELS.map((l) => (
            <button
              key={l}
              disabled={!videoUrl}
              onClick={() => addEvent(l, currentTime)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-ink-300 transition hover:border-pitch-500/40 hover:bg-white/[0.04] hover:text-ink-100 disabled:opacity-40"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: LABEL_META[l].color }} />
              {labelTitle(l)}
              <span className="kbd">{LABEL_META[l].key}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
