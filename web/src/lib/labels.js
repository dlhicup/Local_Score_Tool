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

export const LABEL_DEFINITIONS = {
  pass: 'A player deliberately plays the ball toward a team-mate.',
  pass_received: 'A player brings a team-mate’s pass under control.',
  recovery: 'A player collects a loose ball with no opponent challenge.',
  ball_out_of_play: 'The ball fully crosses a touchline or goal line, or play is stopped.',
  tackle: 'A player dispossesses an opponent through a ground challenge.',
  interception: 'A player cuts out an opponent’s intended pass.',
  clearance: 'A defender hits the ball away from danger with no target team-mate.',
  take_on: 'A player attempts to dribble past a directly opposing player.',
  substitution: 'A player is replaced during a stoppage.',
  block: 'A defender blocks a shot or cross with the body.',
  aerial_duel: 'Two opposing players contest a ball in the air.',
  shot: 'A deliberate attempt to score.',
  save: 'The goalkeeper prevents a shot from becoming a goal.',
  foul: 'An infringement penalised by the referee.',
  goal: 'The ball fully crosses the goal line between the posts.',
};

// ---------------------------------------------------------------------------
// Per-event tags, from Upgraded_guide.md. Mirrors server/src/labels.js — the
// server is the authority and repairs anything that disagrees, but the UI
// needs the same vocabulary to offer the choices.
// ---------------------------------------------------------------------------

/** The team of the player whose contact defines the event's frame. */
export const TEAMS = ['home', 'away', 'unknown'];

export const TEAM_META = {
  home: { label: 'Home', short: 'H', color: '#38BDF8', key: 'z' },
  away: { label: 'Away', short: 'A', color: '#FB923C', key: 'x' },
  unknown: { label: 'Unknown', short: '?', color: '#64748B', key: 'c' },
};

/** Three anchored levels — a free value is not comparable between people. */
export const SURE_LEVELS = [
  { value: 1.0, label: '1.0', key: '6', hint: 'class and frame both clear' },
  { value: 0.7, label: '0.7', key: '7', hint: 'it happened, but the class is a judgement call or the frame is off by >3 frames' },
  { value: 0.3, label: '0.3', key: '8', hint: 'I think it happened, but I would not bet on it' },
];

export const BODY_PARTS = ['foot', 'head', 'hand', 'other'];
export const GOAL_VIEWS = ['left', 'right', 'none'];

/** Defaults for a freshly marked event; the server applies the same ones. */
export const EVENT_TAG_DEFAULTS = {
  team: 'unknown',
  ball_xy: null,
  sure: 1.0,
  body: 'foot',
  goal_view: 'none',
};

/**
 * The consistency checks from the guide (A.4), run over one clip's events.
 *
 * These are advisory: they catch the tag filled from habit rather than from
 * the shirt, which is the failure the guide warns about. Each returns a short
 * line naming the events involved so the annotator can jump to them.
 */
export function teamChecks(events) {
  const out = [];
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const known = (e) => e.team === 'home' || e.team === 'away';

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!known(prev) || !known(cur)) continue;
    // A reception is by definition the same team as the pass it receives.
    if (prev.type === 'pass' && cur.type === 'pass_received' && prev.team !== cur.team) {
      out.push({ at: cur.timestamp, id: cur.id, text: 'pass → pass_received should be the same team' });
    }
    // An interception is by definition the other team than the pass.
    if (prev.type === 'pass' && cur.type === 'interception' && prev.team === cur.team) {
      out.push({ at: cur.timestamp, id: cur.id, text: 'pass → interception should be different teams' });
    }
    // A take-on and the tackle that stops it are two sides of one duel.
    if (prev.type === 'take_on' && cur.type === 'tackle' && prev.team === cur.team) {
      out.push({ at: cur.timestamp, id: cur.id, text: 'take_on and its tackle should be different teams' });
    }
  }

  // An aerial duel is two labels on one frame, one per team.
  const byFrame = new Map();
  for (const e of sorted.filter((x) => x.type === 'aerial_duel')) {
    const k = Math.round(e.timestamp * 25);
    if (!byFrame.has(k)) byFrame.set(k, []);
    byFrame.get(k).push(e);
  }
  for (const [, pair] of byFrame) {
    if (pair.length === 1) {
      out.push({ at: pair[0].timestamp, id: pair[0].id, text: 'aerial_duel is usually two events on one frame, one per team' });
    } else if (pair.length === 2 && known(pair[0]) && known(pair[1]) && pair[0].team === pair[1].team) {
      out.push({ at: pair[0].timestamp, id: pair[0].id, text: 'the two sides of an aerial_duel should be different teams' });
    }
  }
  return out;
}

/** Share of events tagged `unknown`; the guide asks that it stay under 30%. */
export function unknownShare(events) {
  if (!events.length) return 0;
  return events.filter((e) => e.team === 'unknown').length / events.length;
}
