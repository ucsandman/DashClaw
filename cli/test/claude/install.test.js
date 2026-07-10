// cli/test/claude/install.test.js
//
// Tests for `dashclaw install claude`. All filesystem writes go to a temp
// home dir; network + python probing + prompts are injected.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  installClaude,
  preflight,
  resolvePythonCommand,
  buildHookEntries,
  buildHookEnv,
  mergeClaudeSettings,
  isManagedHookEntry,
  DEFAULT_HOSTED_TRIAL_URL,
} from '../../lib/claude/install.js';

const silentLogger = { log() {}, error() {} };

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dashclaw-claude-install-'));
}

function okFetch() {
  return async () => ({ ok: true, status: 200, json: async () => ({}) });
}

function pythonProbeWith(available) {
  return (cmd) => (available.includes(cmd) ? { status: 0 } : { error: new Error('ENOENT'), status: null });
}

const BASE_OPTS = {
  endpoint: 'http://localhost:9999',
  apiKey: 'oc_live_testkey',
  env: {},
  fetchImpl: okFetch(),
  pythonProbe: pythonProbeWith(['python3', 'python']),
  logger: silentLogger,
};

describe('resolvePythonCommand', () => {
  it('prefers python3 when both are available', () => {
    assert.equal(resolvePythonCommand(pythonProbeWith(['python3', 'python'])), 'python3');
  });

  it('picks python3 when python is absent', () => {
    assert.equal(resolvePythonCommand(pythonProbeWith(['python3'])), 'python3');
  });

  it('falls back to python when python3 is absent', () => {
    assert.equal(resolvePythonCommand(pythonProbeWith(['python'])), 'python');
  });

  it('returns null when neither runs', () => {
    assert.equal(resolvePythonCommand(pythonProbeWith([])), null);
  });

  it('skips a python3 that spawns but exits non-zero (Windows Store alias)', () => {
    const probe = (cmd) => (cmd === 'python3' ? { status: 9009 } : { status: 0 });
    assert.equal(resolvePythonCommand(probe), 'python');
  });
});

describe('preflight', () => {
  it('throws an actionable message when the instance is unreachable', async () => {
    const failing = async () => { throw Object.assign(new Error('fetch failed'), { name: 'TypeError' }); };
    await assert.rejects(
      preflight('http://localhost:9999', 'k', { fetchImpl: failing }),
      /Could not reach http:\/\/localhost:9999\/api\/health/,
    );
  });

  it('throws when the API key is rejected (401)', async () => {
    const fetchImpl = async (url) =>
      url.includes('/api/health') ? { ok: true, status: 200 } : { ok: false, status: 401 };
    await assert.rejects(preflight('http://x', 'bad-key', { fetchImpl }), /key was rejected/);
  });
});

