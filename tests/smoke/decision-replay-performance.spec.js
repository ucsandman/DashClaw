import { test, expect } from '@playwright/test';

test('decision renders before delayed graph evidence and graph remains usable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseGraph;
  let graphRequested = false;
  const graphGate = new Promise(resolve => { releaseGraph = resolve; });
  await page.route('**/api/actions/ar_demo_deploy_block_001/graph', async route => {
    graphRequested = true;
    await graphGate;
    await route.continue();
  });
  await page.goto('/decisions/ar_demo_deploy_block_001');
  try {
    await expect(page.getByRole('heading', { name: 'Decision Replay', exact: true })).toBeVisible();
    expect(graphRequested).toBe(true);
    await expect(page.getByText('Goal Declared', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    const graphResponse = page.waitForResponse(response => response.url().endsWith('/ar_demo_deploy_block_001/graph'));
    releaseGraph();
    expect((await graphResponse).ok()).toBe(true);
    await expect(page.getByText('Execution Graph', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    releaseGraph();
  }
});
