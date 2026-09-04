import { describe, expect, it } from 'vitest';
import { classifyAct, evidenceTotal } from '@/lib/guard/evidence.js';
import { validateGuardInput } from '@/lib/validate.js';
import { NEVER_PRECEDENTED } from '@/lib/policy-shapes.js';

// Spend evidence class (2026-09-04). An agent bought two domains from
// `node domain-buy.mjs <name>` inside a governed Bash call: the command text
// carried no money signal, graded other/30, and the org's spend line never
// fired. A purchase endpoint / purchase CLI / purchasing script body now
// grades `spend` so the declared→derived type swap reaches the spend policies.

const BUY_SCRIPT = `
import fs from "node:fs";
const token = fs.readFileSync("C:/Users/x/clawd/secrets/vercel.txt", "utf8").trim();
const H = { Authorization: \`Bearer \${token}\` };
const r = await fetch(\`https://api.vercel.com/v1/registrar/domains/\${name}/buy?teamId=team_x\`, { method: "POST", headers: H });
`;

describe('classifyAct — spend (shell)', () => {
  it('grades a POST to a registrar buy endpoint as spend', () => {
    const c = classifyAct({ kind: 'shell', command: 'curl -X POST -H "Authorization: Bearer x" https://api.vercel.com/v1/registrar/domains/example.com/buy?teamId=t' });
    expect(c.derived_action_type).toBe('spend');
    expect(c.base_risk).toBe(75);
    expect(c.flags).toContain('spend');
    expect(c.reversible_hint).toBe(false);
  });

  it('keeps a registrar price / availability lookup out of the spend class', () => {
    for (const path of ['price', 'availability']) {
      const c = classifyAct({ kind: 'shell', command: `curl https://api.vercel.com/v1/registrar/domains/example.com/${path}?teamId=t` });
      expect(c.derived_action_type).not.toBe('spend');
      expect(c.flags).not.toContain('spend');
    }
  });

  it('treats a purchase URL printed by a read/print command as data', () => {
    const c = classifyAct({ kind: 'shell', command: 'echo https://api.vercel.com/v1/registrar/domains/example.com/buy' });
    expect(c.derived_action_type).toBe('review');
    expect(c.flags).not.toContain('spend');
  });

  it('grades purchase CLIs as spend', () => {
    for (const command of ['vercel domains buy example.com', 'stripe payment_intents create --amount 1000', 'agentcash pay --to x --amount 5']) {
      const c = classifyAct({ kind: 'shell', command });
      expect(c.derived_action_type, command).toBe('spend');
      expect(c.flags, command).toContain('spend');
    }
  });

  it('grades a Stripe charge / checkout POST as spend', () => {
    const c = classifyAct({ kind: 'shell', command: 'curl -X POST https://api.stripe.com/v1/checkout/sessions -d mode=payment' });
    expect(c.derived_action_type).toBe('spend');
  });

  it('spend picks the highest-risk segment in a chain like every other class', () => {
    const c = classifyAct({ kind: 'shell', command: 'cd ~/clawd && curl -X POST https://api.vercel.com/v1/registrar/domains/x.com/buy && echo done' });
    expect(c.derived_action_type).toBe('spend');
    expect(evidenceTotal(c)).toBe(75);
  });

  it('a plain interpreter invocation without a script body is unchanged (other/30)', () => {
    const c = classifyAct({ kind: 'shell', command: 'node tmp/tradesdesk-launch/domain-buy.mjs example.com' });
    expect(c.derived_action_type).toBe('other');
    expect(c.flags).not.toContain('spend');
  });
});

describe('classifyAct — spend (script body)', () => {
  it('the incident shape: node <script> whose body buys a domain grades spend', () => {
    const c = classifyAct({
      kind: 'shell',
      command: 'cd ~/clawd && node tmp/tradesdesk-launch/domain-buy.mjs example.com',
      script: { path: 'tmp/tradesdesk-launch/domain-buy.mjs', content_excerpt: BUY_SCRIPT },
    });
    expect(c.derived_action_type).toBe('spend');
    expect(c.flags).toContain('spend');
    expect(c.flags).toContain('script_content');
    expect(c.flags).toContain('sensitive_path');
    expect(c.reversible_hint).toBe(false);
    expect(evidenceTotal(c)).toBe(90);
  });

  it('a script body that only reads (no purchase, no delete) leaves the command grade alone', () => {
    const c = classifyAct({
      kind: 'shell',
      command: 'node tmp/domain-price.mjs example.com',
      script: { path: 'tmp/domain-price.mjs', content_excerpt: 'const r = await fetch("https://api.vercel.com/v1/registrar/domains/x/price"); console.log(await r.json());' },
    });
    expect(c.derived_action_type).toBe('other');
    expect(c.flags).not.toContain('spend');
    expect(c.flags).not.toContain('script_content');
  });

  it('a destructive script body outranks the spend grade', () => {
    const c = classifyAct({
      kind: 'shell',
      command: 'python cleanup.py',
      script: { path: 'cleanup.py', content_excerpt: 'import shutil\nshutil.rmtree("/srv/data")\nrequests.post("https://api.stripe.com/v1/charges")' },
    });
    expect(c.derived_action_type).toBe('security');
    expect(c.flags).toContain('interpreter_destructive');
  });

  it('a destructive inline command still wins over a mild script body', () => {
    const c = classifyAct({
      kind: 'shell',
      command: 'rm -rf / && node x.mjs',
      script: { path: 'x.mjs', content_excerpt: 'console.log(1)' },
    });
    expect(c.flags).toContain('protected_target');
  });
});

