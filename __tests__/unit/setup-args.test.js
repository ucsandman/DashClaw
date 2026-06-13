import { describe, expect, it } from 'vitest';
import { parseSetupArgs } from '../../scripts/lib/setup-args.mjs';

describe('parseSetupArgs', () => {
  it('defaults to interactive', () => {
    expect(parseSetupArgs([])).toEqual({ yes: false, databaseUrl: null, json: false, skipInstall: false, skipBuild: false });
  });
  it('parses the non-interactive trio', () => {
    expect(parseSetupArgs(['--yes', '--database-url', 'postgresql://u:p@h:5433/db', '--json']))
      .toEqual({ yes: true, databaseUrl: 'postgresql://u:p@h:5433/db', json: true, skipInstall: false, skipBuild: false });
  });
  it('rejects a non-postgres database-url', () => {
    expect(() => parseSetupArgs(['--database-url', 'mysql://x'])).toThrow(/postgresql:\/\//);
  });
  it('throws when --database-url has no value (end of args)', () => {
    expect(() => parseSetupArgs(['--database-url'])).toThrow(/requires a value/);
  });
  it('throws when --database-url is given an empty string', () => {
    expect(() => parseSetupArgs(['--database-url', ''])).toThrow(/requires a value/);
  });
  it('is flag-order independent (--json before --yes)', () => {
    expect(parseSetupArgs(['--json', '--yes']))
      .toEqual({ yes: true, databaseUrl: null, json: true, skipInstall: false, skipBuild: false });
  });
  it('returns databaseUrl: null when only --yes --json passed', () => {
    expect(parseSetupArgs(['--yes', '--json'])).toMatchObject({ databaseUrl: null });
  });
  it('defaults skipInstall and skipBuild to false', () => {
    expect(parseSetupArgs([])).toMatchObject({ skipInstall: false, skipBuild: false });
  });
  it('parses --skip-install', () => {
    expect(parseSetupArgs(['--skip-install'])).toMatchObject({ skipInstall: true, skipBuild: false });
  });
  it('parses --skip-build', () => {
    expect(parseSetupArgs(['--skip-build'])).toMatchObject({ skipInstall: false, skipBuild: true });
  });
  it('parses both --skip-install and --skip-build together', () => {
    expect(parseSetupArgs(['--yes', '--json', '--skip-install', '--skip-build']))
      .toEqual({ yes: true, databaseUrl: null, json: true, skipInstall: true, skipBuild: true });
  });
});
