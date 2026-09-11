# Local Score Tool

A fully offline, single-file version of the Score GT annotate workspace. It
does **not** store or serve videos — you import a clip straight from local
disk, annotate it, and save the ground truth as `videoname.json` in the exact
same format the hosted platform produces.

## Use it

Open `index.html` in a browser (Chrome/Edge recommended — see *Saving* below).
No install, no server, no internet needed.

1. **Drop a video** onto the window, or click **Choose video…**. The clip plays
   straight from disk — nothing is uploaded, and scrubbing is instant.
2. **Annotate**: press an action's hotkey at the playhead, or right-click the
   video / timeline for the action menu. Drag a marker to retime it; ⇧-drag the
   timeline to select a span.
3. **Save GT** (or `Ctrl+S`) writes `videoname.json`.

## Saving — two modes

- **Chrome / Edge:** click **Output folder…** once to pick a destination
  folder. Every Save then writes `videoname.json` straight into it, exactly
  like the platform writing to `groundtruth/`.
- **Any browser / no folder chosen:** Save downloads `videoname.json` to your
  Downloads folder.

To keep working on a clip later, load its video again and use **Load GT** to
re-import the saved `videoname.json`.

## Output format

Identical to the platform — frame numbers on the fixed 25 fps reporting clock,
sorted by frame:

```json
{"groundtruth":[
  {"frame":50,"action":"pass"},
  {"frame":275,"action":"tackle"},
  {"frame":448,"action":"goal"}
]}
```

`frame = round(seconds × 25)`. Timestamps in seconds are the internal source of
truth; frames are computed only at save time.

## The 15 action types (and default keys)

| key | action | key | action | key | action |
|-----|--------|-----|--------|-----|--------|
| q | pass | u | clearance | d | save |
| w | pass_received | i | take_on | f | foul |
| e | recovery | o | substitution | g | goal |
| r | tackle | p | block | | |
| t | interception | a | aerial_duel | | |
| y | ball_out_of_play | s | shot | | |

## Keyboard

| key | does |
|-----|------|
| `Space` | play / pause |
| `←` `→` | step one frame (25 fps grid) |
| `⇧`+`←`/`→` | jump one second |
| letter keys | add that action at the playhead |
| right-click | action menu at that point |
| `Del` / `Backspace` | delete selected action(s) |
| `+` `−` `0` | zoom picture · drag to pan · wheel over it |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Ctrl+S` | save ground truth |
| `?` | shortcut help |
