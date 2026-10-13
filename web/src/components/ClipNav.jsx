import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { loadQueue, defaultQueue, neighbours } from '../lib/queue';

/**
 * Previous and Next clip, in the order the Library listed them.
 *
 * Moving on keeps the mode: reviewing, the next clip opens for review too. A
 * clip with unsaved changes asks before it is left — OK saves and moves on,
 * Cancel stays — because moving on is not a reason to lose work, and silently
 * saving would make Next do something nobody asked it to.
 */
export default function ClipNav() {
  const navigate = useNavigate();
  const project = useStore((s) => s.project);
  const reviewing = useStore((s) => s.reviewing);
  const dirty = useStore((s) => s.dirty);
  const saveProject = useStore((s) => s.saveProject);
  const openTask = useStore((s) => s.openTask);
  const toast = useStore((s) => s.toast);
  const [queue, setQueue] = useState(() => loadQueue());
  const [busy, setBusy] = useState(null);

  // Opened from a link rather than the Library: walk every clip instead.
  useEffect(() => {
    if (queue) return;
    let live = true;
    defaultQueue().then((q) => { if (live) setQueue(q); }).catch(() => {});
    return () => { live = false; };
  }, [queue]);

  const name = project?.video?.filename ?? null;
  const nb = useMemo(() => neighbours(queue, name, { skipEmpty: reviewing }), [queue, name, reviewing]);

  const go = async (target, which) => {
    if (!target || busy) return;
    if (dirty) {
      const ok = window.confirm(
        `${name} has unsaved changes.\n\nOK saves them and moves on. Cancel stays on this clip.`,
      );
      if (!ok) return;
      try {
        await saveProject({ silent: true });
      } catch {
        return; // the store has said why; stay put rather than lose the edit
      }
    }
    setBusy(which);
    try {
      const p = await openTask(target.name);
      navigate(`/p/${p.id}/${reviewing ? 'review' : 'annotate'}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!name) return null;
  const where = nb.index === -1 ? null : `${nb.index + 1} / ${nb.total}`;
  const btn = 'rounded-md p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5"
      title={nb.label ? `Working through: ${nb.label}` : undefined}
    >
      <button
        onClick={() => go(nb.prev, 'prev')}
        disabled={!nb.prev || Boolean(busy)}
        title={nb.prev ? `Previous clip: ${nb.prev.name}` : 'This is the first clip in the list'}
        className={btn}
      >
        {busy === 'prev' ? <Loader2 size={15} className="animate-spin" /> : <ChevronLeft size={15} />}
      </button>
      {where && <span className="px-1 font-mono text-2xs text-ink-400 tabular">{where}</span>}
      <button
        onClick={() => go(nb.next, 'next')}
        disabled={!nb.next || Boolean(busy)}
        title={nb.next ? `Next clip: ${nb.next.name}` : 'This is the last clip in the list'}
        className={btn}
      >
        {busy === 'next' ? <Loader2 size={15} className="animate-spin" /> : <ChevronRight size={15} />}
      </button>
    </div>
  );
}
