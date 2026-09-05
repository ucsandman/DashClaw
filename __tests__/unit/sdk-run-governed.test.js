import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashClaw, GuardBlockedError, ApprovalDeniedError, scrubAct } from '../../sdk/dashclaw.js';

/**
 * Evidence-first guard (v4.63.0): runGoverned / guardedFetch / scrubAct.
 * See docs/superpowers/specs/2026-07-05-evidence-first-guard.md §5.
 */

describe('scrubAct', () => {
  it('strips Authorization/Cookie/x-api-key headers from an http act', () => {
    const act = {
      kind: 'http',
      request: {
        method: 'POST',
        url: 'https://x.test',
        headers: {
          Authorization: 'Bearer abc123',
          Cookie: 'session=1',
          'x-api-key': 'k_live_1',
          'Content-Type': 'application/json',
        },
      },
    };
    const out = scrubAct(act);
    expect(out.request.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('masks oc_live_/sk-/ghp_/Bearer tokens and password=/token=/secret= substrings in command', () => {
    const act = {
      kind: 'shell',
      command: 'curl -H "Authorization: Bearer sk-abcdefghij1234" -d "password=hunter2&token=oc_live_zzz111&secret=ghp_abcdefghijklmnopqrst123" https://x',
    };
    const out = scrubAct(act);
    expect(out.command).not.toContain('sk-abcdefghij1234');
    expect(out.command).not.toContain('hunter2');
    expect(out.command).not.toContain('oc_live_zzz111');
    expect(out.command).not.toContain('ghp_abcdefghijklmnopqrst123');
    expect(out.command).toContain('Bearer [REDACTED]');
    expect(out.command).toContain('password=[REDACTED]');
    expect(out.command).toContain('token=[REDACTED]');
    expect(out.command).toContain('secret=[REDACTED]');
  });

  it('masks sql statement and file content_excerpt', () => {
    expect(scrubAct({ kind: 'sql', statement: "UPDATE users SET token='sk-verysecretvalue1'" }).statement)
      .not.toContain('sk-verysecretvalue1');
    expect(scrubAct({ kind: 'file', file: { path: '.env', content_excerpt: 'API_KEY=sk-verysecretvalue1' } }).file.content_excerpt)
      .not.toContain('sk-verysecretvalue1');
  });

  it('masks body_excerpt on an http act', () => {
    const out = scrubAct({ kind: 'http', request: { method: 'POST', url: 'https://x', body_excerpt: 'token=oc_live_abc123' } });
    expect(out.request.body_excerpt).not.toContain('oc_live_abc123');
  });

  it('is a pure function — does not mutate the input', () => {
    const act = { kind: 'shell', command: 'sk-aaaaaaaaaa' };
    const out = scrubAct(act);
    expect(act.command).toBe('sk-aaaaaaaaaa');
    expect(out.command).toBe('[REDACTED]');
  });

  it('passes through non-object / null / undefined unchanged', () => {
    expect(scrubAct(null)).toBeNull();
    expect(scrubAct(undefined)).toBeUndefined();
    expect(scrubAct('rm -rf /')).toBe('rm -rf /');
  });

  it('leaves benign text untouched', () => {
    const out = scrubAct({ kind: 'shell', command: 'ls -la /tmp' });
    expect(out.command).toBe('ls -la /tmp');
  });
});

describe('runGoverned', () => {
  let claw;

  beforeEach(() => {
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });

  it('guard(allow, recorded) -> fn() -> reportActionOutcome(completed), with ONE call (no createAction)', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'allow', recorded: true, action_id: 'act_1' });
    const createSpy = vi.spyOn(claw, 'createAction');
    const outcomeSpy = vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const fn = vi.fn().mockResolvedValue('done');

    const result = await claw.runGoverned(
      { kind: 'shell', command: 'ls' },
      { action_type: 'other', declared_goal: 'g' },
      fn,
    );

    expect(result).toBe('done');
    expect(claw.guard).toHaveBeenCalledWith(
      { action_type: 'other', declared_goal: 'g', act: { kind: 'shell', command: 'ls' } },
      { record: true },
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(outcomeSpy).toHaveBeenCalledWith('act_1', { status: 'completed' });
  });

  it('falls back to createAction when the guard response did not record (older server, or recording failed)', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'allow', recorded: false, recorded_error: 'boom' });
    const createSpy = vi.spyOn(claw, 'createAction').mockResolvedValue({ action: { status: 'running' }, action_id: 'act_fallback' });
    const outcomeSpy = vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const fn = vi.fn().mockResolvedValue('done');

    const result = await claw.runGoverned(
      { kind: 'shell', command: 'ls' },
      { action_type: 'other', declared_goal: 'g' },
      fn,
    );

    expect(result).toBe('done');
    expect(createSpy).toHaveBeenCalledWith({ action_type: 'other', declared_goal: 'g', act: { kind: 'shell', command: 'ls' } });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(outcomeSpy).toHaveBeenCalledWith('act_fallback', { status: 'completed' });
  });

  it('falls back to createAction when the guard response is recorded but has no action_id (defensive)', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'allow', recorded: true });
    const createSpy = vi.spyOn(claw, 'createAction').mockResolvedValue({ action: { status: 'running' }, action_id: 'act_fallback2' });
    vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const fn = vi.fn().mockResolvedValue('done');

    await claw.runGoverned({ kind: 'shell', command: 'ls' }, { action_type: 'other', declared_goal: 'g' }, fn);

    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('throws GuardBlockedError on block and never calls createAction or fn', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'block', reason: 'Blocked by policy' });
    const createSpy = vi.spyOn(claw, 'createAction');
    const fn = vi.fn();

    await expect(
      claw.runGoverned({ kind: 'shell', command: 'rm -rf /' }, { action_type: 'security', declared_goal: 'g' }, fn)
    ).rejects.toBeInstanceOf(GuardBlockedError);

    expect(createSpy).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it('waits for approval by default when the guard decision is require_approval', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'require_approval', recorded: true, action_id: 'act_2' });
    const createSpy = vi.spyOn(claw, 'createAction');
    const waitSpy = vi.spyOn(claw, 'waitForApproval').mockResolvedValue({});
    vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const fn = vi.fn().mockResolvedValue('ok');

    await claw.runGoverned({ kind: 'shell', command: 'rm x' }, { action_type: 'cleanup', declared_goal: 'g' }, fn);

    expect(createSpy).not.toHaveBeenCalled();
    expect(waitSpy).toHaveBeenCalledWith('act_2');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('wait: false on a pending approval throws ApprovalPendingError and NEVER runs fn (no silent approval bypass)', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'require_approval', recorded: true, action_id: 'act_3' });
    const createSpy = vi.spyOn(claw, 'createAction');
    const waitSpy = vi.spyOn(claw, 'waitForApproval').mockResolvedValue({});
    const outcomeSpy = vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const fn = vi.fn().mockResolvedValue('ok');

    await expect(
      claw.runGoverned(
        { kind: 'shell', command: 'rm x' },
        { action_type: 'cleanup', declared_goal: 'g', wait: false },
        fn,
      )
    ).rejects.toMatchObject({ name: 'ApprovalPendingError', actionId: 'act_3' });

    expect(createSpy).not.toHaveBeenCalled();
    expect(waitSpy).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
    expect(outcomeSpy).not.toHaveBeenCalled();
    expect(claw.guard.mock.calls[0][0]).not.toHaveProperty('wait');
  });

  it('wait: false with an allow decision runs fn normally (no approval involved)', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'allow', recorded: true, action_id: 'act_3b' });
    const waitSpy = vi.spyOn(claw, 'waitForApproval').mockResolvedValue({});
    vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await claw.runGoverned(
      { kind: 'shell', command: 'ls' },
      { action_type: 'cleanup', declared_goal: 'g', wait: false },
      fn,
    );

    expect(result).toBe('ok');
    expect(waitSpy).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('propagates ApprovalDeniedError without calling fn or reporting an outcome', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'require_approval', recorded: true, action_id: 'act_5' });
    vi.spyOn(claw, 'waitForApproval').mockRejectedValue(new ApprovalDeniedError('Denied', 'cancelled'));
    const outcomeSpy = vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const fn = vi.fn();

    await expect(
      claw.runGoverned({ kind: 'shell', command: 'rm x' }, { action_type: 'cleanup', declared_goal: 'g' }, fn)
    ).rejects.toBeInstanceOf(ApprovalDeniedError);

    expect(fn).not.toHaveBeenCalled();
    expect(outcomeSpy).not.toHaveBeenCalled();
  });

  it('reports a failed outcome and rethrows when fn() throws', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'allow', recorded: true, action_id: 'act_6' });
    const outcomeSpy = vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(
      claw.runGoverned({ kind: 'shell', command: 'ls' }, { action_type: 'other', declared_goal: 'g' }, fn)
    ).rejects.toThrow('boom');

    expect(outcomeSpy).toHaveBeenCalledWith('act_6', { status: 'failed', error_message: 'boom' });
  });

  it('scrubs the act before sending it to guard, and to createAction on the fallback path', async () => {
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'allow', recorded: false });
    vi.spyOn(claw, 'createAction').mockResolvedValue({ action: { status: 'running' }, action_id: 'act_7' });
    vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});

    await claw.runGoverned(
      { kind: 'shell', command: 'curl -H "Authorization: Bearer sk-aaaaaaaaaaaa" https://x' },
      { action_type: 'other', declared_goal: 'g' },
      vi.fn().mockResolvedValue(1),
    );

    expect(claw.guard.mock.calls[0][0].act.command).not.toContain('sk-aaaaaaaaaaaa');
    expect(claw.createAction.mock.calls[0][0].act.command).not.toContain('sk-aaaaaaaaaaaa');
  });

  it('makes exactly one HTTP request to /api/guard?record=true on the happy path (no createAction round trip)', async () => {
    vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ decision: 'allow', recorded: true, action_id: 'act_wire_1' }),
    });

    const result = await claw.runGoverned(
      { kind: 'shell', command: 'ls' },
      { action_type: 'other', declared_goal: 'g' },
      vi.fn().mockResolvedValue('done'),
    );

    expect(result).toBe('done');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/guard');
    expect(url).toContain('record=true');
  });
});

