import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users2, UserPlus, Trash2, KeyRound, Shield, Film, Check, X, Search, ListOrdered, Wand2, Scale } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../store/useStore';

const PAGE = 40;

/** Clip files are named by number; the number is the identifier users speak in. */
const clipNumber = (name) => {
  const m = String(name).match(/(\d+)/);
  return m ? Number(m[1]) : null;
};
const pad = (n) => String(n).padStart(4, '0');

export default function Users() {
  const toast = useStore((s) => s.toast);
  const me = useStore((s) => s.user);

  const [users, setUsers] = useState([]);
  const [videos, setVideos] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState({ username: '', password: '', role: 'annotator' });
  const [selected, setSelected] = useState(() => new Set());
  const [assignee, setAssignee] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, v, a] = await Promise.all([api.listUsers(), api.listVideos(), api.assignments()]);
      setUsers(u.users);
      setVideos(v.videos);
      setAssignments(a.assignments);
    } catch (err) {
      if (!err.silent && err.status !== 401) toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const annotators = users.filter((u) => u.role === 'annotator');

  /**
   * Per-annotator progress. A clip counts as done once its ground truth holds
   * at least one action — the same rule the clip queue uses for its badge.
   */
  const progress = useMemo(() => {
    const byName = new Map(videos.map((v) => [v.name, v]));
    const c = {};
    for (const [clip, owner] of Object.entries(assignments)) {
      const row = (c[owner] ??= { assigned: 0, done: 0, actions: 0, nums: [] });
      row.assigned += 1;
      row.nums.push(clipNumber(clip));
      const v = byName.get(clip);
      if (v?.status === 'done') {
        row.done += 1;
        row.actions += v.project?.eventCount ?? 0;
      }
    }
    // Clips are handed out in ranges, so read them back as ranges: a run of
    // consecutive numbers collapses to "0001–0050" rather than fifty numbers.
    for (const row of Object.values(c)) {
      const ns = [...new Set(row.nums)].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      const runs = [];
      for (const n of ns) {
        const last = runs[runs.length - 1];
        if (last && n === last[1] + 1) last[1] = n;
        else runs.push([n, n]);
      }
      row.ranges = runs.map(([a, b]) => (a === b ? pad(a) : `${pad(a)}–${pad(b)}`));
    }
    return c;
  }, [assignments, videos]);

  const counts = useMemo(() => {
    const c = {};
    for (const owner of Object.values(assignments)) c[owner] = (c[owner] ?? 0) + 1;
    return c;
  }, [assignments]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return videos.filter((v) => {
      const owner = assignments[v.name] ?? null;
      if (filter === 'unassigned' && owner) return false;
      if (filter === 'assigned' && !owner) return false;
      if (filter !== 'all' && filter !== 'unassigned' && filter !== 'assigned' && owner !== filter) return false;
      // A clip is labeled once its saved ground truth holds at least one
      // action — same rule as the queue's "done" badge. This composes with
      // the owner filters: "Adnan" + unlabeled = what Adnan still owes.
      if (onlyUnlabeled && v.status === 'done') return false;
      if (q && !v.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [videos, assignments, filter, onlyUnlabeled, query]);

  const addUser = async (e) => {
    e.preventDefault();
    try {
      await api.createUser(draft);
      setDraft({ username: '', password: '', role: 'annotator' });
      toast(`${draft.username} created`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Delete ${u.username}? Their assignments become unassigned.`)) return;
    try {
      await api.deleteUser(u.username);
      // If the clip list was filtered to this person, that chip is gone now —
      // fall back to showing everything rather than an invisible filter.
      if (filter === u.username) setFilter('all');
      toast(`${u.username} deleted — their clips are now unassigned`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const resetPassword = async (u) => {
    const password = window.prompt(`New password for ${u.username} (min 6 characters)`);
    if (!password) return;
    try {
      await api.updateUser(u.username, { password });
      toast(`Password updated for ${u.username}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const apply = async (username) => {
    const clips = [...selected];
    if (!clips.length) return toast('Select some clips first', 'error');
    try {
      const { assignments: next } = await api.assign(clips, username);
      setAssignments(next);
      setSelected(new Set());
      toast(username ? `${clips.length} clips assigned to ${username}` : `${clips.length} clips unassigned`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  /**
   * Clips are numbered, so a range is the natural unit — nobody is ticking a
   * thousand boxes. The numbers are read out of the filename, so this works
   * whatever padding the files use.
   */
  const inRange = useMemo(() => {
    const a = Number(from);
    const b = Number(to);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !from || !to) return [];
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return visible.filter((v) => {
      const n = clipNumber(v.name);
      return n !== null && n >= lo && n <= hi;
    });
  }, [from, to, visible]);

  const applyRange = (mode) => {
    if (!inRange.length) return toast('That range matched no clips', 'error');
    setSelected((s) => {
      const next = new Set(mode === 'replace' ? [] : s);
      inRange.forEach((v) => next.add(v.name));
      return next;
    });
    toast(`${inRange.length} clips selected`, 'success');
  };

  /**
   * One click: give every unassigned, unlabeled clip an owner, sized so that
   * everyone ends up with roughly the SAME pending workload. "Average", not
   * "equal share": an annotator already sitting on a backlog gets fewer new
   * clips, one who is caught up gets more. Clips are handed out in contiguous
   * number order, so each person still receives ranges, not confetti.
   */
  const autoAssign = async () => {
    if (!annotators.length) return toast('Create some annotators first', 'error');
    const pool = videos
      .filter((v) => !assignments[v.name] && v.status !== 'done')
      .map((v) => v.name)
      .sort();
    if (!pool.length) return toast('Every unlabeled clip already has an owner', 'error');

    const pending = {};
    for (const u of annotators) pending[u.username] = 0;
    for (const [clip, owner] of Object.entries(assignments)) {
      const v = videos.find((x) => x.name === clip);
      if (owner in pending && v && v.status !== 'done') pending[owner] += 1;
    }

    // Everyone should end at ~avg pending; quotas are the deficits.
    const total = pool.length + Object.values(pending).reduce((a, b) => a + b, 0);
    const avg = total / annotators.length;
    const quota = {};
    let handedOut = 0;
    for (const u of annotators) {
      quota[u.username] = Math.max(0, Math.floor(avg - pending[u.username]));
      handedOut += quota[u.username];
    }
    // Rounding leftovers go to whoever will still have the least.
    let leftover = pool.length - handedOut;
    while (leftover > 0) {
      const u = annotators.reduce((a, b) =>
        pending[a.username] + quota[a.username] <= pending[b.username] + quota[b.username] ? a : b);
      quota[u.username] += 1;
      leftover -= 1;
    }

    const plan = annotators
      .map((u) => `${u.username}: +${quota[u.username]} (pending ${pending[u.username]} → ${pending[u.username] + quota[u.username]})`)
      .join('\n');
    if (!window.confirm(`Assign ${pool.length} unlabeled clips?\n\n${plan}`)) return;

    try {
      let cursor = 0;
      let next = assignments;
      for (const u of annotators) {
        const slice = pool.slice(cursor, cursor + quota[u.username]);
        cursor += quota[u.username];
        if (!slice.length) continue;
        ({ assignments: next } = await api.assign(slice, u.username));
      }
      setAssignments(next);
      setSelected(new Set());
      toast(`${pool.length} unlabeled clips assigned across ${annotators.length} annotators`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  /** Hand the current filter out evenly, so a corpus can be split in one go. */
  const distribute = async () => {
    const pool = visible.map((v) => v.name);
    if (!pool.length) return toast('Nothing to distribute', 'error');
    if (!annotators.length) return toast('Create some annotators first', 'error');
    if (!window.confirm(`Split ${pool.length} clips evenly across ${annotators.length} annotators?`)) return;

    const per = Math.ceil(pool.length / annotators.length);
    try {
      let next = assignments;
      for (let i = 0; i < annotators.length; i++) {
        const slice = pool.slice(i * per, (i + 1) * per);
        if (!slice.length) continue;
        ({ assignments: next } = await api.assign(slice, annotators[i].username));
      }
      setAssignments(next);
      setSelected(new Set());
      toast(`${pool.length} clips split across ${annotators.length} annotators`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggle = (name) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const shown = visible.slice(0, limit);
  const allShownSelected = shown.length > 0 && shown.every((v) => selected.has(v.name));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-6 flex items-center gap-2.5 text-2xl font-bold tracking-tight text-white">
          <Users2 size={22} className="text-pitch-400" /> Users &amp; assignments
        </h1>

        {/* People */}
        <section className="panel mb-6 p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">People</h2>

          <div className="mb-4 space-y-1.5">
            {users.map((u) => (
              <div key={u.username} className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.03]">
                <Shield size={14} className={u.role === 'admin' ? 'text-pitch-400' : 'text-ink-600'} />
                <span className="text-sm font-medium text-ink-100">{u.username}</span>
                {u.username === me?.username && <span className="text-2xs text-ink-600">(you)</span>}
                <span
                  className={`rounded px-1.5 py-0.5 text-2xs font-semibold uppercase ${
                    u.role === 'admin' ? 'bg-pitch-500/15 text-pitch-400' : 'bg-white/[0.07] text-ink-400'
                  }`}
                >
                  {u.role}
                </span>
                {u.role === 'annotator' &&
                  (() => {
                    const pr = progress[u.username] ?? { assigned: 0, done: 0, actions: 0 };
                    const pct = pr.assigned ? Math.round((pr.done / pr.assigned) * 100) : 0;
                    return (
                      <span className="flex items-center gap-2" title={`${pr.done} of ${pr.assigned} assigned clips annotated · ${pr.actions} actions saved`}>
                        <span className="font-mono text-2xs tabular text-ink-400">
                          <span className={pr.done ? 'text-pitch-400' : ''}>{pr.done}</span>
                          <span className="text-ink-600"> / {pr.assigned}</span>
                        </span>
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-700">
                          <span
                            className="block h-full rounded-full bg-gradient-to-r from-pitch-600 to-pitch-400 transition-[width] duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="font-mono text-2xs tabular text-ink-500">{pct}%</span>
                        {pr.ranges?.length > 0 && (
                          <span
                            className="truncate font-mono text-2xs text-ink-500"
                            title={`Assigned clips: ${pr.ranges.join(', ')}`}
                          >
                            {pr.ranges.slice(0, 2).join(', ')}
                            {pr.ranges.length > 2 && ` +${pr.ranges.length - 2} more`}
                          </span>
                        )}
                      </span>
                    );
                  })()}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => resetPassword(u)} title="Set a new password" className="rounded-md p-1.5 text-ink-500 transition hover:bg-white/10 hover:text-white">
                    <KeyRound size={14} />
                  </button>
                  {u.username !== me?.username && (
                    <button onClick={() => removeUser(u)} title="Delete" className="rounded-md p-1.5 text-ink-600 transition hover:bg-avoid-500/15 hover:text-avoid-500">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={addUser} className="flex flex-wrap items-end gap-2 border-t border-white/[0.06] pt-4">
            <label className="min-w-[140px] flex-1">
              <span className="label-text mb-1 block">Username</span>
              <input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} className="field py-2 text-xs" />
            </label>
            <label className="min-w-[140px] flex-1">
              <span className="label-text mb-1 block">Password</span>
              <input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} className="field py-2 text-xs" />
            </label>
            <label>
              <span className="label-text mb-1 block">Role</span>
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className="field py-2 text-xs">
                <option value="annotator">annotator</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button type="submit" className="btn-primary text-xs">
              <UserPlus size={14} /> Create user
            </button>
          </form>
        </section>

        {/* Assignment */}
        <section className="panel flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Film size={15} className="text-pitch-400" /> Assign clips
            </h2>
            <span className="font-mono text-2xs text-ink-500">{selected.size} selected</span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="field py-1.5 text-xs">
                <option value="">Choose an annotator…</option>
                {annotators.map((u) => (
                  <option key={u.username} value={u.username}>{u.username}</option>
                ))}
              </select>
              <button onClick={() => apply(assignee)} disabled={!assignee || !selected.size} className="btn-primary text-xs">
                <Check size={14} /> Assign
              </button>
              <button onClick={() => apply(null)} disabled={!selected.size} className="btn-ghost text-xs">
                <X size={14} /> Unassign
              </button>
            </div>
          </div>

          {/* Range selection — the practical way to hand out 1075 clips */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
            <ListOrdered size={14} className="shrink-0 text-pitch-400" />
            <span className="text-2xs font-semibold uppercase tracking-wider text-ink-500">Range</span>

            <label className="flex items-center gap-1.5">
              <span className="text-2xs text-ink-500">from</span>
              <input
                type="number"
                min={1}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyRange('replace')}
                placeholder="1"
                className="field w-24 py-1.5 text-center font-mono text-xs"
              />
            </label>

            <label className="flex items-center gap-1.5">
              <span className="text-2xs text-ink-500">to</span>
              <input
                type="number"
                min={1}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyRange('replace')}
                placeholder="250"
                className="field w-24 py-1.5 text-center font-mono text-xs"
              />
            </label>

            <span className="font-mono text-2xs text-ink-500 tabular">
              {from && to ? `${inRange.length} match` : ''}
            </span>

            <button onClick={() => applyRange('replace')} disabled={!inRange.length} className="btn-ghost text-xs">
              Select range
            </button>
            <button onClick={() => applyRange('add')} disabled={!inRange.length} className="btn-ghost text-xs">
              Add to selection
            </button>

            <span className="mx-1 h-5 w-px bg-white/10" />

            <button onClick={() => setSelected(new Set(visible.map((v) => v.name)))} className="btn-ghost text-xs">
              All {visible.length}
            </button>
            <button onClick={() => setSelected(new Set())} disabled={!selected.size} className="btn-ghost text-xs">
              Clear
            </button>
            <button
              onClick={autoAssign}
              title="Assign every unassigned unlabeled clip, balancing so all annotators end with a similar pending count"
              className="btn-ghost text-xs"
            >
              <Scale size={13} /> Auto-assign unlabeled
            </button>
            <button onClick={distribute} title="Split the filtered clips evenly across all annotators" className="btn-ghost text-xs">
              <Wand2 size={13} /> Split evenly
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-2">
            {['all', 'unassigned', 'assigned'].map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setLimit(PAGE); }}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize transition ${
                  filter === f ? 'bg-white/[0.1] text-white' : 'text-ink-500 hover:bg-white/[0.04] hover:text-ink-200'
                }`}
              >
                {f}
              </button>
            ))}
            <button
              onClick={() => { setOnlyUnlabeled((v) => !v); setLimit(PAGE); }}
              title="Show only clips with no saved ground truth yet"
              className={`ml-1 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                onlyUnlabeled
                  ? 'border-pitch-500/40 bg-pitch-500/10 text-pitch-400'
                  : 'border-white/10 text-ink-500 hover:bg-white/[0.04] hover:text-ink-200'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${onlyUnlabeled ? 'bg-pitch-400' : 'bg-ink-600'}`} />
              unlabeled only
            </button>
            {annotators.map((u) => (
              <button
                key={u.username}
                onClick={() => { setFilter(u.username); setLimit(PAGE); }}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  filter === u.username ? 'bg-white/[0.1] text-white' : 'text-ink-500 hover:bg-white/[0.04] hover:text-ink-200'
                }`}
              >
                {u.username} <span className="font-mono text-ink-600">{counts[u.username] ?? 0}</span>
              </button>
            ))}

            <div className="relative ml-auto w-48">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
              <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Search clips…" className="field py-1.5 pl-8 text-xs" />
            </div>
          </div>

          <div className="max-h-[46vh] overflow-y-auto p-1.5">
            {loading ? (
              <div className="space-y-1 p-1.5">
                {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-8 rounded" />)}
              </div>
            ) : (
              <>
                <AnimatePresence initial={false}>
                  {shown.map((v) => {
                    const owner = assignments[v.name] ?? null;
                    return (
                      <motion.label
                        key={v.name}
                        layout="position"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex cursor-pointer items-center gap-3 rounded px-2.5 py-1.5 transition hover:bg-white/[0.04]"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(v.name)}
                          onChange={() => toggle(v.name)}
                          className="h-3.5 w-3.5 accent-pitch-500"
                        />
                        <span className="flex-1 font-mono text-xs text-ink-200">{v.name}</span>
                        {v.project?.eventCount ? (
                          <span className="font-mono text-2xs text-ink-500">{v.project.eventCount} actions</span>
                        ) : null}
                        {owner ? (
                          <span className="rounded bg-pitch-500/15 px-1.5 py-0.5 text-2xs font-medium text-pitch-400">{owner}</span>
                        ) : (
                          <span className="text-2xs text-ink-700">unassigned</span>
                        )}
                      </motion.label>
                    );
                  })}
                </AnimatePresence>
                {visible.length > limit && (
                  <button
                    onClick={() => setLimit((l) => l + PAGE)}
                    className="mt-1 w-full rounded-lg py-2 text-xs font-medium text-ink-400 transition hover:bg-white/[0.04] hover:text-ink-100"
                  >
                    Show more — {visible.length - limit} remaining
                  </button>
                )}
              </>
            )}
          </div>

          <div className="border-t border-white/[0.06] px-4 py-2 text-2xs text-ink-500">
            {visible.length} clips match · {Object.keys(assignments).length} of {videos.length} assigned
          </div>
        </section>
      </div>
    </div>
  );
}
