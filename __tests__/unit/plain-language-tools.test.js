import { describe, it, expect } from 'vitest';
import { describeMcp, describeGenericTool } from '@/lib/plain-language/tools';

describe('describeMcp', () => {
  it('uses the registry phrase for a known DashClaw tool', () => {
    const out = describeMcp('mcp__dashclaw-local__dashclaw_guard');
    expect(out.confidence).toBe('high');
    expect(out.headline).toBe('Asks DashClaw whether this action is allowed.');
  });

  it('names the server and tool instead of guessing for an unknown tool', () => {
    const out = describeMcp('mcp__acme__send_invoice');
    expect(out.confidence).toBe('unknown');
    expect(out.detail).toContain('send_invoice');
    expect(out.detail).toContain('acme');
    expect(out.headline).not.toContain('invoice');
  });

  it('returns unknown for a malformed mcp name', () => {
    expect(describeMcp('not-an-mcp-name').confidence).toBe('unknown');
  });
});

describe('describeGenericTool', () => {
  it('translates Read as calm and reversible', () => {
    const out = describeGenericTool('Read', '{"file_path":"app/page.tsx"}');
    expect(out.headline).toBe('Reads a file. Nothing is changed.');
    expect(out.ruleId).toBe('tool.read');
    expect(out.reversible).toBe(true);
  });

  it('translates WebFetch as a network action, not a calm one', () => {
    const out = describeGenericTool('WebFetch', '{"url":"https://example.com"}');
    expect(out.headline).toContain('internet');
    expect(out.ruleId).not.toBe('tool.read');
  });

  it('returns unknown for an unregistered tool and keeps the payload as detail', () => {
    const out = describeGenericTool('Frobnicate', '{"x":1}');
    expect(out.confidence).toBe('unknown');
    expect(out.detail).toContain('Frobnicate');
  });

  it('bounds an oversized payload so it cannot flood the card', () => {
    const out = describeGenericTool('Frobnicate', 'x'.repeat(5000));
    expect(out.detail.length).toBeLessThan(400);
  });
});
