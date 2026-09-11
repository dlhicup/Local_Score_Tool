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
