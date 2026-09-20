import { NavLink, useParams, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutGrid, ClipboardCheck, Settings2, Save, Users2, Undo2, Redo2, Trash2, BookOpen, CheckCircle2, GraduationCap } from 'lucide-react';
import Logo from './Logo';
import TagStatus from './TagStatus';
import { useStore } from '../store/useStore';
import { isManager } from '../lib/roles';

function RailLink({ to, icon: Icon, label, disabled }) {
  if (disabled) {
    return (
      <div
        title={`${label} — open a project first`}
        className="relative flex h-11 w-11 cursor-not-allowed items-center justify-center rounded-xl text-ink-600"
      >
        <Icon size={19} />
      </div>
    );
  }
  return (
    <NavLink to={to} title={label} className="group relative flex h-11 w-11 items-center justify-center rounded-xl">
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="rail-active"
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="absolute inset-0 rounded-xl border border-pitch-500/30 bg-pitch-500/10"
            />
          )}
          <Icon
            size={19}
            className={`relative transition-colors ${isActive ? 'text-pitch-400' : 'text-ink-400 group-hover:text-ink-100'}`}
          />
          <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-ink-100 opacity-0 shadow-lift transition-opacity group-hover:opacity-100">
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

export default function AppShell({ children }) {
  const { id } = useParams();
  const location = useLocation();
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const events = useStore((s) => s.events);
  const save = useStore((s) => s.saveProject);
  const user = useStore((s) => s.user);
  const headerDelete = useStore((s) => s.headerDelete);
  const saved = useStore((s) => s.saved);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const isAdmin = user?.role === 'admin';
  const manager = isManager(user);

  const pid = id ?? project?.id;
  const inProject = Boolean(pid) && location.pathname.startsWith('/p/');

  return (
    <div className="flex h-full">
      {/* Navigation rail */}
      <nav className="z-30 flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-white/[0.06] bg-ink-900/70 py-4 backdrop-blur-xl">
        <NavLink to="/" className="mb-3" title="Score GT">
          <Logo size={32} />
        </NavLink>
        <RailLink to="/" icon={LayoutGrid} label="Library" />
        <RailLink to={pid ? `/p/${pid}/annotate` : '#'} icon={ClipboardCheck} label="Annotate" disabled={!pid} />
        <RailLink to="/guide" icon={BookOpen} label="Events guide" />
        <RailLink to="/reference" icon={GraduationCap} label="Reference" />
        {isAdmin && <RailLink to="/review" icon={CheckCircle2} label="Review" />}
        <div className="flex-1" />
        {manager && <RailLink to="/users" icon={Users2} label="Users & assignments" />}
        <RailLink to="/settings" icon={Settings2} label="Settings" />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Context header */}
        <header className="z-20 flex h-14 shrink-0 items-center gap-4 border-b border-white/[0.06] bg-ink-900/50 px-5 backdrop-blur-xl">
          {inProject && project ? (
            <>
              <div className="flex min-w-0 items-center gap-3">
                <span className="truncate text-sm font-semibold text-white">{project.name}</span>
                <span className="hidden truncate font-mono text-xs text-ink-500 sm:block">
                  {project.video?.filename ?? 'no video attached'}
                </span>
              </div>

              <div className="flex-1" />

              <div className="hidden items-center gap-3 text-xs md:flex">
                <span className="text-ink-400">
                  <span className="font-semibold text-ink-100 tabular">{events.length}</span>{' '}
                  {events.length === 1 ? 'action' : 'actions'}
                </span>
                <TagStatus />
              </div>

              <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                <button
                  onClick={undo}
                  disabled={!past.length}
                  title="Undo (⌘Z)"
                  className="rounded-md p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Undo2 size={15} />
                </button>
                <button
                  onClick={redo}
                  disabled={!future.length}
                  title="Redo (⇧⌘Z)"
                  className="rounded-md p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Redo2 size={15} />
                </button>
              </div>

              {headerDelete && (
                <button
                  onClick={() => headerDelete()}
                  disabled={!saved}
                  className={`rounded-lg p-2 transition ${
                    saved
                      ? 'text-ink-500 hover:bg-avoid-500/15 hover:text-avoid-500'
                      : 'cursor-not-allowed text-ink-700'
                  }`}
                  title={
                    saved
                      ? "Delete this clip's ground truth"
                      : 'Nothing saved yet — there is no ground truth to delete'
                  }
                >
                  <Trash2 size={15} />
                </button>
              )}

              {/* Save writes this clip's ground truth and stays put.
                  Never disabled: a clip whose actions were loaded from a file
                  someone else wrote has nothing "dirty" about it, and a Save
                  button that does nothing when pressed is indistinguishable
                  from one that is broken. Pressing it always writes the file. */}
              <button
                onClick={() => save().catch(() => {})}
                title={dirty ? 'Save this clip’s ground truth' : 'Write the ground-truth file again'}
                className={dirty ? 'btn-primary' : 'btn-ghost'}
              >
                <Save size={15} />
                {dirty ? 'Save' : 'Saved'}
              </button>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold tracking-tight text-white">
                Score<span className="text-pitch-400">GT</span>
              </span>
              <span className="text-xs text-ink-500">Football ground-truth studio</span>
              <div className="flex-1" />
              <span className="flex items-center gap-2 text-xs text-ink-400">
                <span className="font-medium text-ink-200">{user?.username}</span>
                <span className={`rounded px-1.5 py-0.5 text-2xs font-semibold uppercase ${
                  isAdmin ? 'bg-pitch-500/15 text-pitch-400' : 'bg-white/[0.07] text-ink-400'
                }`}>
                  {user?.role}
                </span>
              </span>
            </>
          )}
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
