import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppShell from './components/AppShell';
import Toasts from './components/Toasts';
import Library from './pages/Library';
import Review from './pages/Review';
import Settings from './pages/Settings';
import Users from './pages/Users';
import EventsGuide from './pages/EventsGuide';
import Exam from './pages/Exam';
import { useStore } from './store/useStore';
import { isManager } from './lib/roles';

/** User management: full admins only, not review admins. */
function ManagerOnly({ children }) {
  const user = useStore((s) => s.user);
  return isManager(user) ? children : <Navigate to="/" replace />;
}

export default function App() {
  const location = useLocation();
  const user = useStore((s) => s.user);
  const authChecked = useStore((s) => s.authChecked);
  const restoreSession = useStore((s) => s.restoreSession);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Nothing renders until we know whether there is a session, or the app
  // flashes the login screen at an already-signed-in user on every load.
  if (!authChecked) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="skeleton h-8 w-32 rounded-lg" />
      </div>
    );
  }


  return (
    <>
      <AppShell>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="h-full"
        >
          <Routes location={location}>
            <Route path="/" element={<Library />} />
            <Route path="/p/:id/annotate" element={<Review mode="annotate" />} />
            {/* Same workspace, with a record kept of what the reviewer changes. */}
            <Route path="/p/:id/review" element={<Review mode="review" />} />
            <Route path="/p/:id/extract" element={<Navigate to="../annotate" replace />} />
            <Route path="/users" element={<ManagerOnly><Users /></ManagerOnly>} />
            <Route path="/guide" element={<EventsGuide />} />
            <Route path="/reference" element={<Exam />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AppShell>
      <Toasts />
    </>
  );
}
