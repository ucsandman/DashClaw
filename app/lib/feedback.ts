
// -----------------------------------------------
// Sentiment detection (rule-based, no LLM needed)
// -----------------------------------------------

const POSITIVE_WORDS = ['great', 'good', 'excellent', 'perfect', 'love', 'amazing', 'helpful', 'fast', 'accurate', 'well', 'nice', 'awesome', 'thank', 'works', 'correct', 'impressive'];
const NEGATIVE_WORDS = ['bad', 'wrong', 'slow', 'broken', 'error', 'fail', 'terrible', 'awful', 'poor', 'worse', 'useless', 'annoying', 'confusing', 'incorrect', 'bug', 'crash'];

export type Sentiment = 'positive' | 'negative' | 'neutral';

export function detectSentiment(text: string | null | undefined, rating: number | null | undefined): Sentiment {
  if (rating) {
    if (rating >= 4) return 'positive';
    if (rating <= 2) return 'negative';
  }
  if (!text) return 'neutral';
  const lower = text.toLowerCase();
  const posCount = POSITIVE_WORDS.filter(w => lower.includes(w)).length;
  const negCount = NEGATIVE_WORDS.filter(w => lower.includes(w)).length;
  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

// -----------------------------------------------
// Auto-tagging (rule-based, no LLM needed)
// -----------------------------------------------

const TAG_PATTERNS = [
  { tag: 'performance', patterns: ['slow', 'fast', 'speed', 'latency', 'timeout', 'lag'] },
  { tag: 'accuracy', patterns: ['wrong', 'incorrect', 'accurate', 'correct', 'mistake', 'error'] },
  { tag: 'ux', patterns: ['confusing', 'intuitive', 'easy', 'hard', 'unclear', 'simple'] },
  { tag: 'reliability', patterns: ['crash', 'fail', 'broken', 'stable', 'reliable', 'bug'] },
  { tag: 'cost', patterns: ['expensive', 'cheap', 'cost', 'token', 'budget', 'billing'] },
  { tag: 'security', patterns: ['security', 'permission', 'access', 'credential', 'leak', 'exposure'] },
];

export function autoTag(text: string | null | undefined): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return TAG_PATTERNS
    .filter(t => t.patterns.some(p => lower.includes(p)))
    .map(t => t.tag);
}
