// Map the analyzer's estimated_effort hour-strings ('1-2 hours' .. '8-16 hours',
// see analyzer.ts estimateEffort) to a Badge variant. The page previously looked
// up a non-existent `r.effort` key, so the badge was always 'default'.
export type EffortVariant = 'success' | 'warning' | 'error' | 'default';

export function effortVariant(estimatedEffort: unknown): EffortVariant {
  if (typeof estimatedEffort !== 'string') return 'default';
  const hours = estimatedEffort.match(/\d+/g)?.map(Number) ?? [];
  if (hours.length === 0) return 'default';
  const maxHours = Math.max(...hours);
  if (maxHours <= 2) return 'success';
  if (maxHours <= 8) return 'warning';
  return 'error';
}
