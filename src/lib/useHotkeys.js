import { useEffect } from 'react';

/** True when focus is in a text field, where shortcuts must not fire. */
const inField = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export function useHotkeys(handler, deps = []) {
  useEffect(() => {
    const onKey = (e) => {
      if (inField(e.target)) return;
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
