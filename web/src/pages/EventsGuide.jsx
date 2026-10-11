import { useEffect, useState } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import { EVENT_LABELS, LABEL_META, LABEL_GROUPS, LABEL_DEFINITIONS, labelTitle } from '../lib/labels';
import { api } from '../lib/api';

/**
 * A reference document for annotators: the 15 event types, what each means, and
 * the key that marks it. Grouped the way the timeline lanes are grouped.
 */

export default function EventsGuide() {
  /**
   * The definitions come from the server, which reads them out of guide.md —
   * the file that calls itself the source of truth for action names. Keeping a
   * second copy in the app is what let this page drift away from it. The
   * built-in wording is only the fallback for a server that cannot be reached.
   */
  const [defs, setDefs] = useState(LABEL_DEFINITIONS);
  const [notes, setNotes] = useState([]);
  const [source, setSource] = useState(null);
  useEffect(() => {
    let live = true;
    api.labels()
      .then((d) => {
        if (!live) return;
        if (d?.definitions) setDefs({ ...LABEL_DEFINITIONS, ...d.definitions });
        setNotes(Array.isArray(d?.notes) ? d.notes : []);
        setSource(d?.definitionsFrom ?? null);
      })
      .catch(() => { /* keep the built-in wording */ });
    return () => { live = false; };
  }, []);

  const byGroup = LABEL_GROUPS.map((g) => ({
    group: g,
    labels: EVENT_LABELS.filter((l) => LABEL_META[l].group === g),
  })).filter((x) => x.labels.length);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-pitch-500/25 bg-pitch-500/[0.08] px-3 py-1">
          <BookOpen size={14} className="text-pitch-400" />
          <span className="text-2xs font-semibold uppercase tracking-wider text-pitch-400">Annotation guide</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">The 15 events</h1>
        <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-400">
          Every clip is labeled with these fifteen football events and nothing else. Mark an event at the exact moment it
          happens — press the event's key at the playhead, or right-click the timeline. Times are recorded to the
          hundredth of a second on a fixed 25 fps clock.
        </p>

        {/* Where the wording below comes from, and anything the file says
            outside its table. Shown so a reader can tell at a glance whether
            the page is quoting the spec or falling back to built-in wording. */}
        {(source || notes.length > 0) && (
          <div className="mt-3 max-w-[62ch] rounded-lg border border-white/[0.06] bg-ink-800/60 px-3 py-2">
            {source && (
              <p className="flex items-center gap-1.5 font-mono text-2xs text-ink-500">
                <FileText size={11} />
                definitions read from {source.split(/[\\/]/).pop()}
              </p>
            )}
            {notes.map((n) => (
              <p key={n} className="mt-1 text-2xs leading-snug text-ink-400">
                {n.replace(/`/g, '')}
              </p>
            ))}
          </div>
        )}

        <div className="mt-8 space-y-8">
          {byGroup.map(({ group, labels }) => (
            <section key={group}>
              <h2 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-ink-500">{group}</h2>
              <div className="space-y-2">
                {labels.map((l) => (
                  <div key={l} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-ink-800 p-4">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: LABEL_META[l].color, boxShadow: `0 0 8px ${LABEL_META[l].color}99` }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-sm font-semibold text-ink-100">{labelTitle(l)}</h3>
                        <code className="text-2xs text-ink-600">{l}</code>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-ink-400">{defs[l] ?? '—'}</p>
                    </div>
                    <kbd className="mt-0.5 shrink-0 rounded border border-white/10 bg-ink-700 px-2 py-1 font-mono text-xs uppercase text-ink-300">{LABEL_META[l].key}</kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* The one per-event tag. */}
        <div className="mt-10 rounded-xl border border-white/[0.06] bg-ink-800/60 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">An action is a label on a frame</h2>
          <p className="mb-3 max-w-[62ch] text-2xs leading-relaxed text-ink-500">
            Nothing else is asked for — no team, ball position, body part or goal in view. The only
            thing you can add is a flag for the actions you are not sure about.
          </p>
          <dl className="space-y-2.5 text-sm">
            <div>
              <dt className="font-semibold text-ink-100">
                Unsure <kbd className="rounded border border-white/10 bg-ink-700 ml-1 px-1.5 py-0.5 font-mono text-2xs">m</kbd>
              </dt>
              <dd className="mt-0.5 text-ink-400">
                Every action is <b>sure</b> unless you tick it. Tick <b>Unsure</b> in the inspector, or
                press <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs">m</kbd>, when the label is a judgement call or the frame could be off by more
                than a few frames. Doubt about whether it happened <em>at all</em> means: don't label it.
              </dd>
            </div>
          </dl>
        </div>

        {/* The guide's own consistency checks that hold on labels alone. */}
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-ink-800/60 p-5">
          <h2 className="mb-2 text-sm font-semibold text-white">Checks you can do yourself</h2>
          <ul className="space-y-1.5 text-sm text-ink-400">
            <li>• An <b>aerial duel</b> is two events on one frame — one for each player.</li>
            <li>• A <b>goal</b> always comes with a <b>shot</b> on the same frame.</li>
          </ul>
          <p className="mt-2.5 text-2xs text-ink-600">
            The workspace runs these for you: the badge beside the action count in the header shows
            how many actions are unsure and anything inconsistent, and clicking a line jumps to it.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-white/[0.06] bg-ink-800/60 p-5">
          <h2 className="mb-2 text-sm font-semibold text-white">Marking well</h2>
          <ul className="space-y-1.5 text-sm text-ink-400">
            <li>• Put the mark on the frame the action <em>occurs</em>, not when you notice it — step frame by frame with <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs">←</kbd> <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs">→</kbd> to land it exactly.</li>
            <li>• A <b>pass</b> and the <b>pass received</b> that follows are two separate events.</li>
            <li>• Only use these 15 — if something doesn't fit, it isn't labeled.</li>
            <li>• Drag a marker to retime it; select and delete to remove a mistake.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
