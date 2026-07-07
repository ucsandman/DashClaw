import { z } from 'zod';

export const VALID_SIGNAL_TYPES = [
  'all',
  'autonomy_spike',
  'high_impact_low_oversight',
  'repeated_failures',
  'stale_loop',
  'assumption_drift',
  'stale_assumption',
  'stale_running_action',
] as const;

export const notificationPreferenceUpsertSchema = z.object({
  channel: z.enum(['email']).default('email'),
  enabled: z.boolean().default(true),
  signal_types: z.array(z.enum(VALID_SIGNAL_TYPES)).nonempty().default(['all']),
});
