// __tests__/unit/doctor-data-hygiene.test.js
// W4 data-hygiene category: non-ISO TEXT timestamp detection + normalize_timestamps fix.
// Incident class: clients wrote JS Date.toString() output (e.g. "Thu Jun 11 2026 ...
// GMT-0400 (Eastern Daylight Time)") into TEXT timestamp columns, breaking
// ::timestamptz casts with PG 22023. validate.js blocks NEW garbage at ingest;
// this check finds EXISTING bad rows and the fix normalizes parseable ones to ISO.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSetupStatus, mockGetSql, mockQuery } = vi.hoisted(() => ({
  mockGetSetupStatus: vi.fn(),
  mockGetSql: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/lib/setupStatus.mjs', () => ({ getSetupStatus: mockGetSetupStatus }));
vi.mock('@/lib/db', () => ({ getSql: mockGetSql }));

import { runChecks, TIMESTAMP_COLUMNS } from '@/lib/doctor/checks/data-hygiene.mjs';
import { apply as applyNormalizeTimestamps } from '@/lib/doctor/fixes/normalize-timestamps.mjs';
import { applyFix, FIX_REGISTRY } from '@/lib/doctor/fixes/index.mjs';

const DATE_TOSTRING = 'Thu Jun 11 2026 14:30:00 GMT-0400 (Eastern Daylight Time)';
const GARBAGE = 'not-a-timestamp';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetupStatus.mockResolvedValue({ configured: true });
  mockGetSql.mockReturnValue({ query: mockQuery });
  // Default: every probed column is clean.
  mockQuery.mockResolvedValue([]);
});

/** Route mocked SELECT results by query text (per sql-fragment gotcha: never by call index). */
function routeSelects(map) {
  mockQuery.mockImplementation(async (text, params = []) => {
    for (const [match, rows] of map) {
      if (text.includes(match.table) && text.includes(match.column)) {
        if (text.trimStart().toUpperCase().startsWith('UPDATE')) {
          // UPDATE ... RETURNING 1 — return one row per "updated" row
          const target = rows.find((r) => r.value === params[1]);
          return Array.from({ length: target ? target.count : 0 }, () => ({ '?column?': 1 }));
        }
        return rows;
      }
    }
    if (text.trimStart().toUpperCase().startsWith('UPDATE')) return [];
    return [];
  });
}

describe('doctor/checks/data-hygiene — detection', () => {
  it('probes the spec-pinned incident columns', () => {
    const pairs = TIMESTAMP_COLUMNS.map((c) => `${c.table}.${c.column}`);
    expect(pairs).toContain('action_records.timestamp_start');
    expect(pairs).toContain('action_records.timestamp_end');
  });

  it('flags parseable non-ISO values with an auto fix and counts garbage separately', async () => {
    routeSelects([
      [
        { table: 'action_records', column: 'timestamp_start' },
        [
          { value: DATE_TOSTRING, count: 2 },
          { value: GARBAGE, count: 1 },
        ],
      ],
    ]);

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    expect(checks).toHaveLength(1);
    const check = checks[0];
    expect(check.id).toBe('dh_timestamp_format');
    expect(check.category).toBe('data-hygiene');
    expect(check.status).toBe('fail');
    expect(check.message).toContain('action_records.timestamp_start');
    expect(check.message).toContain('2'); // fixable rows
    expect(check.message).toContain('1'); // garbage rows
    expect(check.fix).toEqual({
      type: 'auto',
      description: expect.stringContaining('Normalize'),
      action: 'normalize_timestamps',
    });
  });

  it('passes on clean data with no fix attached', async () => {
    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    expect(checks).toHaveLength(1);
    expect(checks[0].id).toBe('dh_timestamp_format');
    expect(checks[0].status).toBe('pass');
    expect(checks[0].fix).toBeNull();
  });

  it('warns without a fix when only unparseable garbage exists', async () => {
    routeSelects([
      [
        { table: 'code_sessions', column: 'started_at' },
        [{ value: GARBAGE, count: 3 }],
      ],
    ]);

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('warn');
    expect(checks[0].fix).toBeNull();
    expect(checks[0].message).toContain('manual review');
  });

  it('returns no checks when the database is not configured', async () => {
    mockGetSetupStatus.mockResolvedValue({ configured: false, reason: 'missing_database_url' });

    const checks = await runChecks({ env: {} });

    expect(checks).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('doctor/fixes/normalize-timestamps', () => {
  it('normalizes only parseable non-ISO values and reports exact row counts', async () => {
    routeSelects([
      [
        { table: 'action_records', column: 'timestamp_start' },
        [
          { value: DATE_TOSTRING, count: 2 },
          { value: GARBAGE, count: 1 },
        ],
      ],
    ]);

    const result = await applyNormalizeTimestamps({ env: { DATABASE_URL: 'postgres://test' } });

    expect(result.applied).toBe(true);
    expect(result.details.changed).toEqual([
      { table: 'action_records', column: 'timestamp_start', rowsChanged: 2 },
    ]);
    expect(result.details.garbage).toEqual([
      { table: 'action_records', column: 'timestamp_start', rows: 1 },
    ]);
    expect(result.description).toContain('2');

    // Exactly one UPDATE, parameterized [iso, original]; garbage never mutated.
    const updates = mockQuery.mock.calls.filter(([text]) =>
      text.trimStart().toUpperCase().startsWith('UPDATE'),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual([new Date(DATE_TOSTRING).toISOString(), DATE_TOSTRING]);
  });

  it('is idempotent: a second run over clean data changes 0 rows and issues no UPDATEs', async () => {
    // All SELECT probes return [] (post-fix state).
    const result = await applyNormalizeTimestamps({ env: { DATABASE_URL: 'postgres://test' } });

    expect(result.applied).toBe(false);
    expect(result.description).toMatch(/0 rows|nothing to normalize/i);
    const updates = mockQuery.mock.calls.filter(([text]) =>
      text.trimStart().toUpperCase().startsWith('UPDATE'),
    );
    expect(updates).toHaveLength(0);
  });

  it('never rewrites ISO values (probe excludes them by regex)', async () => {
    await applyNormalizeTimestamps({ env: { DATABASE_URL: 'postgres://test' } });

    for (const [text, params] of mockQuery.mock.calls) {
      if (text.trimStart().toUpperCase().startsWith('SELECT')) {
        expect(text).toContain('!~');
        expect(params?.[0]).toMatch(/\\d\{4\}|\d{4}/); // ISO-prefix regex param present
      }
    }
  });
});

describe('FIX_REGISTRY wiring', () => {
  it('registers normalize_timestamps with remote scope', () => {
    expect(FIX_REGISTRY.normalize_timestamps).toBeDefined();
    expect(FIX_REGISTRY.normalize_timestamps.scope).toBe('remote');
  });

  it('applyFix routes normalize_timestamps without requiring allowLocal', async () => {
    const result = await applyFix('normalize_timestamps', {}, { allowLocal: false });

    expect(result.action).toBe('normalize_timestamps');
    // Remote scope ⇒ never the local-filesystem refusal.
    expect(result.description).not.toContain('requires local filesystem');
  });
});
