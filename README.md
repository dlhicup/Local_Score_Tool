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

**Install ffmpeg on the host too** - it is what makes clips in formats the
browser cannot decode playable (see [Video in the browser](#video-in-the-browser)).
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

## Video in the browser

**Any format works.** Drop whatever the camera produced into `video/` — the
server works out whether a browser can show it, and fixes it when it can't.

A clip a browser can already decode is **served exactly as it sits on disk**,
byte-range streamed, never transcoded, never modified. No wait, no quality
loss. That covers H.264/VP8/VP9/AV1 in MP4 or WebM, 8-bit 4:2:0, with AAC,
MP3, Opus or Vorbis audio — which is what Veo exports already are.

Anything else would come up as a **black picture with a correct duration and
timeline**, which is the confusing failure annotators hit. The usual causes:

- **H.265 / HEVC** — Chrome and Edge decode it only through the OS, Firefox not at all
- **10-bit or 4:2:2 / 4:4:4** — even in H.264; browsers decode 8-bit 4:2:0 only
- **MPEG-4 / Xvid / WMV / ProRes** — no browser support
- **`.mkv` and most `.mov`** — the container itself isn't reliably supported

For those the server builds a **720p H.264 proxy** once, with ffmpeg, and
serves that instead. The original is never touched, and the proxy keeps the
clip's exact duration so frame numbers in the ground truth stay correct.

It happens on its own: a proxy starts building when a clip is imported, and
when one is first opened. The annotate page shows **"Converting this clip for
playback…"** with progress while it runs, and switches to the playable copy the
moment it lands. A 42-minute match takes a few minutes; it only happens once.

To convert everything up front instead of on first open:

```bash
npm run proxies
```

It skips clips that are already fine and clips that already have a proxy, so
it's safe to re-run.

**This needs ffmpeg on the host.** Windows: `winget install --id Gyan.FFmpeg -e`,
then reopen the terminal and check `ffmpeg -version`. macOS: `brew install
ffmpeg`. Debian/Ubuntu: `sudo apt install ffmpeg`. Without it, clips that need
converting are flagged **"codec may need ffmpeg"** in the Library and still show
black — everything else plays normally.

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
| `FFMPEG_PATH` | path to the ffmpeg binary, if it is not on PATH |

## What lives where

- `video/` — the shared clips (host-local, not in git)
- `video-proxy/` — H.264 copies of only those clips a browser cannot decode
- `data/` — users, assignments, working records, the session secret
- `groundtruth/` — the deliverable `videoname.json` files
- `server/`, `web/` — the app

Everything under `video/`, `video-proxy/`, `data/`, and `groundtruth/` stays on
the host and is kept out of the repo.
