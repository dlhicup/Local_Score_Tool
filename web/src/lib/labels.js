// The 15 canonical labels. Order matters: it drives timeline lane order and the
// digit/letter shortcuts in the review page.
export const EVENT_LABELS = [
  'pass',
  'pass_received',
  'recovery',
  'tackle',
  'interception',
  'ball_out_of_play',
  'clearance',
  'take_on',
  'substitution',
  'block',
  'aerial_duel',
  'shot',
  'save',
  'foul',
  'goal',
];

/**
 * One hue per label, hand-picked for separation on a near-black background.
 * Related actions sit in neighbouring hues (the two pass events are both blue-
 * green; the three defensive stops are warm) so the timeline reads at a glance.
 */
export const LABEL_META = {
  pass:             { color: '#38BDF8', short: 'PAS', key: 'q', group: 'On the ball' },
  pass_received:    { color: '#2DD4BF', short: 'RCV', key: 'w', group: 'On the ball' },
  recovery:         { color: '#34D399', short: 'REC', key: 'e', group: 'On the ball' },
  tackle:           { color: '#FBBF24', short: 'TKL', key: 'r', group: 'Duels' },
  interception:     { color: '#A78BFA', short: 'INT', key: 't', group: 'Duels' },
  ball_out_of_play: { color: '#94A3B8', short: 'OUT', key: 'y', group: 'Stoppages' },
  clearance:        { color: '#A3E635', short: 'CLR', key: 'u', group: 'Defending' },
  take_on:          { color: '#E879F9', short: 'TKO', key: 'i', group: 'On the ball' },
  substitution:     { color: '#60A5FA', short: 'SUB', key: 'o', group: 'Stoppages' },
  block:            { color: '#FB923C', short: 'BLK', key: 'p', group: 'Defending' },
  aerial_duel:      { color: '#818CF8', short: 'AER', key: 'a', group: 'Duels' },
  shot:             { color: '#F43F5E', short: 'SHT', key: 's', group: 'Attacking' },
  save:             { color: '#22D3EE', short: 'SAV', key: 'd', group: 'Attacking' },
  foul:             { color: '#EF4444', short: 'FOU', key: 'f', group: 'Stoppages' },
  goal:             { color: '#FACC15', short: 'GOL', key: 'g', group: 'Attacking' },
};

export const LABEL_GROUPS = ['On the ball', 'Duels', 'Defending', 'Attacking', 'Stoppages'];

export const labelColor = (type) => LABEL_META[type]?.color ?? '#94A3B8';
export const labelShort = (type) => LABEL_META[type]?.short ?? '???';
export const isValidLabel = (t) => EVENT_LABELS.includes(t);

/** Human-facing title: pass_received -> "Pass received". */
export function labelTitle(type) {
  if (!type) return '';
  const s = type.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const KEY_TO_LABEL = Object.fromEntries(
  EVENT_LABELS.map((l) => [LABEL_META[l].key, l]),
);

/**
 * What each action means.
 *
 * Generated from guide.md — that file is the source of truth for action names,
 * and the server reads it at runtime, so this copy is only the fallback for
 * when it cannot be read. Do not hand-edit: change guide.md instead.
 */
export const LABEL_DEFINITIONS = {
  pass:
    'A pass is when a player kicks or throws the ball to one of their teammates.',
  pass_received:
    'A Pass Received refers to the successful completion of a pass when a player gains control of the ball after it has been deliberately passed to them by a teammate.',
  recovery:
    'A player gains possession after no team has possession of the ball or the ball is directed to them by an opponent. Active attempts to intercept the ball are excluded.',
  tackle:
    'A player tries to stop an opposing player from progressing further with the ball or takes possession from an opposing player.',
  interception:
    'A player intercepts an opposing team pass between two opposing players.',
  ball_out_of_play:
    'The ball goes out of play.',
  clearance:
    'A player clears the ball to safety by kick or header and eliminates immediate threat towards his/her own goal, regardless of who gains possession afterwards.',
  take_on:
    'Situations in which a player in control of the ball moves past an opponent player. Awarded to the offensive player who performs the take-on.',
  substitution:
    'Refers to the event when a player enters the match to replace a teammate. This occurs during a stoppage in play.',
  block:
    'A player blocks a shot by an opposing player.',
  aerial_duel:
    'An aerial duel occurs when two or more players attempt to gain possession of the ball in the air, typically using their head, for example after a long goal kick or a cross. At least one player must jump or clearly attempt to jump in order to contest the ball in the air. The key criterion is that the players are competing for the same ball, with physical contact or a visible attempt to win the ball. A separate event is recorded for each player involved in the duel.',
  shot:
    'A Shot is an attempt made by a player to score a goal by striking or directing the ball towards the opponent\'s goal.',
  save:
    'When the goalkeeper stops the ball from entering the net after a shot.',
  foul:
    'Occurs when a player breaks the laws of the game through unfair play or actions such as tripping, pushing, or handling the ball, resulting in a free kick or penalty for the opposing team. Excluding offside events and advantages. Referee needs to stop play.',
  goal:
    'To be awarded, the ball must pass completely over the goal line in the area between the posts and beneath the crossbar. Always comes with a shot event at the same time.',
};

// ---------------------------------------------------------------------------
// Per-event tags. Mirrors server/src/labels.js.
//
// An action is a label on a frame. The one tag still collected is `unsure`,
// stored only when it is set — absent means sure. Tags an older file carries
// (team, ball_xy, body, goal_view) are passed through untouched and never
// asked for.
// ---------------------------------------------------------------------------

/** The key that toggles the unsure flag on the selected (or nearest) action. */
export const UNSURE_KEY = 'm';

/**
 * The guide's checks that hold on labels alone, run over one clip's events.
 *
 * Advisory: they catch an action that is usually marked with a partner and
 * here stands alone. Each returns a short line naming the event involved so the
 * annotator can jump to it.
 */
export function labelChecks(events) {
  const out = [];
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  // An aerial duel is two labels on one frame, one per player.
  const byFrame = new Map();
  for (const e of sorted.filter((x) => x.type === 'aerial_duel')) {
    const k = Math.round(e.timestamp * 25);
    if (!byFrame.has(k)) byFrame.set(k, []);
    byFrame.get(k).push(e);
  }
  for (const [, pair] of byFrame) {
    if (pair.length === 1) {
      out.push({ at: pair[0].timestamp, id: pair[0].id, text: 'aerial_duel is usually two events on one frame, one per player' });
    }
  }

  // guide.md on `goal`: "Always comes with a shot event at the same time."
  // A goal standing alone is a missing shot, not a goal that happened without
  // one — so it is worth flagging rather than assuming.
  const shotFrames = new Set(sorted.filter((e) => e.type === 'shot').map((e) => Math.round(e.timestamp * 25)));
  for (const g of sorted.filter((e) => e.type === 'goal')) {
    const f = Math.round(g.timestamp * 25);
    // A frame either side, since the two are placed by hand.
    if (!shotFrames.has(f) && !shotFrames.has(f - 1) && !shotFrames.has(f + 1)) {
      out.push({ at: g.timestamp, id: g.id, text: 'a goal always comes with a shot on the same frame' });
    }
  }

  return out;
}
