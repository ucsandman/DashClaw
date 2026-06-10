import { describe, it, expect } from 'vitest';
import {
  STACK_OPTIONS,
  renderTemplate,
} from '../../../app/connect/hostedTemplates.js';

const SAMPLE = {
  endpoint: 'https://hosted.example.com',
  apiKey: 'oc_live_abc123def456',
  workspaceId: 'org_xyz789',
};

describe('hostedTemplates', () => {
  it('exposes 4 stack options with id, label, description', () => {
    expect(STACK_OPTIONS).toHaveLength(4);
    const ids = STACK_OPTIONS.map((s) => s.id);
    expect(ids).toEqual(['claude-code', 'mcp', 'openclaw', 'langchain']);
    for (const opt of STACK_OPTIONS) {
      expect(opt.id).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.description).toBeTruthy();
    }
  });

  it('renders a URL-mode MCP config for claude-code', () => {
    const { language, code } = renderTemplate('claude-code', SAMPLE);
    expect(language).toBe('json');
    expect(code).toContain('https://hosted.example.com/api/mcp');
    expect(code).toContain('oc_live_abc123def456');
    expect(code).toContain('x-api-key');
    expect(code).toContain('mcpServers');
  });

  it('renders a URL-mode MCP config for mcp', () => {
    const { language, code } = renderTemplate('mcp', SAMPLE);
    expect(language).toBe('json');
    expect(code).toContain('https://hosted.example.com/api/mcp');
    expect(code).toContain('oc_live_abc123def456');
    expect(code).toContain('x-api-key');
    expect(code).toContain('mcpServers');
  });

  it('renders a manual install + env snippet for openclaw', () => {
    const { language, code } = renderTemplate('openclaw', SAMPLE);
    expect(language).toBe('bash');
    expect(code).toContain('@dashclaw/openclaw-plugin');
    expect(code).toContain('oc_live_abc123def456');
    expect(code).toContain('https://hosted.example.com');
    expect(code).toContain('DASHCLAW_URL');
  });

  it('renders a Python snippet for langchain', () => {
    const { language, code } = renderTemplate('langchain', SAMPLE);
    expect(language).toBe('python');
    expect(code).toContain('DASHCLAW_URL');
    expect(code).toContain('DASHCLAW_API_KEY');
    expect(code).toContain('oc_live_abc123def456');
    expect(code).toContain('https://hosted.example.com');
  });

  it('throws on unknown stack id', () => {
    expect(() => renderTemplate('nope', SAMPLE)).toThrow(/unknown stack/i);
  });

  it('throws on removed codex id (previously supported)', () => {
    expect(() => renderTemplate('codex', SAMPLE)).toThrow(/unknown stack/i);
  });

  it('never emits undefined/null literals in substituted output', () => {
    for (const opt of STACK_OPTIONS) {
      const { code } = renderTemplate(opt.id, SAMPLE);
      expect(code).not.toMatch(/undefined/);
      expect(code).not.toMatch(/\bnull\b/);
    }
  });
});
