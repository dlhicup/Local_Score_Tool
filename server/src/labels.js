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
