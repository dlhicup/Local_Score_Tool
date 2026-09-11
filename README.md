# Local Score Tool

A standalone **React** application for generating football ground truth from
local video — the Score GT annotate workspace, rebuilt as its own project with
no server and no stored video. You import a clip straight from disk (it never
uploads, so scrubbing is instant), annotate it, and save the ground truth as
`videoname.json` in the platform's exact format.

## Stack

Vite 5 · React 18 · Tailwind 3 · Zustand 5 · Framer Motion · lucide-react —
the same stack as the hosted platform. No backend.

## Run it

```bash
npm install
npm run dev        # http://localhost:9070
```

Or build a static bundle:

```bash
npm run build      # -> dist/
npm run preview
```

## Use it

1. **Drop a video** onto the window, or click **Choose video…**. It plays
   straight from disk — nothing is uploaded.
2. **Annotate**: press an action's hotkey at the playhead, right-click the
   video or timeline for the action menu, drag a marker to retime, ⇧-drag the
   timeline to select a span.
3. **Save GT** (or `Ctrl+S`) writes `videoname.json`.

### Saving — two modes

- **Chrome / Edge:** click **Output folder…** once to pick a destination; every
  Save then writes `videoname.json` straight into it, like the platform writing
  to `groundtruth/`.
- **Any browser / no folder chosen:** Save downloads `videoname.json`.

Use **Load GT** to re-import a saved file and keep working on a clip.

## Output format

Identical to the platform — frame numbers on the fixed 25 fps reporting clock,
sorted by frame:

```json
{"groundtruth":[
  {"frame":50,"action":"pass"},
  {"frame":277,"action":"tackle"},
  {"frame":448,"action":"goal"}
]}
```

`frame = round(seconds × 25)`. Seconds are the internal source of truth; frames
are derived only at save time. The `fps`, `labels`, `format`, `useHotkeys` and
`videoRef` modules under `src/lib/` are shared verbatim with the hosted
platform, so the numbers match exactly.

## The 15 action types (default keys)

`q` pass · `w` pass_received · `e` recovery · `r` tackle · `t` interception ·
`y` ball_out_of_play · `u` clearance · `i` take_on · `o` substitution ·
`p` block · `a` aerial_duel · `s` shot · `d` save · `f` foul · `g` goal

## Keyboard

| key | does |
|-----|------|
| `Space` | play / pause |
| `←` `→` | step one frame (25 fps grid) |
| `⇧`+`←`/`→` | jump one second |
| letter keys | add that action at the playhead |
| right-click | action menu at that point |
| `Del` / `Backspace` | delete selected action(s) |
| `⇧`-drag timeline | select a span |
| `+` `−` `0` | zoom picture · drag to pan · wheel over it |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Ctrl+S` | save ground truth |
| `?` | shortcut help |
