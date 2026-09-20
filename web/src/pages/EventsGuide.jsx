import { BookOpen } from 'lucide-react';
import { EVENT_LABELS, LABEL_META, LABEL_GROUPS, LABEL_DEFINITIONS, labelTitle } from '../lib/labels';

/**
 * A reference document for annotators: the 15 event types, what each means, and
 * the key that marks it. Grouped the way the timeline lanes are grouped.
 */
export default function EventsGuide() {
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
                      <p className="mt-1 text-sm leading-relaxed text-ink-400">{LABEL_DEFINITIONS[l] ?? '—'}</p>
                    </div>
                    <kbd className="mt-0.5 shrink-0 rounded border border-white/10 bg-ink-700 px-2 py-1 font-mono text-xs uppercase text-ink-300">{LABEL_META[l].key}</kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* The five per-event tags, from the labelling guide. */}
        <div className="mt-10 rounded-xl border border-white/[0.06] bg-ink-800/60 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Five tags on every action</h2>
          <p className="mb-3 max-w-[62ch] text-2xs leading-relaxed text-ink-500">
            You are already on the action's frame looking at the player who defines it, so these
            cost seconds each. Tag as you mark, not in a second pass.
          </p>
          <dl className="space-y-2.5 text-sm">
            <div>
              <dt className="font-semibold text-ink-100">
                Team <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs ml-1">z</kbd> <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs">x</kbd> <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs">c</kbd>
              </dt>
              <dd className="mt-0.5 text-ink-400">
                The team of the player whose contact defines the frame — the kicker for a pass, the
                receiver for a reception, the tackler for a tackle, the offender for a foul, the last
                touch before the ball went out. <b>Read the shirt.</b> Never infer it from the
                direction of play. <em>Unknown</em> is a real answer when the shirt genuinely cannot
                be seen, and should stay under 30% of a clip.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink-100">Ball <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs ml-1">b</kbd></dt>
              <dd className="mt-0.5 text-ink-400">
                One click on the <b>centre of the ball</b> at that frame. <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs">⇧B</kbd>{' '}
                marks it not visible — also a real answer, not a skipped field. An occluded ball whose
                position is obvious (under a foot, in the keeper's hands) still gets the click.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink-100">
                Sure <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs ml-1">6</kbd> <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs">7</kbd> <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs">8</kbd>
              </dt>
              <dd className="mt-0.5 text-ink-400">
                <b>1.0</b> class and frame both clear · <b>0.7</b> it happened, but the class is a
                judgement call or the frame is off by more than 3 frames · <b>0.3</b> you would not
                bet on it. Doubt about whether it happened <em>at all</em> means: don't label it.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink-100">Body <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs ml-1">v</kbd></dt>
              <dd className="mt-0.5 text-ink-400">
                The body part making the contact: foot, head, hand, other.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink-100">Goal in view <kbd className="rounded border border-white/10 bg-ink-700 px-1.5 py-0.5 font-mono text-2xs ml-1">n</kbd></dt>
              <dd className="mt-0.5 text-ink-400">
                Which goal mouth the camera shows at that frame — left, right or none. Not where play
                is heading.
              </dd>
            </div>
          </dl>
        </div>

        {/* The guide's own consistency checks. */}
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-ink-800/60 p-5">
          <h2 className="mb-2 text-sm font-semibold text-white">Checks you can do yourself</h2>
          <ul className="space-y-1.5 text-sm text-ink-400">
            <li>• A <b>pass</b> and the <b>pass received</b> after it are the same team.</li>
            <li>• A <b>pass</b> and the <b>interception</b> that cuts it out are different teams.</li>
            <li>• A <b>take on</b> and the <b>tackle</b> of the same duel are different teams.</li>
            <li>• An <b>aerial duel</b> is two events on one frame — one home, one away.</li>
            <li>• <b>Ball out of play</b> is tagged with the team that does <em>not</em> take the restart.</li>
            <li>• Across a clip, neither team should carry more than 70% of any one action — that
              usually means the tag was filled from habit rather than read off the shirt.</li>
          </ul>
          <p className="mt-2.5 text-2xs text-ink-600">
            The workspace runs these for you: the badge beside the action count in the header shows
            the unknown share and anything inconsistent, and clicking a warning jumps to it.
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
