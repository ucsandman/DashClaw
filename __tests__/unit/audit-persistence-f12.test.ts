import { describe, expect, it } from 'vitest';
import {
  inspectMigrationConflicts,
  isIgnorableMigrationError,
  validateRequiredSchema,
} from '../../app/lib/setup/migration-runner.mjs';
import { checkCoreTables, CORE_TABLES } from '../../app/lib/schemaCheck';

describe('F12 migration safety', () => {
  it('never treats incompatible data or invalid definitions as already applied', () => {
    expect(isIgnorableMigrationError({ code: '42P07' })).toBe(true);
    expect(isIgnorableMigrationError({ code: '42701' })).toBe(true);
    expect(isIgnorableMigrationError({ code: '42710' })).toBe(true);
    expect(isIgnorableMigrationError({ code: '23505' })).toBe(false);
    expect(isIgnorableMigrationError({ code: '42P10' })).toBe(false);
    expect(isIgnorableMigrationError({ code: '42P16' })).toBe(false);
    expect(isIgnorableMigrationError({ message: 'already exists but has an incompatible definition' })).toBe(false);
  });

  it('fails the migration postcondition when the required idempotency index is absent', async () => {
    const sql = (() => Promise.resolve([{
      missing_tables: [],
      missing_indexes: ['action_records_idempotency_idx'],
    }])) as never;

    await expect(validateRequiredSchema(sql)).rejects.toThrow(/action_records_idempotency_idx/);
  });

  it('does not query a legacy action_records column before column reconciliation can add it', async () => {
    const statements: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      statements.push(strings.join('?'));
      return Promise.resolve([{
        action_records_exists: true,
        idempotency_key_exists: false,
      }]);
    }) as never;

    await expect(inspectMigrationConflicts(sql)).resolves.toEqual({ conflicts: [] });
    expect(statements).toHaveLength(1);
  });

  it('marks runtime readiness false when the required index is missing', async () => {
    const sql = (() => Promise.resolve([{
      present_tables: CORE_TABLES,
      present_indexes: [],
    }])) as never;

    await expect(checkCoreTables(sql)).resolves.toMatchObject({
      ok: false,
      missing: [],
      missingIndexes: ['action_records_idempotency_idx'],
    });
  });
});