describe('installClaude', () => {
  it('happy path: config + hook .env + settings written, enforce default, python resolved', async () => {
    const home = makeTempHome();
    const result = await installClaude({ ...BASE_OPTS, homeDir: home, agentId: 'my-agent' });

    // ~/.dashclaw/config.json for the CLI
    const config = JSON.parse(fs.readFileSync(path.join(home, '.dashclaw', 'config.json'), 'utf8'));
    assert.equal(config.baseUrl, 'http://localhost:9999');
    assert.equal(config.apiKey, 'oc_live_testkey');
    assert.equal(config.agentId, 'my-agent');

    // Hook credentials in .env beside the scripts — enforce by default on a
    // fresh install, with a per-install 120s approval hold window.
    const envText = fs.readFileSync(result.hookEnvPath, 'utf8');
    assert.match(envText, /DASHCLAW_BASE_URL=http:\/\/localhost:9999/);
    assert.match(envText, /DASHCLAW_API_KEY=oc_live_testkey/);
    assert.match(envText, /DASHCLAW_HOOK_MODE=enforce/);
    assert.match(envText, /DASHCLAW_APPROVAL_TIMEOUT=120/);
    assert.equal(result.hookMode, 'enforce');

    // Hook scripts copied (repo-checkout source in this test environment).
    assert.ok(fs.existsSync(path.join(result.hooksDir, 'dashclaw_pretool.py')));
    assert.ok(fs.existsSync(path.join(result.hooksDir, 'dashclaw_agent_intel', 'http_client.py')));

    // Claude Code settings wired with the resolved python.
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    const pre = settings.hooks.PreToolUse.find(isManagedHookEntry);
    assert.ok(pre, 'managed PreToolUse entry present');
    // --agent-id: per-harness identity declaration on the command line
    // (roadmap v2.2) — argv beats a machine-ambient DASHCLAW_AGENT_ID. The
    // install threads the id chosen at install time (BASE_OPTS: my-agent).
    assert.match(pre.hooks[0].command, /^python3 .*dashclaw_pretool\.py" --agent-id "my-agent"$/);
    assert.ok(settings.hooks.Stop.some(isManagedHookEntry));
    // SessionStart enforcement-liveness probe wired (repo bundle ships it).
    const session = settings.hooks.SessionStart.find(isManagedHookEntry);
    assert.ok(session, 'managed SessionStart probe entry present');
    assert.match(session.hooks[0].command, /enforcement_liveness_probe\.py" --agent-id "my-agent" --source session-start$/);
  });

  it('fresh install writes enforce + 120s timeout; --observe opts back to observe', async () => {
    const home = makeTempHome();
    const observed = await installClaude({ ...BASE_OPTS, homeDir: home, observe: true });
    assert.equal(observed.hookMode, 'observe');
    const envText = fs.readFileSync(observed.hookEnvPath, 'utf8');
    assert.match(envText, /DASHCLAW_HOOK_MODE=observe/);
    // The per-install approval timeout is still written in observe mode.
    assert.match(envText, /DASHCLAW_APPROVAL_TIMEOUT=120/);
  });

  it('re-install PRESERVES an operator-chosen observe mode (never clobbers it back)', async () => {
    const home = makeTempHome();
    // First install fresh → enforce. Operator then steps down to observe.
    const first = await installClaude({ ...BASE_OPTS, homeDir: home });
    fs.writeFileSync(
      first.hookEnvPath,
      'DASHCLAW_BASE_URL=http://localhost:9999\nDASHCLAW_HOOK_MODE=observe\nDASHCLAW_APPROVAL_TIMEOUT=45\n',
    );
    // Re-install (no --observe) must keep observe + the custom 45s timeout.
    const again = await installClaude({ ...BASE_OPTS, homeDir: home });
    assert.equal(again.hookMode, 'observe');
    const envText = fs.readFileSync(again.hookEnvPath, 'utf8');
    assert.match(envText, /DASHCLAW_HOOK_MODE=observe/);
    assert.match(envText, /DASHCLAW_APPROVAL_TIMEOUT=45/);
  });

  it('re-install PRESERVES an operator-chosen enforce mode and a custom timeout', async () => {
    const home = makeTempHome();
    const first = await installClaude({ ...BASE_OPTS, homeDir: home });
    fs.writeFileSync(
      first.hookEnvPath,
      'DASHCLAW_BASE_URL=http://localhost:9999\nDASHCLAW_HOOK_MODE=enforce\nDASHCLAW_APPROVAL_TIMEOUT=300\n',
    );
    const again = await installClaude({ ...BASE_OPTS, homeDir: home });
    assert.equal(again.hookMode, 'enforce');
    assert.match(fs.readFileSync(again.hookEnvPath, 'utf8'), /DASHCLAW_APPROVAL_TIMEOUT=300/);
  });

  it('preflight failure (unreachable) exits non-zero path: rejects and leaves NO config/hooks behind', async () => {
    const home = makeTempHome();
    const failing = async () => { throw Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }); };
    await assert.rejects(
      installClaude({ ...BASE_OPTS, homeDir: home, fetchImpl: failing }),
      /Could not reach/,
    );
    assert.equal(fs.existsSync(path.join(home, '.dashclaw', 'config.json')), false);
    assert.equal(fs.existsSync(path.join(home, '.dashclaw', 'claude-hooks')), false);
    assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false);
  });

  it('preflight failure (401) rejects with an actionable message and writes nothing', async () => {
    const home = makeTempHome();
    const fetchImpl = async (url) =>
      url.includes('/api/health') ? { ok: true, status: 200 } : { ok: false, status: 401 };
    await assert.rejects(installClaude({ ...BASE_OPTS, homeDir: home, fetchImpl }), /key was rejected/);
    assert.equal(fs.existsSync(path.join(home, '.dashclaw', 'config.json')), false);
  });

  it('resolves python3 when python is absent and writes it into settings', async () => {
    const home = makeTempHome();
    const result = await installClaude({
      ...BASE_OPTS,
      homeDir: home,
      pythonProbe: pythonProbeWith(['python3']),
    });
    assert.equal(result.python, 'python3');
    const settings = JSON.parse(fs.readFileSync(result.settingsPath, 'utf8'));
    for (const event of ['PreToolUse', 'PostToolUse', 'Stop']) {
      const entry = settings.hooks[event].find(isManagedHookEntry);
      assert.match(entry.hooks[0].command, /^python3 /);
    }
  });

  it('rejects when no python at all is available', async () => {
    const home = makeTempHome();
    await assert.rejects(
      installClaude({ ...BASE_OPTS, homeDir: home, pythonProbe: pythonProbeWith([]) }),
      /No python3 or python found/,
    );
  });

  it('--trial without a key prints/opens the signup URL and accepts the pasted key', async () => {
    const home = makeTempHome();
    const opened = [];
    const prompts = [];
    const result = await installClaude({
      ...BASE_OPTS,
      endpoint: undefined,
      apiKey: undefined,
      trial: true,
      homeDir: home,
      env: { DASHCLAW_HOSTED_URL: 'https://hosted.example' },
      openUrl: (url) => opened.push(url),
      prompt: async (q) => { prompts.push(q); return 'should-not-be-used'; },
      promptSecret: async (q) => { prompts.push(q); return 'oc_live_pasted_trial_key'; },
    });

    assert.deepEqual(opened, ['https://hosted.example/connect']);
    assert.ok(prompts.some((q) => /trial API key/.test(q)), 'prompted for the pasted key');
    assert.equal(result.endpoint, 'https://hosted.example');

    const config = JSON.parse(fs.readFileSync(path.join(home, '.dashclaw', 'config.json'), 'utf8'));
    assert.equal(config.apiKey, 'oc_live_pasted_trial_key');
    assert.equal(config.baseUrl, 'https://hosted.example');
  });

  it('--trial with no endpoint anywhere defaults to the public hosted trial URL (v5.4: a cold outsider cannot answer a URL prompt)', async () => {
    const home = makeTempHome();
    const opened = [];
    const prompts = [];
    const result = await installClaude({
      ...BASE_OPTS,
      endpoint: undefined,
      apiKey: undefined,
      trial: true,
      homeDir: home,
      env: {},
      openUrl: (url) => opened.push(url),
      prompt: async (q) => { prompts.push(q); throw new Error('URL prompt must not appear on the trial path'); },
      promptSecret: async () => 'oc_live_pasted_trial_key',
    });

    assert.deepEqual(opened, [`${DEFAULT_HOSTED_TRIAL_URL}/connect`]);
    assert.equal(result.endpoint, DEFAULT_HOSTED_TRIAL_URL);
    assert.ok(!prompts.some((q) => /URL/.test(q)), 'no URL prompt on the cold trial path');
  });

  it('re-install replaces managed settings entries instead of duplicating them', async () => {
    const home = makeTempHome();
    await installClaude({ ...BASE_OPTS, homeDir: home });
    const again = await installClaude({ ...BASE_OPTS, homeDir: home });
    const settings = JSON.parse(fs.readFileSync(again.settingsPath, 'utf8'));
    assert.equal(settings.hooks.PreToolUse.filter(isManagedHookEntry).length, 1);
    assert.equal(settings.hooks.Stop.filter(isManagedHookEntry).length, 1);
    // The SessionStart probe entry is also deduped, not duplicated.
    assert.equal(settings.hooks.SessionStart.filter(isManagedHookEntry).length, 1);
  });

  it('preserves user-authored hook entries and other settings keys', async () => {
    const home = makeTempHome();
    const settingsPath = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      model: 'opus',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-hook.sh' }] }] },
    }));

    await installClaude({ ...BASE_OPTS, homeDir: home });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.model, 'opus');
    assert.ok(settings.hooks.PreToolUse.some((e) => e.hooks?.[0]?.command === 'my-own-hook.sh'));
    assert.ok(settings.hooks.PreToolUse.some(isManagedHookEntry));
    // Backup created once.
    assert.ok(fs.existsSync(settingsPath + '.dashclaw-bak'));
  });
});