describe('guardedFetch', () => {
  let claw;

  beforeEach(() => {
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
    vi.spyOn(claw, 'guard').mockResolvedValue({ decision: 'allow' });
    vi.spyOn(claw, 'createAction').mockResolvedValue({ action: { status: 'running' }, action_id: 'act_http_1' });
    vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  it('derives an http act from url/init and calls the real fetch with the original init', async () => {
    const init = { method: 'POST', body: JSON.stringify({ a: 1 }) };
    const res = await claw.guardedFetch('https://api.example.com/v1/x', init);

    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/v1/x', init);

    const guardCtx = claw.guard.mock.calls[0][0];
    expect(guardCtx.act).toEqual({
      kind: 'http',
      request: { method: 'POST', url: 'https://api.example.com/v1/x', body_excerpt: JSON.stringify({ a: 1 }) },
    });
    expect(guardCtx.action_type).toBe('api');
  });

  it('defaults method to GET and omits body_excerpt when init is omitted', async () => {
    await claw.guardedFetch('https://api.example.com/v1/y');

    const guardCtx = claw.guard.mock.calls[0][0];
    expect(guardCtx.act.request.method).toBe('GET');
    expect(guardCtx.act.request).not.toHaveProperty('body_excerpt');
  });

  it('lets params override the default action_type/declared_goal', async () => {
    await claw.guardedFetch('https://api.example.com/v1/z', {}, { action_type: 'deploy', declared_goal: 'custom goal' });

    const guardCtx = claw.guard.mock.calls[0][0];
    expect(guardCtx.action_type).toBe('deploy');
    expect(guardCtx.declared_goal).toBe('custom goal');
  });

  it('throws GuardBlockedError and never calls the real fetch when guard blocks', async () => {
    claw.guard.mockResolvedValue({ decision: 'block', reason: 'no' });

    await expect(claw.guardedFetch('https://api.example.com/v1/blocked')).rejects.toBeInstanceOf(GuardBlockedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
