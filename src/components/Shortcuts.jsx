import { useStore } from '../store';

const ROWS = [
  ['Space', 'Play / pause'],
  ['← →', 'Step one frame back / forward'],
  ['⇧ ← →', 'Jump one second'],
  ['q w e r t …', 'Add the action bound to that key at the playhead'],
  ['right-click', 'Action menu at that point'],
  ['Del / Backspace', 'Delete the selected action(s)'],
  ['⇧ drag timeline', 'Select every action in a span'],
  ['+ − 0', 'Zoom picture · drag to pan · wheel over it'],
  ['⌘/Ctrl Z', 'Undo · ⇧ to redo'],
  ['⌘/Ctrl S', 'Save ground truth'],
];

export default function Shortcuts() {
  const show = useStore((s) => s.showHelp);
  const toggle = useStore((s) => s.toggleHelp);
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[150] grid place-items-center bg-black/60 p-5" onClick={toggle}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-800 p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-ink-100">Keyboard shortcuts</h3>
        <table className="w-full text-sm">
          <tbody>
            {ROWS.map(([k, d]) => (
              <tr key={k} className="border-b border-white/[0.06] last:border-0">
                <td className="w-40 py-2 align-top"><span className="kbd">{k}</span></td>
                <td className="py-2 text-ink-300">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn-ghost mt-5" onClick={toggle}>Close</button>
      </div>
    </div>
  );
}
