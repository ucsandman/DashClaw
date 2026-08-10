import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readExample(name) {
  return readFileSync(path.join(process.cwd(), 'examples', 'proof-pack', name), 'utf8');
}

describe('Proof Pack examples', () => {
  it('Node example keeps the complete, approval-aware evidence loop', () => {
    const source = readExample('proof-pack.mjs');
    expect(source).toContain('new DashClaw({');
    expect(source).toContain('agentId');
    expect(source).toContain('claw.guard(');
    expect(source).toContain('claw.createAction(');
    expect(source).toContain('action?.status === \'pending_approval\'');
    expect(source).toContain('claw.waitForApproval(action_id');
    expect(source).toContain('claw.updateOutcome(action_id, {');
    expect(source).toContain('status: \'completed\'');
    expect(source).toContain('status: \'failed\'');
    expect(source).toContain('/decisions/${action_id}');
  });

  it('Python example keeps the complete, approval-aware evidence loop', () => {
    const source = readExample('proof_pack.py');
    expect(source).toContain('DashClaw(');
    expect(source).toContain('agent_id=AGENT_ID');
    expect(source).toContain('claw.guard(');
    expect(source).toContain('claw.create_action(');
    expect(source).toContain('action.get("status") == "pending_approval"');
    expect(source).toContain('claw.wait_for_approval(action_id');
    expect(source).toContain('claw.update_outcome(');
    expect(source).toContain('status="completed"');
    expect(source).toContain('status="failed"');
    expect(source).toContain('decisions/{action_id}');
  });

  it('README tells users exactly where the proof will appear', () => {
    const readme = readExample('README.md');
    expect(readme).toContain('/decisions/<action-id>');
    expect(readme).toContain('/approvals');
  });
});
