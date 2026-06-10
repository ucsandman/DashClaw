/**
 * Aggregate export of all 7 optimizer rules. Each rule module exports the
 * default `{ id, inspect }` shape.
 */

import MODEL_DOWNSHIFT from './model-downshift';
import CACHE_WRITE_BLOAT from './cache-write-bloat';
import STUCK_LOOP_COST from './stuck-loop-cost';
import SUBAGENT_PROMPT_BLOAT from './subagent-prompt-bloat';
import REPEATED_READ_CYCLES from './repeated-read-cycles';
import BAD_CACHE_HIT from './bad-cache-hit';
import CONTEXT_GAPS_DETECTED from './context-gaps';

export const ALL_RULES = [
  MODEL_DOWNSHIFT,
  CACHE_WRITE_BLOAT,
  STUCK_LOOP_COST,
  SUBAGENT_PROMPT_BLOAT,
  REPEATED_READ_CYCLES,
  BAD_CACHE_HIT,
  CONTEXT_GAPS_DETECTED,
];

export {
  MODEL_DOWNSHIFT,
  CACHE_WRITE_BLOAT,
  STUCK_LOOP_COST,
  SUBAGENT_PROMPT_BLOAT,
  REPEATED_READ_CYCLES,
  BAD_CACHE_HIT,
  CONTEXT_GAPS_DETECTED,
};
