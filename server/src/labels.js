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
// Per-event tags.
//
// An action is a label on a frame and nothing else, unless the annotator ticks
// it unsure — that is the one tag still collected, stored as `unsure: true`
// only when it is set. Absent means sure.
//
// Files written to Upgraded_guide.md (2026-09-18) carry five more tags: team,
// ball_xy, sure, body and goal_view. Those are no longer asked for, but a file
// that already has them keeps them: they are validated below and written back
// untouched, so dropping the questions never throws away work already done.
// ---------------------------------------------------------------------------

/**
 * The two sides, as older files name them. "Team A" / "Team B" rather than the
 * guide's home/away; files from before that rename say home/away and are read
 * as the same thing.
 */
export const TEAM_A = 'Team A';
export const TEAM_B = 'Team B';
export const TEAMS = [TEAM_A, TEAM_B, 'unknown'];

const TEAM_ALIASES = { home: TEAM_A, away: TEAM_B, team_a: TEAM_A, team_b: TEAM_B };
export const normaliseTeam = (v) => {
  if (TEAMS.includes(v)) return v;
  const k = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TEAM_ALIASES[k] ?? null;
};

/**
 * The old three-level confidence. Only read now: anything below 1.0 becomes
 * `unsure: true`, which is what it meant.
 */
export const SURE_LEVELS = [1.0, 0.7, 0.3];

export const BODY_PARTS = ['foot', 'head', 'hand', 'other'];
export const GOAL_VIEWS = ['left', 'right', 'none'];

export const isTeam = (v) => normaliseTeam(v) !== null;
export const isBody = (v) => BODY_PARTS.includes(v);
export const isGoalView = (v) => GOAL_VIEWS.includes(v);
export const isSure = (v) => SURE_LEVELS.includes(Number(v));

/** A ball click in the video's native pixels, or null for "not visible". */
export const isBallXY = (v) =>
  v === null ||
  (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n)) && Number(n) >= 0));
