import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostedProvisionClient from '../../../app/connect/HostedProvisionClient.jsx';

describe('HostedProvisionClient', () => {
  beforeEach(() => {
    // jsdom polyfill: clipboard API
    if (!navigator.clipboard) {
      Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    } else {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    }
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the 4 stack options with the first pre-selected', () => {
    render(<HostedProvisionClient turnstileSiteKey={null} />);
    const claudeCode = screen.getByRole('radio', { name: /claude code/i });
    expect(claudeCode.checked).toBe(true);
    for (const label of [/mcp host/i, /openclaw/i, /langchain/i]) {
      expect(screen.getByRole('radio', { name: label }).checked).toBe(false);
    }
  });

  it('switches the selected stack when user clicks another option', () => {
    render(<HostedProvisionClient turnstileSiteKey={null} />);
    fireEvent.click(screen.getByRole('radio', { name: /langchain/i }));
    expect(screen.getByRole('radio', { name: /langchain/i }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: /claude code/i }).checked).toBe(false);
  });

  it('fires provisioning on button click and shows the templated config on success', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        workspace_id: 'org_abc',
        api_key: 'oc_live_test123',
        endpoint: 'https://hosted.example.com',
        expires_at: '2026-05-18T00:00:00Z',
        trial_action_cap: 10000,
      }),
    });
    render(<HostedProvisionClient turnstileSiteKey={null} />);
    fireEvent.click(screen.getByRole('button', { name: /mint trial/i }));
    // The key renders twice: a bare API-key block (for the CLI paste flow) and
    // inside the templated config — so use the *AllByText queries.
    await waitFor(() => {
      expect(screen.queryAllByText(/oc_live_test123/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/org_abc/)).toBeTruthy();
    // Claude Code template uses URL-mode MCP — look for mcpServers config marker
    expect(screen.queryByText(/mcpServers/)).toBeTruthy();
  });

  it('displays an error when provisioning fails', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limit exceeded' }),
    });
    render(<HostedProvisionClient turnstileSiteKey={null} />);
    fireEvent.click(screen.getByRole('button', { name: /mint trial/i }));
    await waitFor(() => {
      expect(screen.queryByText(/rate limit/i)).toBeTruthy();
    });
  });

  it('disables the button while loading', async () => {
    let resolveFetch;
    globalThis.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
    render(<HostedProvisionClient turnstileSiteKey={null} />);
    const btn = screen.getByRole('button', { name: /mint trial/i });
    fireEvent.click(btn);
    expect(btn.disabled).toBe(true);
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({
        workspace_id: 'org_x', api_key: 'oc_live_x', endpoint: 'https://h.example',
        expires_at: '2099-01-01T00:00:00Z', trial_action_cap: 10000,
      }),
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/oc_live_x/).length).toBeGreaterThan(0);
    });
  });

  it('copies the templated config when copy button is clicked', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        workspace_id: 'org_abc', api_key: 'oc_live_test',
        endpoint: 'https://hosted.example.com',
        expires_at: '2099-01-01T00:00:00Z', trial_action_cap: 10000,
      }),
    });
    render(<HostedProvisionClient turnstileSiteKey={null} />);
    fireEvent.click(screen.getByRole('button', { name: /mint trial/i }));
    await waitFor(() => screen.getAllByText(/oc_live_test/));
    fireEvent.click(screen.getByRole('button', { name: /copy config/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    const copied = navigator.clipboard.writeText.mock.calls[0][0];
    expect(copied).toContain('oc_live_test');
    expect(copied).toContain('https://hosted.example.com');
  });

  it('copies the bare API key when the Copy key button is clicked', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        workspace_id: 'org_abc', api_key: 'oc_live_test',
        endpoint: 'https://hosted.example.com',
        expires_at: '2099-01-01T00:00:00Z', trial_action_cap: 10000,
      }),
    });
    render(<HostedProvisionClient turnstileSiteKey={null} />);
    fireEvent.click(screen.getByRole('button', { name: /mint trial/i }));
    await waitFor(() => screen.getAllByText(/oc_live_test/));
    fireEvent.click(screen.getByRole('button', { name: /copy key/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('oc_live_test');
  });
});
