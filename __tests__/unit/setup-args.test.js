import { describe, expect, it } from 'vitest';
import { parseSetupArgs } from '../../scripts/lib/setup-args.mjs';

describe('parseSetupArgs', () => {
  it('defaults to interactive', () => {
    expect(parseSetupArgs([])).toEqual({ yes: false, databaseUrl: null, json: false });
  });
  it('parses the non-interactive trio', () => {
    expect(parseSetupArgs(['--yes', '--database-url', 'postgresql://u:p@h:5433/db', '--json']))
      .toEqual({ yes: true, databaseUrl: 'postgresql://u:p@h:5433/db', json: true });
  });
  it('rejects a non-postgres database-url', () => {
    expect(() => parseSetupArgs(['--database-url', 'mysql://x'])).toThrow(/postgresql:\/\//);
  });
});
