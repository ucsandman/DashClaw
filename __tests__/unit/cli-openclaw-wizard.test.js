import { describe, expect, it } from 'vitest';
import { resolveOpenclawOnboarding, defaultAgentId } from '../../cli/lib/openclaw/wizard.js';
import { DEFAULT_HOSTED_TRIAL_URL } from '../../cli/lib/trial.js';

/** Scripted prompt: answers are consumed in order; running out is a test bug. */
function scriptedPrompt(answers) {
  const asked = [];
  const fn = async (question) => {
    asked.push(question);
    if (answers.length === 0) throw new Error(`Unexpected prompt: ${question}`);
    return answers.shift();
  };
  fn.asked = asked;
  return fn;
}

const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

describe('defaultAgentId', () => {
  it('slugs the hostname and appends -openclaw', () => {
    expect(defaultAgentId('MoltFire')).toBe('moltfire-openclaw');
    expect(defaultAgentId('ip-172-31-29-184')).toBe('ip-172-31-29-184-openclaw');
    expect(defaultAgentId('Wes Laptop!')).toBe('wes-laptop-openclaw');
  });

  it('falls back to plain openclaw when the hostname yields nothing', () => {
    expect(defaultAgentId('')).toBe('openclaw');
    expect(defaultAgentId('---')).toBe('openclaw');
  });
});

