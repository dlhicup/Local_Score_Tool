// The 15 canonical Ground Truth event labels. This list is the contract:
// nothing outside it may ever enter a ground-truth file.
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

export const LABEL_SET = new Set(EVENT_LABELS);

export const isValidLabel = (v) => typeof v === 'string' && LABEL_SET.has(v);

// Short definitions handed to the model so it applies the labels consistently
// instead of inventing its own taxonomy.
export const LABEL_DEFINITIONS = {
  pass: 'A player deliberately plays the ball toward a team-mate.',
  pass_received: 'A player brings a team-mate’s pass under control.',
  recovery: 'A player collects a loose ball with no opponent challenge.',
  tackle: 'A player dispossesses an opponent through a ground challenge.',
  interception: 'A player cuts out an opponent’s intended pass.',
  ball_out_of_play: 'The ball fully crosses a touchline or goal line, or play is stopped.',
  clearance: 'A defender hits the ball away from danger with no target team-mate.',
  take_on: 'A player attempts to dribble past a directly opposing player.',
  substitution: 'A player is replaced; visible on the touchline or via the fourth official board.',
  block: 'A defender blocks a shot or cross with the body.',
  aerial_duel: 'Two opposing players contest a ball in the air.',
  shot: 'A deliberate attempt to score.',
  save: 'The goalkeeper prevents a shot from becoming a goal.',
  foul: 'An infringement penalised by the referee.',
  goal: 'The ball fully crosses the goal line between the posts.',
};

// ---------------------------------------------------------------------------
// Per-event tags, from Upgraded_guide.md (2026-09-18).
//
// Every event carries all five. They are cheap because the annotator is
// already on the event's frame looking at the player who defines it.
// ---------------------------------------------------------------------------

/**
 * The team of the player whose contact defines the event's frame — NOT the
 * team in possession, and not inferred from the direction of play.
 * `unknown` is a real answer when the shirt genuinely cannot be seen; the
 * guide asks that it stay under 30% of a match's events.
 *
 * The two sides are "Team A" and "Team B" rather than the guide's home/away:
 * this corpus has no reliable home side, and naming them neutrally stops the
 * tag being guessed from which end a team attacks. Anything reading these
 * files needs to expect these values.
 */
export const TEAM_A = 'Team A';
export const TEAM_B = 'Team B';
export const TEAMS = [TEAM_A, TEAM_B, 'unknown'];

/**
 * Files written before the rename, and anything produced straight from the
 * labelling guide, say home/away. Accept both on the way in so no existing
 * ground truth has to be rewritten by hand.
 */
const TEAM_ALIASES = { home: TEAM_A, away: TEAM_B, team_a: TEAM_A, team_b: TEAM_B };
export const normaliseTeam = (v) => {
  if (TEAMS.includes(v)) return v;
  const k = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TEAM_ALIASES[k] ?? null;
};

/**
 * Three anchored levels, never a free value: free confidences are not
 * comparable between annotators.
 *   1.0  class and frame both clear
 *   0.7  it happened, but the class is a judgement call, or the frame is
 *        uncertain by more than 3 frames
 *   0.3  probably happened, would not bet on it
 * Doubt about whether an event happened at all means: do not label it.
 */
export const SURE_LEVELS = [1.0, 0.7, 0.3];

/** The body part making the contact that defines the frame. */
export const BODY_PARTS = ['foot', 'head', 'hand', 'other'];

/** Which goal mouth is in the picture at that frame — not where play is going. */
export const GOAL_VIEWS = ['left', 'right', 'none'];

export const isTeam = (v) => normaliseTeam(v) !== null;
export const isBody = (v) => BODY_PARTS.includes(v);
export const isGoalView = (v) => GOAL_VIEWS.includes(v);
export const isSure = (v) => SURE_LEVELS.includes(Number(v));

/**
 * A ball click: the centre of the ball in the video's native pixels, or null
 * when the ball is hidden or out of frame at that instant — which is a valid
 * answer, not a skipped field.
 */
export const isBallXY = (v) =>
  v === null ||
  (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n)) && Number(n) >= 0));

/**
 * Defaults for a freshly marked event.
 *
 * `ball_xy` is deliberately absent. Every other tag has a starting value that
 * is either honest ("unknown") or the common case, but the ball has no answer
 * that is safe to assume: defaulting it to null would silently claim the ball
 * was not visible, and a position cannot be guessed at all. It stays
 * unanswered until somebody says otherwise, and a save is refused while any
 * action is still in that state.
 */
export const EVENT_TAG_DEFAULTS = {
  team: 'unknown',
  sure: 1.0,
  body: 'foot',
  goal_view: 'none',
};
