import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import TrialActivationChecklist from '../../../app/connect/TrialActivationChecklist.jsx';

function stepsBody(doneIds) {
  const all = [
    ['key_used', 'Key used'],
    ['first_call', 'First call received'],
    ['approval_landed', 'Approval landed on your phone'],
  ];
  const steps = all.map(([id, label]) => ({ id, label, done: doneIds.includes(id) }));
  const firstOpen = steps.find((s) => !s.done);
  return { workspace_id: 'org_abc', steps, current: firstOpen ? firstOpen.id : null, complete: !firstOpen };
}

describe('TrialActivationChecklist', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders each step state from the per-org read and ends with the phone approval link', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => stepsBody(['key_used']) });
    render(<TrialActivationChecklist workspaceId="org_abc" pollMs={60_000} />);

    await waitFor(() => expect(screen.getByText('Key used')).toBeTruthy());
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].getAttribute('data-state')).toBe('done');
    expect(items[1].getAttribute('data-state')).toBe('current');
    expect(items[2].getAttribute('data-state')).toBe('todo');

    // The last step carries the phone approval link.
    const approve = items[2].querySelector('a');
    expect(approve).toBeTruthy();
    expect(new URL(approve.href).pathname).toBe('/approve');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/hosted/activation?workspace_id=org_abc',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('renders nothing when the read is refused (no session for this workspace)', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Not your workspace' }) });
    const { container } = render(<TrialActivationChecklist workspaceId="org_abc" pollMs={60_000} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });
});
