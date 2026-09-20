# Local Score Tool — team ground-truth server

A self-hosted server for a small team (2–4 people) to produce football ground
truth together. One machine on your network holds the videos, the annotation
work and the finished ground-truth files; everyone else opens a browser and
annotates.

It has a **backend**, because sharing clips and ground truth between people
needs one source of truth. (A browser-only tool can't do that — its storage is
private to each browser.)

---

## Install

You do this once, on the **host** — the machine that will keep the videos and
serve the team. Everyone else needs nothing but a browser.

### 1. Install Node.js

Version **20 or newer** (built and tested on Node 24).

- **Windows:** `winget install --id OpenJS.NodeJS.LTS -e`
- **macOS:** `brew install node`
- **Debian/Ubuntu:** `sudo apt install nodejs npm`

Reopen the terminal, then check:

```bash
node -v
npm -v
```

### 2. Install ffmpeg

This is what makes clips play when the camera produced a format browsers can't
decode. Skip it and those clips show a black picture — see
[Video in the browser](#video-in-the-browser).

- **Windows:** `winget install --id Gyan.FFmpeg -e`
- **macOS:** `brew install ffmpeg`
- **Debian/Ubuntu:** `sudo apt install ffmpeg`

Reopen the terminal, then check — **both** must work:

```bash
ffmpeg -version
ffprobe -version
```

### 3. Get the code and build it

```bash
git clone https://github.com/dlhicup/Local_Score_Tool.git
cd Local_Score_Tool
npm install        # installs server + web
npm run build      # builds the web app into web/dist
```

`npm run build` is not optional — the server serves the built app from
`web/dist`. **Re-run it every time you pull new code**, or the team keeps
getting the old version.

### 4. Start it

```bash
npm start
```

You should see:

```
Score GT API  →  http://127.0.0.1:8790
Score GT app  →  http://0.0.0.0:9044  (serving web/dist)
```

Open <http://localhost:9044> on the host to confirm it works.

### 5. Let the team reach it

Find the host's LAN address:

- **Windows:** `ipconfig` → the `IPv4 Address` on your active adapter
- **macOS/Linux:** `ip addr` or `ifconfig`

Teammates then open **`http://<host-ip>:9044`** — for example
`http://192.168.1.50:9044`.

**On Windows you must open the port**, or the firewall silently blocks everyone
except the host. In an **Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Local Score Tool" -Direction Inbound `
  -Protocol TCP -LocalPort 9044 -Action Allow -Profile Private
```

Use `-Profile Private` only — don't expose this on a public network. There is
**no sign-in**: anyone who can reach the port has full access.

### 6. Add the videos

Copy the team's clips into the **`video/`** folder on the host, or drag them
into the Library page in the browser. See
[The shared videos folder](#the-shared-videos-folder).

That's the install done.

### Keeping it running

`npm start` stops when you close the terminal. To keep it up across reboots,
run it under a process manager:

```bash
npm install -g pm2
pm2 start npm --name score-gt -- start
pm2 save
pm2 startup          # follow the command it prints
```

### Updating

```bash
git pull
npm install
npm run build        # required — otherwise the team still gets the old app
pm2 restart score-gt # or stop and re-run npm start
```

Your videos, annotations and ground-truth files live outside git and survive
updates untouched.

---

## Using it

There is **no sign-in and no password**. Whoever opens the page gets full
access to every clip, so run this only on a network you trust.

| page | what it's for |
| --- | --- |
| **Library** | every clip, its status, and how much is annotated. Open one to start. Drag files in to import them. |
| **Annotate** | the workspace: player, lane timeline, inspector |
| **Events guide** | the 15 labels and what each one means |
| **Reference** | worked examples — a clip beside its ground truth, read-only, to learn the conventions |
| **Review** | go through annotated clips and approve or flag them |
| **Users & assignments** | label who owns which clip |
| **Settings** | nudge step, seek step, page size |

Assignments are **labels, not permissions** — they record who is meant to do
what. They don't hide anything from anyone.

### Annotating a clip

Open a clip from the Library, then mark each action at the frame it happens.
Press the action's key at the playhead, or right-click the timeline to pick
from a list.

Then **tag it**, while you are still on its frame — five fields, a few seconds
each, all of them on every action. See [The ground-truth files](#the-ground-truth-files)
for what each one means, and the **Events guide** page in the app for how to
judge them.

**Save** writes the ground truth and stays on the clip. Pick the next clip
from the Library when you're done.

The badge beside the action count in the header watches two things for you: the
share of actions still tagged `unknown` (the spec asks for under 30%), and the
consistency rules — a reception that changed team, an interception that didn't,
an aerial duel whose two halves agree. Click a warning to jump to it.

### Keyboard

| key | action |
| --- | --- |
| `Space` | play / pause |
| `←` `→` | step one frame |
| `⇧` + `←` `→` | jump one second |
| `1`–`5` | playback speed |
| `↑` `↓` | previous / next action |
| `[` `]` | nudge the selected action |
| `Del` | delete selection · `Esc` clears a span |
| `⇧` drag | select every action in a span |
| `+` `−` `0` | zoom the picture (wheel works too; drag to pan) |
| `⌘/Ctrl` + `Z` | undo (`⇧` to redo) |
| `⌘/Ctrl` + `S` | save |
| `?` | show all shortcuts |

### Tagging the action

| key | sets |
| --- | --- |
| `z` `x` `c` | team: Team A · Team B · unknown |
| `b` | click the centre of the ball · `⇧B` marks it not visible |
| `6` `7` `8` | sure: 1.0 · 0.7 · 0.3 |
| `v` | body: foot → head → hand → other |
| `n` | goal in view: left → right → none |

A tag key applies to the selected action, or to the nearest one within two
seconds of the playhead — so tagging straight after marking needs no mouse.

### The 15 event keys

| key | event | key | event | key | event |
| --- | --- | --- | --- | --- | --- |
| `q` | pass | `y` | ball_out_of_play | `a` | aerial_duel |
| `w` | pass_received | `u` | clearance | `s` | shot |
| `e` | recovery | `i` | take_on | `d` | save |
| `r` | tackle | `o` | substitution | `f` | foul |
| `t` | interception | `p` | block | `g` | goal |

These are the only labels allowed. The server rejects anything else, so a
ground-truth file can never drift off the taxonomy. Definitions are on the
**Events guide** page in the app.

### Reference examples

The **Reference** page shows worked examples — a clip beside its ground truth,
laid out like the workspace with the same player: zoom, `←`/`→` frame stepping
(`⇧` for one second), `↑`/`↓` to jump between actions, `Space` to play. It is
strictly read-only.

Populate it by dropping matched pairs into an **`exam/`** folder on the host —
for each example, two files that share a base name: `name.gt.json` (the ground
truth, either `{"groundtruth":[…]}` or a bare array) and `name.mp4` (the clip,
H.264 so it plays in the browser). Until that folder has pairs, the page
explains how to add them.

---

## The shared videos folder

Drop clips into **`video/`** on the host — `.mp4`, `.webm`, `.mov`, `.mkv`,
`.m4v`. They appear in the Library for everyone. Nothing is uploaded; the
server reads them straight from that folder.

**Filenames are the clip's identity**, so keep them stable. A clip's ground
truth is named after it: `Match 1.mp4` produces `groundtruth/Match 1.json`.
Renaming a clip orphans its ground truth.

You can also drag files onto the Library page to copy them into `video/`.

## Video in the browser

**Any format works.** The server works out whether a browser can show a clip,
and fixes it when it can't.

A clip a browser can already decode is **served exactly as it sits on disk**,
byte-range streamed, never transcoded, never modified — no wait, no quality
loss. That covers H.264/VP8/VP9/AV1 in MP4 or WebM, 8-bit 4:2:0, with AAC,
MP3, Opus or Vorbis audio. Veo exports already are this.

Anything else would come up as a **black picture with a correct duration and
timeline** — the confusing failure that looks like a broken app. The usual
causes:

- **H.265 / HEVC** — Chrome and Edge decode it only through the OS, Firefox not at all
- **10-bit or 4:2:2 / 4:4:4** — even in H.264; browsers decode 8-bit 4:2:0 only
- **MPEG-4 / Xvid / WMV / ProRes** — no browser support
- **`.mkv` and most `.mov`** — the container itself isn't reliably supported

For those the server builds a **720p H.264 proxy** once, with ffmpeg, and
serves that instead. The original is never touched, and the proxy keeps the
clip's exact duration, so frame numbers stay correct.

It happens on its own — a proxy starts building when a clip is imported and
when one is first opened. The annotate page shows **"Converting this clip for
playback…"** with progress, and switches to the playable copy the moment it
lands. A 42-minute match takes a few minutes, once.

To convert everything up front instead of on first open:

```bash
npm run proxies
```

It skips clips that are already fine and clips that already have a proxy, so
it's safe to re-run.

**Without ffmpeg**, clips needing conversion are flagged *"codec may need
ffmpeg"* in the Library and still show black. Everything else plays normally.

## The ground-truth files

**One file per clip, and it is the only store.** `groundtruth/<clip name>.json`
is what the app reads, what it writes, and what gets handed off — there is no
second copy to drift out of step with it. Drop a ground-truth file in beside a
clip of the same name and the workspace opens with it loaded.

Frame numbers are on a **fixed 25 fps reporting clock** — `frame = seconds × 25`
— regardless of the video's own frame rate. A 30-second clip is 750 frames even
if it was shot at 30 fps. That clock is the file's only precision, so a time
read back is on the 1/25 s grid.

Every action carries the five tags:

```json
{"groundtruth":[
  {"frame":283,"action":"pass","team":"Team A","ball_xy":[1210,402],"sure":1,"body":"foot","goal_view":"left"},
  {"frame":312,"action":"aerial_duel","team":"Team A","ball_xy":null,"sure":0.7,"body":"head","goal_view":"none"},
  {"frame":312,"action":"aerial_duel","team":"Team B","ball_xy":null,"sure":0.7,"body":"head","goal_view":"none"}
]}
```

| field | values | what it is |
| --- | --- | --- |
| `team` | `Team A` `Team B` `unknown` | the team of the player whose contact defines the frame — read off the shirt, never inferred from the direction of play |
| `ball_xy` | `[x, y]` or `null` | the centre of the ball at that frame in the video's own pixels; `null` means not visible, which is an answer, not a gap. **Required — see below** |
| `sure` | `1.0` `0.7` `0.3` | doubt about the **class or the timing**. Doubt about whether it happened at all means don't label it |
| `body` | `foot` `head` `hand` `other` | the body part making the contact |
| `goal_view` | `left` `right` `none` | which goal mouth is in the picture at that frame |

A `goal` that was an own goal also carries `"own_goal": true`; the team stays
the credited (attacking) side.

> **Note on `team`.** These two values were originally specified as `home` and
> `away`. They are **`Team A`** and **`Team B`** here, because the corpus has no
> reliable home side and a venue-based name invites the tag being guessed from
> which end a team attacks. `Upgraded_guide.md` is amended to match, and
> anything consuming these files needs to expect the new strings. Reading is
> tolerant in both directions — `home`, `away`, `team_a` and `team_b` are all
> accepted on the way in and rewritten to the canonical pair on the next save —
> so files written to the original spec load unchanged.

Rows are in frame order, with events on the same frame keeping the order they
were added — which is how an `aerial_duel` pair stays together.

**The ball is required — a clip will not save without it.** Every other tag has
a starting value; `ball_xy` has none, because there is no answer that is safe
to assume. `null` would silently claim the ball was not visible, and a position
cannot be guessed. So it has three states, and only two are answers:

| in the workspace | means |
| --- | --- |
| `[x, y]` | the ball's centre at that frame — click it, or press `b` |
| `null` | not visible or out of frame — press `⇧B`. A real answer |
| not set | nobody has looked yet. **Not** an answer |

Pressing Save while any action is in the third state **writes nothing**, tells
you how many are outstanding and jumps to the first. The header badge shows the
running count, so you can see it coming. A file on disk therefore always has
`ball_xy` on every row.

**Reading older files.** A file with only `frame` and `action` loads fine; the
other tags take their defaults (`team: "unknown"`, `sure: 1.0`, `body: "foot"`,
`goal_view: "none"`) and are written out in full on the next save. `ball_xy`
does not default — an older file's actions all count as unanswered, so expect
to work through them before that clip can be saved again. A bad value in any
tag is repaired rather than dropping the action. Both `{"groundtruth": [...]}`
and a bare array are accepted.

**Everything about a clip is in that one file.** Alongside `groundtruth` it may
carry two more keys, both optional:

```json
{
  "annotator": "Dmytro",
  "review": {"verdict": "flagged", "reason": "mistimed", "note": "…", "reviewer": "local", "at": "…"},
  "groundtruth": [ … ]
}
```

That is what makes reviewing someone else's work a copy: **drop their
`<clip name>.json` into `groundtruth/`, put the clip in `video/`, and open
it** — their actions, their name and any verdict come with the file. There is
nothing to import and no second folder to keep in step. Anything else already
in the file that this tool does not recognise is preserved on save, so a field
another tool added is never dropped.

Edit times come from the file's own timestamps, and duration and frame size are
read from the video, so nothing has to be cached anywhere.

## Kit colours (`kits.json`)

The team tag is only resolvable if a reader can tell the two sides apart, so
put a `kits.json` at the project root and the colours appear beside the
Team A / Team B buttons while annotating. Copy `kits.example.json` to start.

Sides are keyed `team_a` / `team_b`, the same names the tag uses. Which side is
which doesn't matter to the model — only that the same shirt is always the same
letter within a clip.

One match, used for every clip:

```json
{
  "match": "2026-03-14_teamA_teamB",
  "team_a": {"name": "Team A", "shirt": "red", "shorts": "white", "socks": "red"},
  "team_b": {"name": "Team B", "shirt": "white", "shorts": "navy", "socks": "white"},
  "goalkeepers": {"team_a": "green", "team_b": "black"},
  "darker_kit": "team_a",
  "kits_similar": false,
  "periods": [{"period": 1, "start_s": 12.4, "end_s": 2831.0, "team_a_attacks": "left"}]
}
```

Several clips from different matches — give each its own line, with an optional
fallback:

```json
{
  "clips": { "St. Louis City SC-1.mp4": { "team_a": {...}, "team_b": {...} } },
  "default": { "team_a": {...}, "team_b": {...} }
}
```

A file written with the earlier `home` / `away` keys is normalised on read —
`home` becomes `team_a`, `away` becomes `team_b`, and `home_attacks` becomes
`team_a_attacks` — so nothing has to be rewritten by hand.

`darker_kit` has to be right: the model learns "darker kit" against "lighter
kit" as an absolute. If the two shirts are close in brightness, set
`"kits_similar": true` instead of guessing.

## Config (`.env`)

Everything has a working default, so **`.env` is optional**. To change
something, copy `.env.example` to `server/.env`.

| var | what |
| --- | --- |
| `PORT` | the internal API, loopback only (default 8790) |
| `PUBLIC_PORT` | the app, served to the team over the LAN (default 9044) |
| `VIDEO_DIR` / `DATA_DIR` / `GT_DIR` / `PROXY_DIR` | override the folders if you keep them elsewhere |
| `FFMPEG_PATH` | path to the ffmpeg binary, if it is not on PATH |
| `ADMIN_USER` / `AUTH_SECRET` | vestigial — there is no sign-in; both are ignored in practice |

## What lives where

- `video/` — the shared clips (host-local, never in git)
- `video-proxy/` — H.264 copies of only those clips a browser cannot decode
- `exam/` — reference examples: `<name>.gt.json` + `<name>.mp4` pairs shown on the Reference page
- `groundtruth/` — **the annotations**: one `<clip name>.json` per clip, and the only state the tool keeps
- `server/`, `web/` — the app

Everything under `video/`, `video-proxy/`, `exam/` and `groundtruth/` stays on
the host and is kept out of the repo. **Back up `groundtruth/`** — that is the
team's work, and there is nothing else to back up.

## Development

```bash
npm run dev      # web on :5173 with hot reload, API on :8790
```

The dev server proxies `/api` to the API. Production (`npm start`) serves the
built app and the API from one origin on `:9044`.

- **Server:** Node + Express, file-based storage, no external database
- **Web:** Vite + React + Tailwind + Zustand

## Troubleshooting

**Teammates can't reach the page.** The Windows firewall rule in
[step 5](#5-let-the-team-reach-it) is missing, or they're on a different
network. Confirm the host itself can open `http://localhost:9044` first.

**The app looks out of date after an update.** `npm run build` wasn't re-run.
The server serves `web/dist`, which git does not track.

**A clip is black.** The conversion hasn't finished, or ffmpeg is missing —
check the Library badge and run `ffprobe -version` on the host.

**`EADDRINUSE` on startup.** An older copy is still running. Stop it, or change
`PUBLIC_PORT`.

**Windows: `EBUSY` or `permission denied` when saving.** A security product is
holding files in this folder. Add the project directory to its exclusions —
Windows Defender *and* any third-party antivirus, which keep separate lists.
