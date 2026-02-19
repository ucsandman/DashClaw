import crypto from 'crypto';
import { getSql } from './db.js';
import { getOrgId } from './org.js';

// -----------------------------------------------
// Sentiment detection (rule-based, no LLM needed)
// -----------------------------------------------

const POSITIVE_WORDS = ['great', 'good', 'excellent', 'perfect', 'love', 'amazing', 'helpful', 'fast', 'accurate', 'well', 'nice', 'awesome', 'thank', 'works', 'correct', 'impressive'];
const NEGATIVE_WORDS = ['bad', 'wrong', 'slow', 'broken', 'error', 'fail', 'terrible', 'awful', 'poor', 'worse', 'useless', 'annoying', 'confusing', 'incorrect', 'bug', 'crash'];

export function detectSentiment(text, rating) {
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

export function autoTag(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return TAG_PATTERNS
    .filter(t => t.patterns.some(p => lower.includes(p)))
    .map(t => t.tag);
}

// -----------------------------------------------
// Feedback CRUD
// -----------------------------------------------

export async function createFeedback(request, { action_id, agent_id, rating, comment, category, tags, metadata, source }) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const id = 'fb_' + crypto.randomBytes(12).toString('hex');
  const sentiment = detectSentiment(comment, rating);
  const autoTags = autoTag(comment);
  const allTags = [...new Set([...(tags || []), ...autoTags])];

  await sql`
    INSERT INTO feedback (id, org_id, action_id, agent_id, source, rating, sentiment, category, comment, tags, metadata, created_by)
    VALUES (${id}, ${orgId}, ${action_id || ''}, ${agent_id || ''}, ${source || 'user'}, ${rating || null}, ${sentiment}, ${category || 'general'}, ${comment || ''}, ${JSON.stringify(allTags)}, ${JSON.stringify(metadata || {})}, ${'user'})
  `;

  return { id, sentiment, tags: allTags };
}

export async function listFeedback(request, { action_id, agent_id, category, sentiment, resolved, limit, offset } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const lim = Math.min(parseInt(limit || '50', 10), 200);
  const off = parseInt(offset || '0', 10);

  // Build query with optional filters
  if (action_id) {
    return sql`
      SELECT * FROM feedback WHERE org_id = ${orgId} AND action_id = ${action_id}
      ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}
    `;
  }
  if (agent_id && category) {
    return sql`
      SELECT * FROM feedback WHERE org_id = ${orgId} AND agent_id = ${agent_id} AND category = ${category}
      ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}
    `;
  }
  if (agent_id) {
    return sql`
      SELECT * FROM feedback WHERE org_id = ${orgId} AND agent_id = ${agent_id}
      ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}
    `;
  }
  if (sentiment) {
    return sql`
      SELECT * FROM feedback WHERE org_id = ${orgId} AND sentiment = ${sentiment}
      ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}
    `;
  }
  if (resolved !== undefined) {
    const resolvedBool = resolved === 'true' || resolved === true;
    return sql`
      SELECT * FROM feedback WHERE org_id = ${orgId} AND resolved = ${resolvedBool}
      ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}
    `;
  }

  return sql`
    SELECT * FROM feedback WHERE org_id = ${orgId}
    ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}
  `;
}

export async function getFeedback(request, feedbackId) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const rows = await sql`SELECT * FROM feedback WHERE id = ${feedbackId} AND org_id = ${orgId} LIMIT 1`;
  return rows[0] || null;
}

export async function resolveFeedback(request, feedbackId, { resolved_by } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`
    UPDATE feedback SET resolved = TRUE, resolved_at = NOW(), resolved_by = ${resolved_by || 'user'}
    WHERE id = ${feedbackId} AND org_id = ${orgId}
  `;
  return getFeedback(request, feedbackId);
}

export async function deleteFeedback(request, feedbackId) {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`DELETE FROM feedback WHERE id = ${feedbackId} AND org_id = ${orgId}`;
  return { deleted: true };
}

// -----------------------------------------------
// Stats & Analytics
// -----------------------------------------------

export async function getFeedbackStats(request, { agent_id } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);

  let overall;
  if (agent_id) {
    overall = await sql`
      SELECT
        COUNT(*) AS total_feedback,
        ROUND(AVG(rating), 2) AS avg_rating,
        COUNT(*) FILTER (WHERE sentiment = 'positive') AS positive_count,
        COUNT(*) FILTER (WHERE sentiment = 'negative') AS negative_count,
        COUNT(*) FILTER (WHERE sentiment = 'neutral') AS neutral_count,
        COUNT(*) FILTER (WHERE resolved = FALSE) AS unresolved_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS today_count
      FROM feedback
      WHERE org_id = ${orgId} AND agent_id = ${agent_id}
    `;
  } else {
    overall = await sql`
      SELECT
        COUNT(*) AS total_feedback,
        ROUND(AVG(rating), 2) AS avg_rating,
        COUNT(*) FILTER (WHERE sentiment = 'positive') AS positive_count,
        COUNT(*) FILTER (WHERE sentiment = 'negative') AS negative_count,
        COUNT(*) FILTER (WHERE sentiment = 'neutral') AS neutral_count,
        COUNT(*) FILTER (WHERE resolved = FALSE) AS unresolved_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS today_count
      FROM feedback
      WHERE org_id = ${orgId}
    `;
  }

  const byCategory = await sql`
    SELECT category, COUNT(*) AS count, ROUND(AVG(rating), 2) AS avg_rating
    FROM feedback WHERE org_id = ${orgId}
    GROUP BY category ORDER BY count DESC LIMIT 10
  `;

  const byAgent = await sql`
    SELECT agent_id, COUNT(*) AS count, ROUND(AVG(rating), 2) AS avg_rating,
      COUNT(*) FILTER (WHERE sentiment = 'positive') AS positive,
      COUNT(*) FILTER (WHERE sentiment = 'negative') AS negative
    FROM feedback WHERE org_id = ${orgId} AND agent_id != ''
    GROUP BY agent_id ORDER BY count DESC LIMIT 10
  `;

  const ratingDist = await sql`
    SELECT rating, COUNT(*) AS count
    FROM feedback WHERE org_id = ${orgId} AND rating IS NOT NULL
    GROUP BY rating ORDER BY rating
  `;

  const topTags = await sql`
    SELECT tag, COUNT(*) AS count
    FROM feedback, jsonb_array_elements_text(tags) AS tag
    WHERE org_id = ${orgId}
    GROUP BY tag ORDER BY count DESC LIMIT 15
  `;

  return {
    overall: overall[0] || {},
    by_category: byCategory,
    by_agent: byAgent,
    rating_distribution: ratingDist,
    top_tags: topTags,
  };
}
