import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getNodeStarterSnippet, getPythonStarterSnippet } from '@/lib/starterSnippet';
import { getSdkCommands } from '@/lib/readiness/sdkCheck.mjs';

// Public code snippets are part of the product contract: a snippet that
// calls guard() alone creates no action record, and a snippet that never
// reports an outcome leaves the action stuck in the dashboard. These tests
// pin every public snippet to the full record-and-complete loop so drift
// fails CI instead of shipping to dashclaw.io.

function readRepoFile(relativePath) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('canonical starter snippets (app/lib/starterSnippet.ts)', () => {
  it('the Node starter runs the full loop with all required constructor args', () => {
    const snippet = getNodeStarterSnippet();
    expect(snippet).toContain('baseUrl');
    expect(snippet).toContain('apiKey');
    expect(snippet).toContain('agentId');
    expect(snippet).toContain('claw.guard(');
    expect(snippet).toContain('claw.createAction(');
    expect(snippet).toContain('claw.updateOutcome(');
  });

  it('the Python starter runs the full loop with all required constructor args', () => {
    const snippet = getPythonStarterSnippet();
    expect(snippet).toContain('import os');
    expect(snippet).toContain('base_url');
    expect(snippet).toContain('api_key');
    expect(snippet).toContain('agent_id');
    expect(snippet).toContain('claw.guard(');
    expect(snippet).toContain('claw.create_action(');
    expect(snippet).toContain('claw.update_outcome(');
  });
});

describe('SDK validator commands (app/lib/readiness/sdkCheck.mjs)', () => {
  const commands = getSdkCommands('example.com');

  it('the Node validator creates and completes a real action (no ping — the SDK has none)', () => {
    expect(commands.node).toContain('agentId');
    expect(commands.node).toContain('createAction');
    expect(commands.node).toContain('updateOutcome');
    expect(commands.node).not.toContain('.ping(');
  });

  it('the Python validator creates and completes a real action (no ping — the SDK has none)', () => {
    expect(commands.python).toContain('agent_id');
    expect(commands.python).toContain('create_action');
    expect(commands.python).toContain('update_outcome');
    expect(commands.python).not.toContain('.ping(');
  });

  it('the Python live-proof capture runs a real SDK round-trip before posting proof', () => {
    expect(commands.pythonCapture).toContain('from dashclaw import DashClaw');
    expect(commands.pythonCapture).toContain('agent_id');
    expect(commands.pythonCapture).toContain('create_action');
    expect(commands.pythonCapture).toContain('update_outcome');
    expect(commands.pythonCapture).toContain('/api/setup/live-proof');
    // The SDK round-trip must come before the proof POST, so a failed
    // round-trip raises and no claimed-success payload is ever sent.
    expect(commands.pythonCapture.indexOf('create_action')).toBeLessThan(
      commands.pythonCapture.indexOf('urllib.request.Request'),
    );
  });
});

describe('framework guide snippets promise the full loop', () => {
  it('LangGraph guide snippet is self-contained and reports an outcome', () => {
    const source = readRepoFile('app/guides/langgraph/page.tsx');
    expect(source).toContain('import os');
    expect(source).toContain('def research_node');
    expect(source).toContain('update_outcome(');
  });

  it('CrewAI guide snippet imports os and reports an outcome', () => {
    const source = readRepoFile('app/guides/crewai/page.tsx');
    expect(source).toContain('import os');
    expect(source).toContain('update_outcome(');
  });

  it('OpenAI Agents SDK guide snippet records and completes an action', () => {
    const source = readRepoFile('app/guides/openai-agents-sdk/page.tsx');
    expect(source).toContain('createAction');
    expect(source).toContain('updateOutcome');
  });

  it('the shared guide component describes guardrails.yml as an importable template, not auto-discovered', () => {
    const source = readRepoFile('app/guides/GuideClient.tsx');
    expect(source).toContain('/api/policies/import');
    expect(source).not.toContain('without code changes');
  });
});

describe('public docs snippets', () => {
  it('the /docs quickstart records and completes an action', () => {
    const source = readRepoFile('app/docs/page.tsx');
    expect(source).toContain('createAction');
    expect(source).toContain('updateOutcome');
  });

  it('client-setup-guide validators construct the SDK with agent_id and never call ping', () => {
    const source = readRepoFile('docs/client-setup-guide.md');
    expect(source).toContain('agent_id="setup-validator"');
    expect(source).not.toContain('.ping(');
  });
});
