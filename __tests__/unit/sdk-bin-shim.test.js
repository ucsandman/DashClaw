import { describe, expect, it } from 'vitest';
import { shimSpawnArgs } from '../../sdk/bin/dashclaw-shim.js';

describe('sdk bin shim', () => {
  it('forwards argv to @dashclaw/cli via npm exec', () => {
    expect(shimSpawnArgs(['up', '--yes'])).toEqual({
      cmd: 'npm',
      args: ['exec', '--yes', '--', '@dashclaw/cli', 'up', '--yes'],
    });
  });
  it('forwards empty argv (bare npx dashclaw shows the CLI help)', () => {
    expect(shimSpawnArgs([])).toEqual({
      cmd: 'npm',
      args: ['exec', '--yes', '--', '@dashclaw/cli'],
    });
  });
});