describe('classifyAct — spend (http)', () => {
  it('a POST to a purchase endpoint grades spend (sensitive-host bump kept)', () => {
    const c = classifyAct({ kind: 'http', request: { method: 'POST', url: 'https://api.vercel.com/v1/registrar/domains/example.com/buy' } });
    expect(c.derived_action_type).toBe('spend');
    expect(c.flags).toContain('spend');
    expect(c.flags).toContain('sensitive_host');
    expect(c.reversible_hint).toBe(false);
    expect(evidenceTotal(c)).toBe(95);
  });

  it('a GET to the same registrar path stays api (a lookup is not a purchase)', () => {
    const c = classifyAct({ kind: 'http', request: { method: 'GET', url: 'https://api.vercel.com/v1/registrar/domains/example.com/price' } });
    expect(c.derived_action_type).toBe('api');
    expect(c.flags).not.toContain('spend');
  });

  it('a POST to an ordinary API path stays api', () => {
    const c = classifyAct({ kind: 'http', request: { method: 'POST', url: 'https://api.example.com/v1/items' } });
    expect(c.derived_action_type).toBe('api');
  });
});

describe('classifyAct — spend (generic purchase segment host/API gate)', () => {
  it('a code-host clone of a repo named "checkout" is not spend', () => {
    const c = classifyAct({ kind: 'shell', command: 'git clone https://github.com/actions/checkout' });
    expect(c.derived_action_type).not.toBe('spend');
    expect(c.flags).not.toContain('spend');
  });

  it('a docs page mentioning checkout is not spend', () => {
    const c = classifyAct({ kind: 'shell', command: 'curl https://stripe.com/docs/checkout' });
    expect(c.derived_action_type).not.toBe('spend');
    expect(c.flags).not.toContain('spend');
  });

  it('a POST to a purchase path under an /v<digits>/ API shape is spend', () => {
    const c = classifyAct({ kind: 'shell', command: 'curl -X POST https://api.shop.example/v1/checkout' });
    expect(c.derived_action_type).toBe('spend');
    expect(c.flags).toContain('spend');
  });

  it('a POST to a purchase path on a payment-shaped host is spend', () => {
    const c = classifyAct({ kind: 'shell', command: 'curl -X POST https://pay.example.com/checkout' });
    expect(c.derived_action_type).toBe('spend');
    expect(c.flags).toContain('spend');
  });

  it('a POST to a purchase path under an /api/ path shape is spend', () => {
    const c = classifyAct({ kind: 'shell', command: 'curl -X POST https://example.com/api/purchase' });
    expect(c.derived_action_type).toBe('spend');
    expect(c.flags).toContain('spend');
  });
});

describe('validate — act.script wire contract', () => {
  const base = { action_type: 'other', declared_goal: 'Bash: node x.mjs', risk_score: 30 };

  it('accepts a well-formed script excerpt', () => {
    const r = validateGuardInput({ ...base, act: { kind: 'shell', command: 'node x.mjs', script: { path: 'x.mjs', content_excerpt: 'console.log(1)' } } });
    expect(r.valid).toBe(true);
  });

  it('rejects a script without a path and an oversized excerpt', () => {
    const noPath = validateGuardInput({ ...base, act: { kind: 'shell', command: 'node x.mjs', script: { content_excerpt: 'x' } } });
    expect(noPath.valid).toBe(false);
    const big = validateGuardInput({ ...base, act: { kind: 'shell', command: 'node x.mjs', script: { path: 'x.mjs', content_excerpt: 'a'.repeat(6145) } } });
    expect(big.valid).toBe(false);
  });
});

describe('policy shapes — spend is never precedented', () => {
  it('a spend flag can never earn a learned relaxation', () => {
    expect(NEVER_PRECEDENTED.has('spend')).toBe(true);
  });
});
