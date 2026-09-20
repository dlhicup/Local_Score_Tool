# Team tagging at the moment of an event, and the extra tags per event

> **Amended 2026-09-19, as implemented in the Local Score Tool.** The two
> sides are named **Team A** and **Team B** throughout, not home and away. This
> corpus has no reliable home side, and a venue-based name invites the tag
> being guessed from which end a team attacks — the very failure A.4 exists to
> catch. The event tag stores `"Team A"` / `"Team B"`, and the kit file keys
> them the same way. Everything else below is unchanged. Anything consuming
> these files must expect the new strings; the tool also reads the old
> `home`/`away` spellings and rewrites them on the next save, so files and kit
> files written to the original spec load without edits. Part C records what
> "as implemented" means in detail.

For the labelling studio. 2026-09-18. (The full specification with every convention rule and the wider label plan is `labelling_spec_full.md`.)

## Part A. How to tag the team on every event

### A.1 What the tag is

Every event gets one more field, `team`, with one of three values: `"Team A"`, `"Team B"`, `"unknown"`.

`team` is **the team of the player who makes the contact that defines the event's frame**. The annotator already looks at
that player to place the frame (the kick, the first touch, the challenge), so the tag is one extra glance at the shirt.
It should take about 3 seconds per event.

Team A and Team B are simply the two sides; which is which does not matter to the model, only that the same shirt is always the same letter within a clip. A one-line kit file per match (A.5) says which colours
they wear, so a reader of a single frame can always resolve the tag.

### A.2 The rule per event

