# Local Score Tool — team GT server

A self-hostable local server for a small team (2–4 people) to generate football
ground truth together. Same stack and workflow as the hosted Score GT platform —
users, roles, clip assignments, a shared library, the annotate workspace, and
ground truth saved centrally — but run on one machine on your own network, with
videos read from a shared folder on the host.

It has a **backend and a database**, because sharing users, assignments, and
ground truth between people needs one shared source of truth. (A browser-only
tool can't do that — its storage is private to each browser.)

## Stack

- **Server:** Node + Express, file-based storage (users, assignments, ground
  truth). No external database to install.
- **Web:** Vite + React + Tailwind, served by the same server.

## Run it

```bash
cp .env.example server/.env      # set ADMIN_USER and AUTH_SECRET (no passwords)
npm install                      # installs server + web
npm run build                    # build the web app
npm start                        # serve on http://<host-ip>:9044
```

**Install ffmpeg on the host too** — it's what makes Veo/phone clips playable in
the browser (see [Video that plays in the browser](#video-that-plays-in-the-browser)).
On Windows: `winget install --id Gyan.FFmpeg -e`, then reopen the terminal and
check `ffmpeg -version`. macOS: `brew install ffmpeg`. Debian/Ubuntu: `sudo apt
install ffmpeg`.

Members reach it at **`http://<host-ip>:9044`** on your LAN. On first start an admin
account is created from `.env`. **There are no passwords** — everyone signs in
with just their username, so this is meant for a trusted LAN.

For development with hot reload: `npm run dev` (web on :5173, API on :8790).

## The shared videos folder

Drop the team's clips into **`video/`** on the host — `.mp4`, `.webm`, `.mov`,
`.mkv`. They appear in the Library for everyone. Nothing is uploaded; the server
reads them straight from that folder. Filenames are the clip identity, so keep
them stable.

## Video that plays in the browser

Footage from Veo (and most phones) is **H.265 / HEVC**, which Chrome and Edge
can't decode — the clip loads, the timeline and duration are right, but the
picture is **black**. So the server keeps a small **H.264 proxy** next to each
clip in `video-proxy/` and serves that to the browser. The original is never
modified; the proxy is only what gets played.

Proxies are built with **ffmpeg** (720p H.264, one per clip):

- **On import** — a proxy starts building in the background. The annotate page
  shows "Converting this clip for playback…" while it runs and switches to the
  playable copy the moment it's done. A 42-minute match takes a few minutes.
- **For clips already in the folder** — run once:

  ```bash
  npm run proxies
  ```

  It builds a proxy for every clip that doesn't have one yet (safe to re-run;
  existing proxies are skipped).

If ffmpeg isn't installed, clips are served as-is — H.264 clips still play, but
HEVC ones stay black until you install ffmpeg and run `npm run proxies`.

## The workflow

1. **Admin** signs in (username only), opens **Users & assignments**, and
   creates a member account for each teammate — just a username and a role.
2. Admin **assigns clips** to members (by range or selection). Each member sees
   only what they're assigned.
3. Members open a clip and **annotate** — hotkeys, a lane timeline, frame-by-
   frame arrows (`←`/`→`), right-click to add, span-select, undo/redo.
4. **Save** writes the ground truth centrally: a working record in `data/` and
   the deliverable `videoname.json` in `groundtruth/`, in the exact format:

   ```json
   {"groundtruth":[
     {"frame":50,"action":"pass"},
     {"frame":313,"action":"goal"}
   ]}
   ```

   Frame numbers are on the fixed 25 fps reporting clock.

## Config (`.env`)

| var | what |
| --- | --- |
| `ADMIN_USER` | the first admin, seeded once on an empty store (no password — username-only sign-in) |
| `AUTH_SECRET` | signs session tokens — set a long random string so logins survive a restart (`openssl rand -base64 48`) |
| `PORT` | the API (loopback) |
| `PUBLIC_PORT` | the app, served to the team over the LAN (default 9044) |
| `VIDEO_DIR` / `DATA_DIR` / `GT_DIR` / `PROXY_DIR` | override the shared folders if you keep them elsewhere |
| `FFMPEG_PATH` | path to the ffmpeg binary, if it isn't on PATH |

## What lives where

- `video/` — the shared clips (host-local, not in git)
- `video-proxy/` — auto-built H.264 proxies of those clips, so they play in the browser
- `data/` — users, assignments, working records, the session secret
- `groundtruth/` — the deliverable `videoname.json` files
- `server/`, `web/` — the app

Everything under `video/`, `video-proxy/`, `data/`, and `groundtruth/` stays on
the host and is kept out of the repo.
