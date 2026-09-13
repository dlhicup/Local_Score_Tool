import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { SlidersHorizontal, Keyboard as KeyboardIcon, RotateCcw, AlertTriangle, Check, Lock } from 'lucide-react';
import { useStore, DEFAULT_SETTINGS } from '../store/useStore';
import { api } from '../lib/api';
import { EVENT_LABELS, LABEL_META, LABEL_DEFINITIONS, labelTitle } from '../lib/labels';
import { REPORTING_FPS } from '../lib/fps';

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center gap-4 border-b border-white/[0.05] py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-100">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Slider({ value, min, max, step, onChange, format }) {
  const pctVal = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full
                   [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pitch-500
                   [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(34,227,125,.2)]
                   [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-pitch-500"
        style={{ background: `linear-gradient(to right, #22E37D ${pctVal}%, #1C232F ${pctVal}%)` }}
      />
      <span className="w-16 shrink-0 text-right font-mono text-xs text-ink-200 tabular">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

/** Editable key bindings, saved to the account so they follow the person. */
function Hotkeys() {
  const user = useStore((s) => s.user);
  const saveHotkeys = useStore((s) => s.saveHotkeys);
  const toast = useStore((s) => s.toast);

  const [draft, setDraft] = useState({});
  const [capturing, setCapturing] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const base = {};
    for (const l of EVENT_LABELS) base[l] = (user?.hotkeys?.[l] ?? LABEL_META[l].key ?? '').toLowerCase();
    setDraft(base);
  }, [user]);

  // Two actions on one key means one of them is unreachable, so say so before
  // it is saved rather than letting it fail silently later.
  const clashes = useMemo(() => {
    const seen = {};
    const bad = new Set();
    for (const [label, key] of Object.entries(draft)) {
      if (!key) continue;
      if (seen[key]) {
        bad.add(label);
        bad.add(seen[key]);
      }
      seen[key] = label;
    }
    return bad;
  }, [draft]);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapturing(null);
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setDraft((d) => ({ ...d, [capturing]: '' }));
        return setCapturing(null);
      }
      // Single printable characters only — arrows, space and Enter already
      // drive playback and review.
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if ([' ', ',', '.', '[', ']', 'x'].includes(k)) {
        toast(`"${k}" is reserved for playback and review`, 'error');
        return setCapturing(null);
      }
      setDraft((d) => ({ ...d, [capturing]: k }));
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, toast]);

  const save = async () => {
    if (clashes.size) return toast('Two actions share a key — fix that first', 'error');
    setSaving(true);
    try {
      await saveHotkeys(draft);
      toast('Shortcuts saved to your account', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    const base = {};
    for (const l of EVENT_LABELS) base[l] = LABEL_META[l].key;
    setDraft(base);
  };

  return (
    <section className="panel p-5">
      <header className="mb-1 flex items-center gap-2">
        <KeyboardIcon size={15} className="text-pitch-400" />
        <h2 className="text-sm font-semibold text-white">Your shortcuts</h2>
        <button onClick={reset} className="ml-auto flex items-center gap-1 text-2xs text-ink-500 underline underline-offset-2 transition hover:text-ink-200">
          <RotateCcw size={11} /> Restore defaults
        </button>
      </header>
      <p className="mb-4 text-xs text-ink-500">
        Click a key to rebind it, then press the key you want. Backspace clears it, Escape cancels. These are saved to
        your account, so they follow you to any browser.
      </p>

      <div className="space-y-1">
        {EVENT_LABELS.map((l) => {
          const clash = clashes.has(l);
          return (
            <div key={l} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LABEL_META[l].color }} />
              <span className="flex-1 text-xs text-ink-100">{labelTitle(l)}</span>
              <span className="font-mono text-2xs text-ink-600">{l}</span>
              <button
                onClick={() => setCapturing(l)}
                className={`ml-2 h-7 w-16 rounded-lg border text-center font-mono text-xs transition ${
                  capturing === l
                    ? 'animate-pulse border-pitch-500 bg-pitch-500/15 text-pitch-400'
                    : clash
                      ? 'border-avoid-500/50 bg-avoid-500/10 text-avoid-500'
                      : 'border-white/10 bg-white/[0.04] text-ink-100 hover:border-white/25'
                }`}
              >
                {capturing === l ? 'press…' : draft[l] ? draft[l].toUpperCase() : '—'}
              </button>
            </div>
          );
        })}
      </div>

      {clashes.size > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-avoid-500/30 bg-avoid-500/[0.08] px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-avoid-500" />
          <p className="text-2xs text-avoid-500">
            {clashes.size} actions share a key with another. Only one of them would ever fire.
          </p>
        </div>
      )}

      <button onClick={save} disabled={saving || clashes.size > 0} className="btn-primary mt-4 w-full text-xs">
        <Check size={14} /> {saving ? 'Saving…' : 'Save shortcuts'}
      </button>
    </section>
  );
}


export default function Settings() {
  const { settings, updateSettings } = useStore();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-2 text-2xl font-bold tracking-tight text-white">
          Settings
        </motion.h1>
        <p className="mb-8 text-xs text-ink-400">
          Ground truth is written by hand here. Frame numbers are always on the fixed {REPORTING_FPS} fps reporting
          clock, whatever the source clip runs at.
        </p>

        <section className="panel mb-6 p-5">
          <header className="mb-2 flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-pitch-400" />
            <h2 className="text-sm font-semibold text-white">Annotation</h2>
            <button
              onClick={() => updateSettings(DEFAULT_SETTINGS)}
              className="ml-auto text-2xs text-ink-500 underline underline-offset-2 transition hover:text-ink-200"
            >
              Reset to defaults
            </button>
          </header>

          <Row
            label="Nudge step"
            hint="How far one press of [ or ] moves the selected action. One frame at 25 fps is 0.04s."
          >
            <Slider
              value={settings.nudgeStep}
              min={0.01}
              max={0.5}
              step={0.01}
              onChange={(nudgeStep) => updateSettings({ nudgeStep })}
              format={(v) => `${v.toFixed(2)}s`}
            />
          </Row>

          <Row label="Seek step" hint="How far ← and → move the playhead. Hold shift for five times this.">
            <Slider
              value={settings.seekStep}
              min={0.1}
              max={5}
              step={0.1}
              onChange={(seekStep) => updateSettings({ seekStep })}
              format={(v) => `${v.toFixed(1)}s`}
            />
          </Row>

          <Row
            label="Clips per page"
            hint="How many clips the library lists at once."
          >
            <Slider
              value={settings.pageSize}
              min={10}
              max={200}
              step={10}
              onChange={(pageSize) => updateSettings({ pageSize })}
            />
          </Row>

          <Row
            label="Auto-accept new actions"
            hint="An action you add by hand is already reviewed; leave this on unless you want a second pass."
          >
            <button
              onClick={() => updateSettings({ autoAccept: !settings.autoAccept })}
              className={`h-6 w-11 rounded-full p-0.5 transition ${settings.autoAccept ? 'bg-pitch-500' : 'bg-ink-700'}`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                  settings.autoAccept ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </Row>
        </section>

        <Hotkeys />
      </div>
    </div>
  );
}
