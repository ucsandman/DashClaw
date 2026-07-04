-- 0044_x402_money_numeric
--
-- Money is exact decimal, never float (trust & failure model ADR, D3).
-- drizzle/0021 created the x402 payment rail's currency columns as REAL
-- (float32, ~7 significant digits) — micro-payment window sums lose
-- precision exactly where the budget gates compare, and `::real` aggregates
-- carried the string-coercion footgun besides. Converts the money columns to
-- numeric; scores (value_score, confidence_score) are not money and stay
-- REAL. Conditional on information_schema so already-converted installs
-- no-op. Guarded by __tests__/unit/drizzle-money-types.test.js: any future
-- REAL money column fails the suite until a conversion entry covers it.
DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT v.table_name AS t, v.column_name AS col
    FROM (VALUES
      ('x402_purchases', 'spend_amount'),
      ('x402_endpoints', 'default_price')
    ) AS v(table_name, column_name)
    JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = v.table_name
     AND c.column_name = v.column_name
     AND c.data_type = 'real'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE numeric USING %I::numeric',
      pair.t, pair.col, pair.col
    );
  END LOOP;
END $$;