describe('buildHookEntries / buildHookEnv', () => {
  it('hook commands point at the hooks dir with the given python', () => {
    const entries = buildHookEntries('/tmp/hooks', 'python3');
    assert.match(entries.PreToolUse[0].hooks[0].command, /^python3 ".*dashclaw_pretool\.py" --agent-id "claude-code"$/);
    // Seconds — a ms-scale value here overflows the harness timer and the
    // hook is cancelled instantly (fail-open). Must stay under 2147483.
    assert.equal(entries.PreToolUse[0].hooks[0].timeout, 3660);
    assert.ok(entries.PreToolUse[0].hooks[0].timeout < 2147483);
    assert.equal(entries.Stop[0].matcher, undefined);
  });

  it('hook commands carry a custom agent id when one is chosen at install', () => {
    const entries = buildHookEntries('/tmp/hooks', 'python3', 'my-claude');
    assert.match(entries.Stop[0].hooks[0].command, / --agent-id "my-claude"$/);
  });

  it('matches the Workflow tool so dynamic-workflow fan-outs are governed (v4.3)', () => {
    const entries = buildHookEntries('/tmp/hooks', 'python3');
    assert.match(entries.PreToolUse[0].matcher, /Workflow/);
    assert.match(entries.PostToolUse[0].matcher, /Workflow/);
  });

  it('hook env keeps the observe param default (backward compat for direct callers) and writes a 120s timeout', () => {
    const env = buildHookEnv({ endpoint: 'http://x', apiKey: 'k', agentId: 'a' });
    assert.match(env, /DASHCLAW_HOOK_MODE=observe/);
    assert.match(env, /DASHCLAW_APPROVAL_TIMEOUT=120/);
  });

  it('hook env passes through an explicit enforce mode + timeout', () => {
    const env = buildHookEnv({ endpoint: 'http://x', apiKey: 'k', agentId: 'a', hookMode: 'enforce', approvalTimeout: 300 });
    assert.match(env, /DASHCLAW_HOOK_MODE=enforce/);
    assert.match(env, /DASHCLAW_APPROVAL_TIMEOUT=300/);
  });

  it('wires the SessionStart probe when enforcement_liveness_probe.py is present, omits it when absent', () => {
    const home = makeTempHome();
    // Absent: a bare hooks dir has no probe script → no SessionStart entry.
    const bareDir = path.join(home, 'bare-hooks');
    fs.mkdirSync(bareDir, { recursive: true });
    const withoutProbe = buildHookEntries(bareDir, 'python3');
    assert.equal(withoutProbe.SessionStart, undefined);

    // Present: dropping the script in makes the SessionStart entry appear, and
    // its command ends with --source session-start.
    const probeDir = path.join(home, 'probe-hooks');
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, 'enforcement_liveness_probe.py'), '# probe');
    const withProbe = buildHookEntries(probeDir, 'python3', 'my-claude');
    assert.ok(withProbe.SessionStart, 'SessionStart entry present when the probe script exists');
    assert.match(withProbe.SessionStart[0].hooks[0].command, / --agent-id "my-claude" --source session-start$/);
    assert.equal(withProbe.SessionStart[0].hooks[0].timeout, 10);
    // mergeClaudeSettings recognizes the probe entry as managed.
    assert.ok(isManagedHookEntry(withProbe.SessionStart[0]));
  });
});

describe('mergeClaudeSettings', () => {
  it('throws a readable error on malformed settings.json', () => {
    const home = makeTempHome();
    const settingsPath = path.join(home, 'settings.json');
    fs.writeFileSync(settingsPath, '{not json');
    assert.throws(() => mergeClaudeSettings(settingsPath, '/tmp/hooks', 'python3'), /not valid JSON/);
  });
});
