const BASE = '/api';

const TOKEN_KEY = 'scoregt.token';
export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

/** Something outside React needs to know when a session dies mid-request. */
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    // Restoring a session is *expected* to 401 when there is no valid token —
    // that is how a signed-out visitor reaches the login screen. Surfacing it
    // as "your session has ended" made a normal cold start look like a fault.
    const isSessionProbe = path === '/auth/me';
    const hadToken = Boolean(token);

    setToken('');
    if (!isSessionProbe) onUnauthorized?.();

    throw Object.assign(
      new Error(
        isSessionProbe || !hadToken
          ? 'Not signed in'
          : 'Your session has ended — please sign in again',
      ),
      { status: 401, silent: isSessionProbe || !hadToken },
    );
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Bad response from server (${res.status})`);
  }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

export const api = {
  health: () => request('/health'),

  login: (username) => request('/auth/login', { method: 'POST', body: { username } }),
  me: () => request('/auth/me'),
  saveHotkeys: (hotkeys) => request('/auth/hotkeys', { method: 'PUT', body: { hotkeys } }),

  listUsers: () => request('/users'),
  createUser: (body) => request('/users', { method: 'POST', body }),
  updateUser: (username, body) => request(`/users/${encodeURIComponent(username)}`, { method: 'PUT', body }),
  deleteUser: (username) => request(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  assignments: () => request('/assignments'),
  assign: (clips, username) => request('/assignments', { method: 'PUT', body: { clips, username } }),
  labels: () => request('/labels'),

  listProjects: () => request('/projects'),
  createProject: (payload) => request('/projects', { method: 'POST', body: payload }),
  getProject: (id) => request(`/projects/${id}`),
  saveProject: (id, project) => request(`/projects/${id}`, { method: 'PUT', body: { project } }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  exportUrl: (id, onlyAccepted) => `${BASE}/projects/${id}/export${onlyAccepted ? '?accepted=1' : ''}`,

  listVideos: () => request('/videos'),

  examList: () => request('/exam'),
  examEntry: (hash) => request(`/exam/${encodeURIComponent(hash)}`),
  examVideoUrl: (hash) => `${BASE}/exam/${encodeURIComponent(hash)}/video?t=${encodeURIComponent(getToken())}`,

  reviewQueue: () => request('/review/queue'),
  reviewClip: (id) => request(`/review/${encodeURIComponent(id)}`),
  reviewVerdict: (id, body) => request(`/review/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  openVideo: (name) => request(`/videos/${encodeURIComponent(name)}/open`, { method: 'POST', body: {} }),
  /** Streamed from the server with range support, so seeking works. */
  /**
   * Pull the whole clip down before annotating starts.
   *
   * Range-streaming a 25 MB file means every seek into an unbuffered region is
   * a network round trip, which is what makes scrubbing stall. Fetching it once
   * into a blob puts the entire video in memory, so afterwards every seek is
   * local and instant. It also means the token travels in a header rather than
   * a query string.
   */
  /**
   * A URL the <video> element plays directly, with byte-range seeking. A media
   * element cannot send an Authorization header, so the same signed token
   * rides along as ?t= instead.
   */
  videoStreamUrl: (name) => `${BASE}/videos/file/${encodeURIComponent(name)}?t=${encodeURIComponent(getToken())}`,

  /**
   * Download the whole clip once, into a local blob.
   *
   * Annotation is scrub-heavy: with plain streaming, every seek to a not-yet-
   * downloaded part waits on the network (~0.8s each on a slow link). One
   * upfront download — reported by progress so it is never a mystery freeze —
   * makes the entire clip local, so every later seek is instant. One fetch, no
   * second stream competing for bandwidth.
   */
  fetchVideoBlob: async (name, onProgress, signal) => {
    const res = await fetch(api.videoStreamUrl(name), { signal });
    if (!res.ok) throw new Error(res.status === 403 ? 'This clip is not assigned to you' : `Could not load ${name}`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body?.getReader) return URL.createObjectURL(await res.blob());
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) onProgress?.(received / total);
    }
    onProgress?.(1);
    return URL.createObjectURL(new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' }));
  },



};
