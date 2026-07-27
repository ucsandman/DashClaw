import { describe, it, expect } from 'vitest';
import { validateActionRecord, validateGuardInput, validateOpenLoop, isValidWebhookUrl } from '@/lib/validate';

describe('validators tolerate a null or non-object body (no 500 crash)', () => {
  // request.json() returns the value `null` for the literal body `null` without
  // throwing, so a client POSTing `null` must get a 400 (valid:false), not a
  // TypeError that surfaces as a generic 500.
  it('validateActionRecord(null) returns valid:false without throwing', () => {
    const result = validateActionRecord(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('action_type is required');
  });

  it('validateGuardInput(null) returns valid:false without throwing', () => {
    const result = validateGuardInput(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('action_type is required');
  });

  it('validateOpenLoop(null) returns valid:false without throwing', () => {
    expect(() => validateOpenLoop(null)).not.toThrow();
    expect(validateOpenLoop(null).valid).toBe(false);
  });

  it('non-object bodies (undefined, primitive) do not throw', () => {
    expect(() => validateActionRecord(undefined)).not.toThrow();
    expect(() => validateGuardInput('not an object')).not.toThrow();
    expect(validateActionRecord(42).valid).toBe(false);
  });

  it('a present camelCase value is not dropped by an explicit snake_case null', () => {
    const result = validateActionRecord({
      agent_id: 'a',
      action_type: 'deploy',
      declared_goal: 'g',
      risk_score: null,
      riskScore: 80,
    });
    expect(result.valid).toBe(true);
    expect(result.data.risk_score).toBe(80);
  });
});

describe('validateGuardInput preserves governance signals the guard engine reads', () => {
  // Regression: GUARD_INPUT_SCHEMA previously omitted intel/tool/write_paths, so
  // validate() stripped them before evaluateGuard ran — silently disabling
  // green_contract, branch_freshness, permission_escalation, and protected_path
  // over HTTP. These must survive validation and reach context.* unchanged.
  it('keeps intel (with nested branch/green/tool), top-level tool, and write_paths', () => {
    const result = validateGuardInput({
      action_type: 'deploy',
      agent_id: 'claude-code',
      intel: {
        branch: { freshness: 'stale' },
        green: { observed_level: 'red' },
        tool: { required_permission: 'danger' },
        mcp: { healthy: false },
      },
      tool: { name: 'Bash', category: 'execution', required_permission: 'danger' },
      write_paths: ['app/lib/guard.js', '.env'],
    });
    expect(result.valid).toBe(true);
    expect(result.data.intel?.branch?.freshness).toBe('stale');
    expect(result.data.intel?.green?.observed_level).toBe('red');
    expect(result.data.intel?.tool?.required_permission).toBe('danger');
    expect(result.data.tool?.required_permission).toBe('danger');
    expect(result.data.write_paths).toEqual(['app/lib/guard.js', '.env']);
  });

  it('rejects a write_paths array containing a non-string', () => {
    const result = validateGuardInput({ action_type: 'deploy', write_paths: ['ok', 123] });
    expect(result.valid).toBe(false);
  });
});

// RFC 2026-07-06-containment-verdicts, Task 4: client_capabilities advertises
// containment support (e.g. 'allow_contained'). Bounded to at most 8 short
// capability strings — it is a negotiation signal, not a free-form bag.
describe('validateGuardInput — client_capabilities', () => {
  it('rejects client_capabilities as a string', () => {
    const result = validateGuardInput({ action_type: 'deploy', client_capabilities: 'allow_contained' });
    expect(result.valid).toBe(false);
  });

  it('rejects a 9-entry array', () => {
    const result = validateGuardInput({
      action_type: 'deploy',
      client_capabilities: Array.from({ length: 9 }, (_, i) => `cap-${i}`),
    });
    expect(result.valid).toBe(false);
  });

  it('accepts a valid single-capability array', () => {
    const result = validateGuardInput({ action_type: 'deploy', client_capabilities: ['allow_contained'] });
    expect(result.valid).toBe(true);
    expect(result.data.client_capabilities).toEqual(['allow_contained']);
  });
});

describe('validateActionRecord', () => {
  it('should validate a correct action record', () => {
    const validRecord = {
      agent_id: 'agent-123',
      action_type: 'build',
      declared_goal: 'Build the project',
    };
    const result = validateActionRecord(validRecord);
    expect(result.valid).toBe(true);
    expect(result.data.agent_id).toBe('agent-123');
  });

  it('should fail if required fields are missing', () => {
    const invalidRecord = {
      agent_id: 'agent-123',
      // action_type is missing
    };
    const result = validateActionRecord(invalidRecord);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('action_type is required');
  });

  it('should accept arbitrary action_type strings (agent frameworks send raw tool names)', () => {
    const record = {
      agent_id: 'agent-123',
      action_type: 'read',
      declared_goal: 'Read a file',
    };
    const result = validateActionRecord(record);
    expect(result.valid).toBe(true);
    expect(result.data.action_type).toBe('read');
  });

  it('should allow recommendation metadata fields', () => {
    const validRecord = {
      agent_id: 'agent-123',
      action_type: 'build',
      declared_goal: 'Build the project',
      recommendation_id: 'lrec_123',
      recommendation_applied: false,
      recommendation_override_reason: 'warn_mode_no_autoadapt',
    };
    const result = validateActionRecord(validRecord);
    expect(result.valid).toBe(true);
    expect(result.data.recommendation_id).toBe('lrec_123');
    expect(result.data.recommendation_applied).toBe(false);
  });

  it('normalizes Date.toString()-style timestamps to ISO (breaks ::timestamptz casts otherwise)', () => {
    const record = {
      agent_id: 'agent-123',
      action_type: 'build',
      declared_goal: 'Build the project',
      timestamp_start: 'Thu Jun 11 2026 15:45:25 GMT-0400',
    };
    const result = validateActionRecord(record);
    expect(result.valid).toBe(true);
    expect(result.data.timestamp_start).toBe('2026-06-11T19:45:25.000Z');
  });

  it('passes ISO timestamps through unchanged', () => {
    const record = {
      agent_id: 'agent-123',
      action_type: 'build',
      declared_goal: 'Build the project',
      timestamp_start: '2026-06-11T19:45:25.000Z',
      timestamp_end: '2026-06-11T19:46:00.000Z',
    };
    const result = validateActionRecord(record);
    expect(result.valid).toBe(true);
    expect(result.data.timestamp_start).toBe('2026-06-11T19:45:25.000Z');
    expect(result.data.timestamp_end).toBe('2026-06-11T19:46:00.000Z');
  });

  it('rejects unparseable timestamps', () => {
    const record = {
      agent_id: 'agent-123',
      action_type: 'build',
      declared_goal: 'Build the project',
      timestamp_start: 'not-a-date',
    };
    const result = validateActionRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/timestamp_start must be a parseable timestamp/);
  });
});

describe('isValidWebhookUrl', () => {
  it('should allow valid external HTTPS URLs', () => {
    expect(isValidWebhookUrl('https://api.slack.com/webhooks')).toBe(null);
    expect(isValidWebhookUrl('https://discord.com/api/webhooks')).toBe(null);
  });

  it('should block non-HTTPS URLs', () => {
    expect(isValidWebhookUrl('http://api.slack.com')).toBe('URL must use HTTPS');
    expect(isValidWebhookUrl('ftp://server.com')).toBe('URL must use HTTPS');
  });

  it('should block localhost and loopback', () => {
    expect(isValidWebhookUrl('https://localhost')).toContain('cannot point to localhost');
    expect(isValidWebhookUrl('https://127.0.0.1')).toContain('cannot point to localhost');
    expect(isValidWebhookUrl('https://[::1]')).toContain('cannot point to localhost');
  });

  it('should block private networks', () => {
    expect(isValidWebhookUrl('https://10.0.0.1')).toContain('cannot point to localhost');
    expect(isValidWebhookUrl('https://192.168.1.1')).toContain('cannot point to localhost');
    expect(isValidWebhookUrl('https://172.16.0.1')).toContain('cannot point to localhost');
  });

  it('should block invalid/internal domains', () => {
    expect(isValidWebhookUrl('https://server.local')).toContain('invalid domains');
    expect(isValidWebhookUrl('https://api.internal')).toContain('invalid domains');
    expect(isValidWebhookUrl('https://test.onion')).toContain('invalid domains');
  });
});
