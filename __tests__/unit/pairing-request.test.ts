import { describe, expect, it } from 'vitest';
import {
  buildPairingRequestMessage,
  parsePairingRequestDirective,
  computeUnidentified,
  PAIRING_REQUEST_KIND,
  PAIRING_REQUEST_SUBJECT,
} from '../../app/lib/pairing-request';

describe('pairing-request directive', () => {
  it('round-trips: built message body parses back to the directive', () => {
    const msg = buildPairingRequestMessage('clawdbot', 'https://dash.example.com');
    expect(msg.from_agent_id).toBe('dashboard');
    expect(msg.to_agent_id).toBe('clawdbot');
    expect(msg.message_type).toBe('action');
    expect(msg.urgent).toBe(true);
    expect(msg.subject).toBe(PAIRING_REQUEST_SUBJECT);
    expect(msg.body.length).toBeLessThanOrEqual(2000); // messages body cap

    const directive = parsePairingRequestDirective(msg.body);
    expect(directive).toMatchObject({
      kind: PAIRING_REQUEST_KIND,
      agent_id: 'clawdbot',
      dashboard_url: 'https://dash.example.com',
    });
  });

  it('parse returns null for non-directive bodies', () => {
    expect(parsePairingRequestDirective('plain message')).toBeNull();
    expect(parsePairingRequestDirective('```json\n{"kind":"other"}\n```')).toBeNull();
    expect(parsePairingRequestDirective(null)).toBeNull();
  });
});

describe('computeUnidentified — baseAgentId collapsing', () => {
  const fleet = [
    { agent_id: 'claude-code', agent_name: 'Claude Code', action_count: 10, last_active: '2026-06-09T00:00:00Z' },
    { agent_id: 'claude-code:explore', agent_name: null, action_count: 4, last_active: '2026-06-10T00:00:00Z' },
    { agent_id: 'deploy-runner', agent_name: 'Deploy Runner', action_count: 7, last_active: '2026-06-08T00:00:00Z' },
    { agent_id: 'paired-agent', agent_name: 'Paired', action_count: 3, last_active: null },
    { agent_id: 'pending-agent', agent_name: 'Pending', action_count: 1, last_active: null },
  ];

  it('collapses composed sub-agents into the base id and excludes covered agents', () => {
    const out = computeUnidentified(fleet, ['paired-agent'], ['pending-agent']);
    const ids = out.map((a) => a.agent_id);
    // Composed claude-code:explore folds into claude-code (sub-agents inherit
    // the parent identity) — exactly one row, summed counts, latest activity.
    expect(ids).toEqual(['claude-code', 'deploy-runner']);
    const cc = out.find((a) => a.agent_id === 'claude-code')!;
    expect(cc.action_count).toBe(14);
    expect(cc.last_active).toBe('2026-06-10T00:00:00Z');
  });

  it('a sub-agent whose PARENT is identified is covered too', () => {
    const out = computeUnidentified(
      [{ agent_id: 'claude-code:research', action_count: 2, last_active: null }],
      ['claude-code'],
      [],
    );
    expect(out).toEqual([]);
  });
});
