import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

// The Copy Agent Prompt flow must never depend on the programmatic clipboard
// write succeeding: uBlock Origin's ClickFix defense (1.72+) defuses
// navigator.clipboard.writeText of command-laden text undetectably. The
// dialog with the pre-selected prompt is the guarantee. No jest-dom —
// assert via queries/textContent.

vi.mock('../../app/lib/connectPrompt', () => ({
  generateConnectPrompt: (baseUrl: string, orgName: string) =>
    `# DashClaw Agent Setup for ${orgName} at ${baseUrl}`,
  generateCoveragePrompt: (baseUrl: string, orgName: string) =>
    `# Coverage prompt for ${orgName} at ${baseUrl}`,
}));

import ConnectAgentButton from '../../app/components/ConnectAgentButton';

const writeText = vi.fn();
const readText = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ org: { name: 'Acme' } }),
  }));
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, readText },
    configurable: true,
  });
  writeText.mockReset();
  readText.mockReset();
  // Default: readText echoes back whatever was last written, so tests that
  // don't care about verification keep seeing the confident "copied" state.
  readText.mockImplementation(async () => writeText.mock.calls.at(-1)?.[0] ?? '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConnectAgentButton', () => {
  it('always opens the dialog with the prompt, even when the clipboard write succeeds', async () => {
    writeText.mockResolvedValue(undefined);
    render(<ConnectAgentButton />);
    fireEvent.click(screen.getByText('Copy Agent Prompt'));

    await waitFor(() => screen.getByRole('dialog'));
    expect(screen.getByRole('dialog').textContent).toContain('Agent prompt copied');
    const textarea = screen.getByRole('dialog').querySelector('textarea')!;
    expect(textarea.value).toContain('# DashClaw Agent Setup for Acme');
    expect(writeText).toHaveBeenCalledOnce();
  });

  it('shows the blocked-copy state (not a false "copied") when writeText throws', async () => {
    writeText.mockRejectedValue(new Error('Write permission denied'));
    render(<ConnectAgentButton />);
    fireEvent.click(screen.getByText('Copy Agent Prompt'));

    await waitFor(() => screen.getByRole('dialog'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Agent prompt ready');
    expect(dialog.textContent).toContain('blocked the programmatic copy');
    expect(dialog.textContent).not.toContain('Agent prompt copied');
    const textarea = dialog.querySelector('textarea')!;
    expect(textarea.value).toContain('# DashClaw Agent Setup for Acme');
  });

  it('selects the prompt text so a native Ctrl+C works without any clipboard API', async () => {
    writeText.mockRejectedValue(new Error('blocked'));
    render(<ConnectAgentButton />);
    fireEvent.click(screen.getByText('Copy Agent Prompt'));

    await waitFor(() => screen.getByRole('dialog'));
    const textarea = screen.getByRole('dialog').querySelector('textarea')!;
    await waitFor(() => {
      expect(textarea.selectionEnd - textarea.selectionStart).toBe(textarea.value.length);
    });
  });

  it('closes on Escape and on the close button', async () => {
    writeText.mockResolvedValue(undefined);
    render(<ConnectAgentButton />);
    fireEvent.click(screen.getByText('Copy Agent Prompt'));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByText('Copy Agent Prompt'));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('uses the coverage prompt when promptType="coverage"', async () => {
    writeText.mockResolvedValue(undefined);
    render(<ConnectAgentButton promptType="coverage" />);
    fireEvent.click(screen.getByText('Copy Agent Prompt'));

    await waitFor(() => screen.getByRole('dialog'));
    const textarea = screen.getByRole('dialog').querySelector('textarea')!;
    expect(textarea.value).toContain('# Coverage prompt for Acme');
  });

  // Finding 10: writeText resolving is not proof the copy landed — uBlock's
  // ClickFix defuser (1.72+) can no-op the write without throwing. Without a
  // readText() verification round-trip, the dialog would over-claim "copied"
  // here even though nothing reached the real clipboard.
  it('does not claim "copied" when the write cannot be verified (silent no-op)', async () => {
    writeText.mockResolvedValue(undefined);
    // Simulates a defused write: writeText "succeeds" but the clipboard
    // content readText reports back is unrelated to what was sent.
    readText.mockResolvedValue('unrelated clipboard content');
    render(<ConnectAgentButton />);
    fireEvent.click(screen.getByText('Copy Agent Prompt'));

    await waitFor(() => screen.getByRole('dialog'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('Agent prompt copied');
    expect(dialog.textContent).toContain('Agent prompt ready');
    expect(dialog.textContent).toContain('could not confirm the copy landed');
    // The full prompt is still visible/selected as the manual fallback.
    const textarea = dialog.querySelector('textarea')!;
    expect(textarea.value).toContain('# DashClaw Agent Setup for Acme');
  });

  it('does not claim "copied" when clipboard read is unpermitted (no throw on write)', async () => {
    writeText.mockResolvedValue(undefined);
    readText.mockRejectedValue(new Error('NotAllowedError'));
    render(<ConnectAgentButton />);
    fireEvent.click(screen.getByText('Copy Agent Prompt'));

    await waitFor(() => screen.getByRole('dialog'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('Agent prompt copied');
    expect(dialog.textContent).toContain('could not confirm the copy landed');
    const textarea = dialog.querySelector('textarea')!;
    expect(textarea.value).toContain('# DashClaw Agent Setup for Acme');
  });
});
