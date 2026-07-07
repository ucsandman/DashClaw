import { describe, it, expect, vi } from 'vitest';
import * as hostedRepo from '../../../app/lib/repositories/hosted-workspace.repository.js';

describe('trial action counter integration', () => {
  it('incrementTrialActionCount is exported from the hosted-workspace repository', () => {
    expect(typeof hostedRepo.incrementTrialActionCount).toBe('function');
  });

  it('incrementTrialActionCount is imported by the actions POST route', async () => {
    // Read the route source and confirm the import and push statement exist.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const routePath = path.resolve(
      process.cwd(),
      'app/api/actions/route.ts',
    );
    const src = await fs.readFile(routePath, 'utf8');
    expect(src).toMatch(/incrementTrialActionCount/);
    expect(src).toMatch(/after\([\s\S]*incrementTrialActionCount/);
  });

  it('incrementTrialActionCount silently no-ops for non-hosted orgs', async () => {
    // Direct exercise: mocked sql returns [] (no rows updated), no throw.
    const sqlMock = vi.fn().mockResolvedValue([]);
    await expect(
      hostedRepo.incrementTrialActionCount(sqlMock, 'org_real_non_hosted'),
    ).resolves.toBeUndefined();
    expect(sqlMock).toHaveBeenCalledOnce();
  });
});
