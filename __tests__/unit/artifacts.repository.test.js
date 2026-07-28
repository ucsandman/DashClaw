import { describe, expect, it } from 'vitest';
import { shapeArtifact, getLatestPatchRefs } from '../../app/lib/repositories/artifacts.repository.js';

describe('shapeArtifact', () => {
  it('shapes a raw row into an artifact object', () => {
    const row = {
      artifact_id: 'art_1',
      org_id: 'org_1',
      artifact_type: 'json',
      name: 'Step output',
      description: 'Auto-captured',
      content_json: '{"text":"hello"}',
      content_url: null,
      mime_type: 'application/json',
      size_bytes: 42,
      source_action_id: 'act_1',
      source_step_id: 'step_1',
      source_agent_id: 'bot_1',
      retention_days: 90,
      tags_json: '["auto-captured"]',
      metadata_json: '{"step_type":"prompt"}',
      created_at: '2026-04-09T10:00:00Z',
      updated_at: '2026-04-09T10:00:00Z',
    };

    const artifact = shapeArtifact(row);
    expect(artifact.artifact_id).toBe('art_1');
    expect(artifact.content).toEqual({ text: 'hello' });
    expect(artifact.tags).toEqual(['auto-captured']);
    expect(artifact.metadata).toEqual({ step_type: 'prompt' });
    expect(artifact.source_action_id).toBe('act_1');
  });

  it('handles null/malformed JSON gracefully', () => {
    const row = {
      artifact_id: 'art_2',
      org_id: 'org_1',
      artifact_type: 'file',
      name: 'Report',
      content_json: 'not-json',
      tags_json: null,
      metadata_json: null,
    };

    const artifact = shapeArtifact(row);
    expect(artifact.content).toBeNull();
    expect(artifact.tags).toEqual([]);
    expect(artifact.metadata).toEqual({});
  });

  it('returns null for null input', () => {
    expect(shapeArtifact(null)).toBeNull();
  });
});

describe('getLatestPatchRefs', () => {
  const makeSql = (rows) => {
    const calls = [];
    return {
      calls,
      query: (text, params) => {
        calls.push({ text, params });
        return Promise.resolve(rows);
      },
    };
  };

  it('returns {} without querying when the id list is empty', async () => {
    const sql = makeSql([]);
    const out = await getLatestPatchRefs(sql, 'org_1', []);
    expect(out).toEqual({});
    expect(sql.calls).toHaveLength(0);
  });

  it('one batched DISTINCT ON query, newest patch per action, ref parsed from content_json', async () => {
    const sql = makeSql([
      { source_action_id: 'act_1', content_json: '{"ref":"dashclaw/contained-s1","diff":"..."}' },
      { source_action_id: 'act_2', content_json: '{"diff":"no ref captured"}' },
    ]);
    const out = await getLatestPatchRefs(sql, 'org_1', ['act_1', 'act_2', 'act_3']);
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toContain('DISTINCT ON (source_action_id)');
    expect(sql.calls[0].text).toContain("artifact_type = 'patch'");
    expect(sql.calls[0].params).toEqual(['org_1', ['act_1', 'act_2', 'act_3']]);
    // act_1: evidence with a ref; act_2: evidence predating ref capture;
    // act_3: no patch artifact at all -> key absent (distinguishes "no
    // evidence" from "evidence without a ref").
    expect(out).toEqual({
      act_1: { ref: 'dashclaw/contained-s1' },
      act_2: { ref: null },
    });
    expect(out.act_3).toBeUndefined();
  });

  it('malformed content_json degrades to ref null, never a throw', async () => {
    const sql = makeSql([{ source_action_id: 'act_1', content_json: 'not-json' }]);
    const out = await getLatestPatchRefs(sql, 'org_1', ['act_1']);
    expect(out).toEqual({ act_1: { ref: null } });
  });
});
