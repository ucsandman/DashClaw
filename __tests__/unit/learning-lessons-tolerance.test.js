/**
 * P15: consolidateLessons must tolerate missing tables the way GET
 * /api/learning does — installs without learning_recommendations or
 * drift_alerts previously 500'd GET /api/learning/lessons (and the SDK's
 * learningLessons()).
 */
import { describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { recsThrow: null, driftThrow: null } }));

vi.mock('@/lib/repositories/learningLoop.repository.js', () => ({
  listLearningRecommendations: vi.fn(async () => {
    if (state.recsThrow) throw state.recsThrow;
    return [{ action_type: 'deploy', confidence: 80, success_rate: 90, hints: '{}', guidance: '{"text":"g"}', sample_size: 10 }];
  }),
}));

const { consolidateLessons } = await import('@/lib/learning-lessons.js');

function sqlWithDrift(rows, throwErr) {
  const tagged = (strings) => {
    const text = strings.join(' ');
    if (text.includes('FROM drift_alerts')) {
      if (throwErr) return Promise.reject(throwErr);
      return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  };
  tagged.query = async () => [];
  return tagged;
}

function missingTableError(rel) {
  const e = new Error(`relation "${rel}" does not exist`);
  e.code = '42P01';
  return e;
}

describe('consolidateLessons missing-table tolerance', () => {
  it('returns lessons + drift warnings when both sources exist', async () => {
    const result = await consolidateLessons(sqlWithDrift([{ metric: 'risk_score', severity: 'warning', z_score: 2.1, direction: 'increasing' }]), 'org_1', {});
    expect(result.lessons).toHaveLength(1);
    expect(result.lessons[0].guidance).toBe('g');
    expect(result.drift_warnings).toHaveLength(1);
  });

  it('degrades drift warnings to empty when drift_alerts is missing', async () => {
    const result = await consolidateLessons(sqlWithDrift([], missingTableError('drift_alerts')), 'org_1', {});
    expect(result.lessons).toHaveLength(1);
    expect(result.drift_warnings).toEqual([]);
  });

  it('degrades lessons to empty when learning_recommendations is missing', async () => {
    state.recsThrow = missingTableError('learning_recommendations');
    const result = await consolidateLessons(sqlWithDrift([]), 'org_1', {});
    state.recsThrow = null;
    expect(result.lessons).toEqual([]);
  });

  it('still throws on non-missing-table errors', async () => {
    await expect(
      consolidateLessons(sqlWithDrift([], new Error('connection refused')), 'org_1', {})
    ).rejects.toThrow('connection refused');
  });
});
