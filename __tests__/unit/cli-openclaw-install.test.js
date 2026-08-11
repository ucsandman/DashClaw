import { describe, expect, it } from 'vitest';
import { upsertEnvVar } from '../../cli/lib/openclaw/install.js';

describe('upsertEnvVar', () => {
  it('appends when the key is absent, preserving neighbours', () => {
    const out = upsertEnvVar('OPENAI_API_KEY=sk-a\nGEMINI_API_KEY=g-b\n', 'DASHCLAW_API_KEY', 'dc-1');
    expect(out).toBe('OPENAI_API_KEY=sk-a\nGEMINI_API_KEY=g-b\nDASHCLAW_API_KEY=dc-1\n');
  });

  it('replaces in place without duplicating', () => {
    const out = upsertEnvVar('A=1\nDASHCLAW_API_KEY=old\nB=2\n', 'DASHCLAW_API_KEY', 'new');
    expect(out).toBe('A=1\nDASHCLAW_API_KEY=new\nB=2\n');
    expect(out.match(/DASHCLAW_API_KEY=/g)).toHaveLength(1);
  });

  it('survives a missing trailing newline', () => {
    expect(upsertEnvVar('A=1', 'B', '2')).toBe('A=1\nB=2\n');
  });

  it('handles empty content', () => {
    expect(upsertEnvVar('', 'B', '2')).toBe('B=2\n');
  });

  it('ignores a commented-out key rather than treating it as a match', () => {
    const out = upsertEnvVar('# DASHCLAW_API_KEY=nope\n', 'DASHCLAW_API_KEY', 'dc-1');
    expect(out).toBe('# DASHCLAW_API_KEY=nope\nDASHCLAW_API_KEY=dc-1\n');
  });
});
