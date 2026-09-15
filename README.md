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

Clips are served exactly as they sit on disk — byte-range streamed, so seeking
works immediately. Nothing is transcoded and originals are never modified.

Use **H.264 (AVC) in MP4 with AAC audio**: every browser plays it. Veo exports
already are H.264, so they need nothing done to them.

If a clip is **H.265 / HEVC** the picture may come up **black** while the
duration and timeline still read correctly. Chrome and Edge decode HEVC only
through the operating system — on Windows that needs the "HEVC Video
Extensions" codec plus a GPU that supports it. Convert such a clip once before
dropping it into `video/`:

```bash
ffmpeg -i input.mp4 -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac output.mp4
```

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
| `VIDEO_DIR` / `DATA_DIR` / `GT_DIR` | override the shared folders if you keep them elsewhere |

## What lives where

- `video/` — the shared clips (host-local, not in git)
- `data/` — users, assignments, working records, the session secret
- `groundtruth/` — the deliverable `videoname.json` files
- `server/`, `web/` — the app

Everything under `video/`, `data/`, and `groundtruth/` stays on
the host and is kept out of the repo.
