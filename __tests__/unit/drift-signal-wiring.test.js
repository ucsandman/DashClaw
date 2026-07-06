/**
 * The `drift_alert` webhook event type stays registered in both event-type
 * contracts until the drift engine is fully retired. (The computeSignals
 * emitter was removed with the drift-engine decoupling; the webhook event type
 * is cleaned up when the drift subsystem is deleted.)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VALID_SIGNAL_TYPES } from '@/lib/contracts/notifications';

describe('drift_alert webhook event type', () => {
  it('is registered as a webhook event type and a notification signal type', () => {
    expect(VALID_SIGNAL_TYPES).toContain('drift_alert');
    const webhooksRoute = readFileSync(
      path.resolve(__dirname, '..', '..', 'app', 'api', 'webhooks', 'route.ts'),
      'utf8',
    );
    expect(webhooksRoute).toMatch(/'drift_alert'/);
    const webhooksPage = readFileSync(
      path.resolve(__dirname, '..', '..', 'app', 'webhooks', 'page.tsx'),
      'utf8',
    );
    expect(webhooksPage).toMatch(/'drift_alert'/);
  });
});