| Event | `team` is the team of... | Note |
|---|---|---|
| pass | the kicker | |
| pass_received | the receiver | always the same team as the pass before it; if the ball reaches an opponent, the event is not a reception but a recovery or interception |
| recovery | the player whose touch establishes possession | usually the other team than the last kicker, but not always (a loose ball can be recovered by the kicker's own teammate) |
| interception | the player who cuts the pass out | always the other team than the pass |
| tackle | the tackler | the opponent of the ball carrier; a `take_on` and the `tackle` of the same duel carry different teams |
| take_on | the ball carrier | |
| clearance | the player who clears | |
| block | the player whose body stops the ball | the other team than the kick it blocks |
| shot | the striker | |
| save | the goalkeeper | the goalkeeper's team (the kit file gives both goalkeeper colours) |
| aerial_duel | each player his own team | the duel is two labels on one frame; one says Team A, the other Team B |
| foul | the offender | the team that concedes the free kick or penalty |
| goal | the team credited with the goal | for an own goal the credited team is still the attacking side; add `"own_goal": true` |
| ball_out_of_play | the player who touched the ball last before it crossed the line | the restart confirms it: the throw-in, corner or goal kick goes to the **other** team |
| substitution | the team making the change | |

Deflections: tag the player who performed the labelled action, not the deflecting body. A pass that deflects is still
the passer's pass; if the deflection is labelled as a `block`, that block carries the blocker's team.

### A.3 When to write `unknown`

Only when the shirt of the acting player is genuinely not visible: far wide shot, heavy occlusion, a player cut by the
frame edge. Do not guess from the direction of play. `unknown` must stay below 30 % of a match's events; a match with
more is returned.

### A.4 Quick consistency checks the annotator can do

- `pass` then `pass_received`: same team.
- `pass` then `interception`: different teams.
- `take_on` and its `tackle`: different teams.
- `ball_out_of_play`: the team tagged is the one that does **not** take the restart.
- Over a match, each side should carry between 30 % and 70 % of the events of each class. A class where one side has more
  than 70 % usually means the tag was filled from habit rather than from the shirt.

### A.5 The kit file, one per match: `kits.json`

```json
{
  "match": "2026-03-14_teamA_teamB",
  "team_a": {"name": "Team A", "shirt": "red", "shorts": "white", "socks": "red"},
  "team_b": {"name": "Team B", "shirt": "white", "shorts": "navy", "socks": "white"},
  "goalkeepers": {"team_a": "green", "team_b": "black"},
  "referee": "yellow",
  "darker_kit": "team_a",
  "kits_similar": false,
  "periods": [
    {"period": 1, "start_s": 12.4, "end_s": 2831.0, "team_a_attacks": "left"},
    {"period": 2, "start_s": 3612.0, "end_s": 6510.5, "team_a_attacks": "right"}
  ]
}
```

- `darker_kit`: which outfield shirt is darker on screen. The model learns "darker kit" against "lighter kit" as an
  absolute label, so this field has to be right. If the two shirts are close in brightness (white against light grey,
  stripes against plain), set `"kits_similar": true` and we decide from the pixels.
- `team_a_attacks`: the side of the screen Team A attacks in each period, from the main camera.
- `start_s`, `end_s`: kick-off and final whistle of each period on the video's own clock.
- For the existing 30-second clips, the kit line belongs to the match the clip came from; where that is unknown, one
  kit line per clip is acceptable.

### A.6 File formats

Clip labels keep their shape with the new field:

```json
{"groundtruth": [{"frame": 283, "action": "pass", "team": "Team A"},
                 {"frame": 312, "action": "aerial_duel", "team": "Team A"},
                 {"frame": 312, "action": "aerial_duel", "team": "Team B"},
                 {"frame": 343, "action": "pass_received", "team": "Team A"}]}
```

Full matches: a folder with the video, `kits.json` and `events.json`, where each event is
`{"t": 1834.64, "action": "pass", "team": "Team A"}` with `t` in seconds on the video's own clock.

### A.7 Order of work

1. New full matches: tagged from the first one.
2. Batch 1 (the 1,210 clips labelled 27 August to 7 September, listed in `labels/corpus/meta/batches.json`): retro-fit
   the tag, about 11 annotator-hours. This batch already follows the validator's convention, so it becomes usable at
   once.
3. The later 2,257 clips: tag them during their convention re-pass, not before.

### A.8 Why this tag is worth more than any other label

The validator labels the arrival of a pass as reception 75 %, recovery 16 %, interception 4 %, block 3 %. The picture
is the same in all four cases; what decides the class is whether the kicker and the receiver wear the same shirt. The
model today has no way to learn that, so it never emits recovery or interception at all, and it fires false receptions
on possession changes. With the tag it can learn "team of the last touch" and carry it for a few seconds. Expected gain
on the honest score: +0.02 to +0.05.

## Part B. Extra tags per event

The annotator is already on the event's frame, so extra fields on the same event are the cheapest labels we can get.
Five fields this time, all on every event:

| # | Field | Values | What it gives the model | Cost |
|---|---|---|---|---|
| 1 | `team` | Team A / Team B / unknown | Part A: the team of the last touch | 3 s |
| 2 | `ball_xy` | `[x, y]`: one click on the centre of the ball at the event frame, in the video's native pixels; `null` when the ball is not visible | a ball position exactly where it matters, at the touch; 36,000 events give far more positions than any separate frame pack | 2 s |
| 3 | `sure` | 1.0 / 0.7 / 0.3 (three anchored levels, see below) | a per-event training weight: doubtful labels train at lower weight instead of full weight, and the lowest values rank the review queue; most useful on recovery, interception, block, clearance | 1 s |
| 4 | `body` | foot / head / hand / other | tells headers from kicks: aerial duels, headed clearances, keeper handling | 1 s |
| 5 | `goal_view` | left / right / none: which goal is in the picture at that frame | coarse pitch geometry for clearance, shot, save and block | 1 s |

**Click or rectangle for the ball: a single click on the centre of the ball.** The model uses only the ball's centre,
on a grid of 8-pixel cells (4-pixel cells in the larger variant), and the ball is 10 to 17 pixels wide, so a click
anywhere on the ball already lands in the right cell and a click on its middle is exact. A rectangle takes twice the
time and adds a size we do not use. Rules for the click: at most one ball per event; `null` when the ball is hidden or
out of the picture at that frame (that is a valid answer, not a skipped field); an occluded ball whose position is
obvious (under a foot, in the keeper's hands) gets the click where its centre is.

`sure` is a number, but the annotator picks one of three named levels rather than a free value, because free values
are not comparable between people:

| Value | Meaning |
|---|---|
| 1.0 | class and frame both clear |
| 0.7 | the event clearly happened, but the class is a judgement call (recovery or interception, block or clearance) or the frame is uncertain by more than 3 frames |
| 0.3 | I think it happened, but I would not bet on it |
| (no event) | not sure it happened at all: do not label it |

The last row matters because of the scorer: a false event costs its full weight, so doubt about whether an event
happened still means "leave it out". `sure` is for doubt about the class or the timing of an event that did happen.

`body` is the body part that makes the contact of the event: the kicker's foot, the header, the keeper's hands. For
`aerial_duel` and `ball_out_of_play` use the contact that defines the frame, or `other` when nobody touches the ball.

`goal_view` is what the camera shows at the event's frame, not where the ball is going: `left` when the goal on the
left of the picture is visible, `right` for the right one, `none` when neither goal mouth is in the picture.

Example of one event with the five fields:

```json
{"frame": 448, "action": "tackle", "team": "Team B", "ball_xy": [1210, 402], "sure": 1.0, "body": "foot", "goal_view": "left"}
```

In `events.json` of a full match the same fields sit next to `t` and `action`.

## Part C. As implemented in the Local Score Tool

Everything above is the specification. This part records the decisions the tool
had to make to implement it, so a reader of the files is never surprised.

### C.1 The two sides

Stored as `"Team A"` and `"Team B"`, with `"unknown"` unchanged. Reading is
tolerant: `home`, `away`, `team_a`, `team_b` and the canonical pair are all
accepted, in any case and with spaces, hyphens or underscores between the
words. Anything else becomes `unknown` rather than dropping the action. A file
is rewritten to the canonical pair the next time its clip is saved. The kit
file is read the same way, so a `kits.json` written with `home`/`away` keys
still resolves.

### C.2 Every field is always present

A row carries all five fields, always, so a consumer never has to distinguish
"absent" from "not applicable". Where the annotator has not answered yet, the
value is the documented default:

| field | default | meaning of the default |
|---|---|---|
| `team` | `"unknown"` | not yet read off the shirt |
| `ball_xy` | *(none — see below)* | |
| `sure` | `1.0` | assumed clear until said otherwise |
| `body` | `"foot"` | the common case |
| `goal_view` | `"none"` | the common case |

**`ball_xy` has no default, and a clip cannot be saved until every action has
one.** It is the only tag with no answer that is safe to assume: defaulting it
to `null` would silently assert the ball was not visible, which is a claim, not
an absence — and a position cannot be guessed at all. So the tag has three
states in the workspace and only two of them are answers:

| state | meaning |
|---|---|
| `[x, y]` | the ball's centre at that frame |
| `null` | not visible or out of frame — a real answer, as A.6 intends |
| key absent | nobody has looked yet — **not** an answer |

Pressing Save with any action in the third state writes nothing, says how many
are outstanding, and jumps to the first. A file on disk therefore always
carries `ball_xy` on every row: the absent state exists only in the workspace,
before a save.

This is stricter than the guide, which budgets two seconds for the click and
does not say what happens if it is skipped. The reasoning is the scorer's: a
ball position that was never looked at is indistinguishable, downstream, from
one that was looked at and found missing, and the second is a training signal
while the first is a hole.

`body` and `goal_view` defaulting to a plausible value is a deliberate trade:
the guide budgets one second each, which only holds if the common case needs no
keystroke. It does mean an untouched action asserts `foot` / `none` rather than
admitting ignorance — worth knowing when reading a batch that has not had its
tagging pass.

### C.3 `sure` in JSON

JSON has one number type, so `1.0` serialises as `1`. The three levels are
still exactly `1`, `0.7` and `0.3`; a value outside them is repaired to `1`.

### C.4 Frames, not seconds

Clip files store `frame` on the fixed 25 fps reporting clock, and that is the
file's only precision — a time read back is on the 1/25 s grid. The tool snaps
every timestamp to that grid on the way in, so a save never silently loses
precision it appeared to have.

### C.5 Tolerant reading

A row whose `action` is not one of the fifteen labels, or whose `frame` is not
a number, is dropped. A row with a bad value in any *tag* keeps the action and
loses only the bad tag. Both `{"groundtruth": [...]}` and a bare array are
accepted. An unreadable file reads as empty rather than throwing, because this
runs on the path that opens a clip for an annotator.

### C.6 The kit file

`kits.json` at the project root, either the single-match object from A.5 used
for every clip, or `{"clips": {"<clip filename>": {...}}, "default": {...}}`
when clips come from different matches — which is A.5's "one kit line per clip
is acceptable".

### C.7 Not yet implemented

- `events.json` for full matches (A.6) — the tool works clip by clip, one
  ground-truth file per video, and does not yet emit the match-level shape.
- `periods` are read but not used; `team_a_attacks` is not surfaced anywhere.
- The A.4 checks the workspace runs are the four decidable from a single clip:
  pass → reception same side, pass → interception different, take-on and its
  tackle different, and an aerial duel being two events on one frame with
  opposite sides. The 30–70 % balance check is reported as the `unknown` share
  only; per-class balance is not yet computed.