describe('resolveOpenclawOnboarding', () => {
  it('non-interactive: returns inputs unchanged and never prompts', async () => {
    const prompt = scriptedPrompt([]);
    const out = await resolveOpenclawOnboarding({
      baseUrl: null, apiKey: null, agentId: null,
      interactive: false, prompt, logger: silentLogger,
    });
    expect(out).toEqual({ baseUrl: null, apiKey: null, agentId: null, upHandle: null });
    expect(prompt.asked).toHaveLength(0);
  });

  it('everything provided: zero prompts even when interactive', async () => {
    const prompt = scriptedPrompt([]);
    const out = await resolveOpenclawOnboarding({
      baseUrl: 'https://dc.example.com', apiKey: 'oc_live_k', agentId: 'forge-openclaw',
      interactive: true, prompt, logger: silentLogger,
    });
    expect(out.baseUrl).toBe('https://dc.example.com');
    expect(out.apiKey).toBe('oc_live_k');
    expect(out.agentId).toBe('forge-openclaw');
    expect(prompt.asked).toHaveLength(0);
  });

  it('has an instance: prompts for URL, key, and agent id (hostname default offered)', async () => {
    const prompt = scriptedPrompt([
      'y',                              // running instance?
      'https://dc.example.com/',        // URL (trailing slash stripped)
      '',                               // agent id -> accept default
      'n',                              // save config?
    ]);
    const promptSecret = scriptedPrompt(['oc_live_pasted']);
    const out = await resolveOpenclawOnboarding({
      interactive: true, prompt, promptSecret, host: 'cinder', logger: silentLogger,
    });
    expect(out.baseUrl).toBe('https://dc.example.com');
    expect(out.apiKey).toBe('oc_live_pasted');
    expect(out.agentId).toBe('cinder-openclaw');
    expect(out.upHandle).toBeNull();
  });

  it('no instance + hosted trial: opens the signup page and uses the pasted key', async () => {
    const opened = [];
    const prompt = scriptedPrompt([
      'n',        // running instance?
      '1',        // hosted trial
      'moltfire', // agent id (explicit)
      'n',        // save config?
    ]);
    const promptSecret = scriptedPrompt(['oc_live_trial_key']);
    const out = await resolveOpenclawOnboarding({
      interactive: true, prompt, promptSecret,
      openUrl: (u) => opened.push(u), logger: silentLogger,
    });
    expect(opened).toEqual([`${DEFAULT_HOSTED_TRIAL_URL}/connect`]);
    expect(out.baseUrl).toBe(DEFAULT_HOSTED_TRIAL_URL);
    expect(out.apiKey).toBe('oc_live_trial_key');
    expect(out.agentId).toBe('moltfire');
  });

  it('no instance + local: runs up inline and carries its key and handle forward', async () => {
    const handle = { child: { pid: 1 }, stopDb: async () => {}, reusedServer: false };
    let ranUp = false;
    const prompt = scriptedPrompt([
      'n',   // running instance?
      '2',   // local install
      '',    // agent id -> default
      'n',   // save config?
    ]);
    const out = await resolveOpenclawOnboarding({
      interactive: true, prompt, host: 'cinder', logger: silentLogger,
      runUpLocal: async () => {
        ranUp = true;
        return { baseUrl: 'http://localhost:3000', apiKey: 'oc_live_local', upHandle: handle };
      },
    });
    expect(ranUp).toBe(true);
    expect(out.baseUrl).toBe('http://localhost:3000');
    expect(out.apiKey).toBe('oc_live_local');
    expect(out.upHandle).toBe(handle);
    expect(out.agentId).toBe('cinder-openclaw');
  });

  it('no instance + local when runUpLocal is unavailable: fails with a next step, not a stack of nulls', async () => {
    const prompt = scriptedPrompt(['n', '2']);
    await expect(resolveOpenclawOnboarding({
      interactive: true, prompt, logger: silentLogger,
    })).rejects.toThrow(/dashclaw up/);
  });

  it('key missing against a hosted-trial base URL: reuses the trial paste flow', async () => {
    const opened = [];
    const prompt = scriptedPrompt(['', 'n']); // agent id default, no save
    const promptSecret = scriptedPrompt(['oc_live_trial2']);
    const out = await resolveOpenclawOnboarding({
      baseUrl: DEFAULT_HOSTED_TRIAL_URL,
      interactive: true, prompt, promptSecret, host: 'cinder',
      openUrl: (u) => opened.push(u), logger: silentLogger,
    });
    expect(opened).toEqual([`${DEFAULT_HOSTED_TRIAL_URL}/connect`]);
    expect(out.apiKey).toBe('oc_live_trial2');
  });

  it('key missing against a self-hosted base URL: plain paste prompt, no browser open', async () => {
    const opened = [];
    const prompt = scriptedPrompt(['', 'n']);
    const promptSecret = scriptedPrompt(['oc_live_selfhosted']);
    const out = await resolveOpenclawOnboarding({
      baseUrl: 'https://dc.example.com',
      interactive: true, prompt, promptSecret, host: 'cinder',
      openUrl: (u) => opened.push(u), logger: silentLogger,
    });
    expect(opened).toEqual([]);
    expect(out.apiKey).toBe('oc_live_selfhosted');
  });

  it('save offer merges into existing config instead of clobbering it', async () => {
    let written = null;
    const prompt = scriptedPrompt(['y', 'https://dc.example.com', '', 'y']);
    const promptSecret = scriptedPrompt(['oc_live_new']);
    await resolveOpenclawOnboarding({
      interactive: true, prompt, promptSecret, host: 'cinder', logger: silentLogger,
      readConfig: () => ({ agentId: 'cli-operator', extra: 'kept' }),
      writeConfig: (cfg) => { written = cfg; },
    });
    expect(written).toEqual({
      agentId: 'cli-operator', extra: 'kept',
      baseUrl: 'https://dc.example.com', apiKey: 'oc_live_new',
    });
  });

  it('no save offer when nothing new was obtained (only the agent id was prompted)', async () => {
    let written = null;
    const prompt = scriptedPrompt(['']); // agent id default only
    const out = await resolveOpenclawOnboarding({
      baseUrl: 'https://dc.example.com', apiKey: 'oc_live_k',
      interactive: true, prompt, host: 'cinder', logger: silentLogger,
      readConfig: () => ({}), writeConfig: (cfg) => { written = cfg; },
    });
    expect(out.agentId).toBe('cinder-openclaw');
    expect(written).toBeNull();
  });

  it('a failed config save warns but does not fail the onboarding', async () => {
    const warnings = [];
    const prompt = scriptedPrompt(['y', 'https://dc.example.com', '', 'y']);
    const promptSecret = scriptedPrompt(['oc_live_new']);
    const out = await resolveOpenclawOnboarding({
      interactive: true, prompt, promptSecret, host: 'cinder',
      logger: { log: () => {}, warn: (m) => warnings.push(m), error: () => {} },
      readConfig: () => ({}),
      writeConfig: () => { throw new Error('disk full'); },
    });
    expect(out.apiKey).toBe('oc_live_new');
    expect(warnings.some((w) => /disk full/.test(w))).toBe(true);
  });
});
