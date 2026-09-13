/**
 * Self-healing stale-cache check. The bundle knows its own hashed filename;
 * if the server is serving a different build, this page is running code that
 * no longer exists. Reload once (guarded, so a mismatch can never loop).
 */
(async () => {
  try {
    const mine = [...document.querySelectorAll('script[src]')]
      .map((s) => s.src.match(/assets\/index-([\w-]+)\.js/)?.[1])
      .find(Boolean);
    const { build } = await (await fetch('/api/version', { cache: 'no-store' })).json();
    console.info('ScoreGT build:', mine, '· server:', build);
    if (mine && build && build !== 'unknown' && mine !== build && !sessionStorage.getItem('sgt.reloaded')) {
      sessionStorage.setItem('sgt.reloaded', '1');
      location.reload();
    } else {
      sessionStorage.removeItem('sgt.reloaded');
    }
  } catch {
    /* offline or old server — never block startup on this */
  }
})();
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
