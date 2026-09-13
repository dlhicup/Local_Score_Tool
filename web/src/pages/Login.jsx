import { useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, AlertTriangle } from 'lucide-react';
import Logo from '../components/Logo';
import { useStore } from '../store/useStore';

export default function Login() {
  const signIn = useStore((s) => s.signIn);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm"
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo size={44} />
          <h1 className="mt-4 text-xl font-bold tracking-tight text-white">
            Score<span className="text-pitch-400">GT</span>
          </h1>
          <p className="mt-1 text-xs text-ink-500">Football ground-truth studio</p>
        </div>

        <form onSubmit={submit} className="panel space-y-3 p-5">
          <label className="block">
            <span className="label-text mb-1.5 block">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="field"
            />
          </label>

          <label className="block">
            <span className="label-text mb-1.5 block">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="field"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-avoid-500/30 bg-avoid-500/[0.08] px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-avoid-500" />
              <p className="text-xs text-avoid-500">{error}</p>
            </div>
          )}

          <button type="submit" disabled={busy || !username || !password} className="btn-primary w-full">
            <LogIn size={15} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-2xs leading-relaxed text-ink-600">
          No account? An administrator creates one for you.
        </p>
      </motion.div>
    </div>
  );
}
