import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { checkCoreTables } from '../../app/lib/schemaCheck';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const client = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null;

afterAll(async () => { await client?.end(); });

describe.skipIf(!client)('schema health wire types', () => {
  it('returns text arrays that both PostgreSQL and Neon HTTP drivers decode', async () => {
    await checkCoreTables(async (strings, ...values) => {
      const rows = await client!(strings, ...values as never[]);
      expect(rows.columns.map(column => ({ name: column.name, type: column.type }))).toEqual([
        { name: 'present_tables', type: 1009 },
        { name: 'present_indexes', type: 1009 },
        { name: 'present_columns', type: 1009 },
      ]);
      return rows;
    });
  });
});
