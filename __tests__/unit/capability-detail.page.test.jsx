import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockUseParams } = vi.hoisted(() => ({
  mockUseParams: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useParams: mockUseParams,
}));

vi.mock('@/components/PageLayout.js', () => ({
  default: ({ title, subtitle, children, actions }) => (
    <div>
      <div>{title}</div>
      <div>{subtitle}</div>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title, count, action }) => (
    <div>
      <span>{title}</span>
      {count !== undefined ? <span>{count}</span> : null}
      {action}
    </div>
  ),
  CardContent: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/EmptyState.js', () => ({
  EmptyState: ({ title, description, action }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      <div>{action}</div>
    </div>
  ),
}));

function okJson(body) {
  return {
    ok: true,
    json: async () => body,
  };
}

describe('CapabilityDetailPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads capabilityId from next navigation params when the client page gets no params prop', async () => {
    mockUseParams.mockReturnValue({ capabilityId: 'cap_1' });
    global.fetch = vi.fn()
      .mockResolvedValueOnce(okJson({
        capability: {
          capability_id: 'cap_1',
          name: 'Research Agent',
          slug: 'research-agent',
          risk_level: 'medium',
          source_type: 'http_api',
          invocation_schema: {
            endpoint: 'https://api.example.com/research',
            input_schema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  title: 'Search query',
                },
              },
            },
          },
        },
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        status: 'healthy',
        certification_status: 'certified',
        stale_check: false,
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [],
      }));

    const { default: CapabilityDetailPage } = await import('@/capabilities/[capabilityId]/page.jsx');

    render(<CapabilityDetailPage />);

    expect(await screen.findAllByText('Research Agent')).toBeTruthy();
  });

  it('renders a not-found fallback with a link back to the registry', async () => {
    mockUseParams.mockReturnValue({ capabilityId: 'cap_missing' });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Capability not found' }),
    });

    const { default: CapabilityDetailPage } = await import('@/capabilities/[capabilityId]/page.jsx');

    render(<CapabilityDetailPage />);

    expect(await screen.findByText('Capability unavailable')).toBeTruthy();
    expect(await screen.findByText(/capability not found/i)).toBeTruthy();
    expect(await screen.findByRole('link', { name: /back to registry/i })).toBeTruthy();
  });

  it('renders capability metadata, health, and history on load', async () => {
    mockUseParams.mockReturnValue({ capabilityId: 'cap_1' });
    global.fetch = vi.fn()
      .mockResolvedValueOnce(okJson({
        capability: {
          capability_id: 'cap_1',
          name: 'Research Agent',
          slug: 'research-agent',
          risk_level: 'medium',
          source_type: 'http_api',
          auth_type: 'oauth',
          requires_approval: true,
          invocation_schema: {
            endpoint: 'https://api.example.com/research',
            input_schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: {
                  type: 'string',
                  title: 'Search query',
                  description: 'Prompt or question to send to the research agent',
                },
              },
            },
          },
        },
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        status: 'healthy',
        certification_status: 'certified',
        stale_check: false,
        success_rate_1d: 97,
        p95_latency_ms: 120,
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [
          {
            action_id: 'act_1',
            action_type: 'capability_test',
            status: 'completed',
          },
        ],
      }))
      .mockResolvedValueOnce(okJson({ rules: [] }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [
          {
            action_id: 'act_1',
            action_type: 'capability_test',
            status: 'completed',
          },
        ],
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [
          {
            action_id: 'act_1',
            action_type: 'capability_test',
            status: 'completed',
          },
        ],
      }))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          tested: true,
          capability_id: 'cap_1',
          test_action_id: 'act_2',
          message: 'downstream timeout',
          health_status: 'failing',
          certification_status: 'failed',
        }),
      })
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        status: 'failing',
        certification_status: 'failed',
        stale_check: false,
        success_rate_1d: 50,
        p95_latency_ms: 140,
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [
          {
            action_id: 'act_2',
            action_type: 'capability_test',
            status: 'failed',
          },
          {
            action_id: 'act_1',
            action_type: 'capability_test',
            status: 'completed',
          },
        ],
      }));

    const { default: CapabilityDetailPage } = await import('@/capabilities/[capabilityId]/page.jsx');

    render(<CapabilityDetailPage />);

    const capabilityNames = await screen.findAllByText('Research Agent');
    expect(capabilityNames.length).toBeGreaterThan(0);
    expect(await screen.findByText(/certified/i)).toBeTruthy();
    expect(await screen.findByText(/capability_test/i)).toBeTruthy();
    expect(await screen.findByText(/oauth/i)).toBeTruthy();
    expect(await screen.findByRole('button', { name: /run test/i })).toBeTruthy();
    expect(await screen.findByText('97%')).toBeTruthy();
    expect(await screen.findByText('120 ms')).toBeTruthy();

    const historyLink = await screen.findByRole('link', { name: /capability_test/i });
    expect(historyLink.getAttribute('href')).toBe('/decisions/act_1');

    fireEvent.change(screen.getByLabelText('Action type filter'), {
      target: { value: 'capability_test' },
    });
    fireEvent.change(screen.getByLabelText('Status filter'), {
      target: { value: 'completed' },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/capabilities/cap_1/history?action_type=capability_test&status=completed&limit=20',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /run test/i }));
    expect(await screen.findByLabelText(/search query/i)).toBeTruthy();
    expect(screen.queryByLabelText('Test payload')).toBeNull();

    fireEvent.change(screen.getByLabelText(/search query/i), {
      target: { value: 'What is x402?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit test/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/capabilities/cap_1/test',
        expect.objectContaining({
          method: 'POST',
          body: '{"query":"What is x402?"}',
        }),
      );
    });

    expect(await screen.findByText(/downstream timeout/i)).toBeTruthy();
    expect(await screen.findByText('50%')).toBeTruthy();
  });

  it('keeps the page usable when history fails and allows retry into an empty state', async () => {
    mockUseParams.mockReturnValue({ capabilityId: 'cap_1' });
    global.fetch = vi.fn()
      .mockResolvedValueOnce(okJson({
        capability: {
          capability_id: 'cap_1',
          name: 'Research Agent',
          slug: 'research-agent',
          risk_level: 'medium',
          source_type: 'http_api',
          invocation_schema: {
            endpoint: 'https://api.example.com/research',
            input_schema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  title: 'Search query',
                },
              },
            },
          },
        },
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        status: 'healthy',
        certification_status: 'certified',
        stale_check: false,
      }))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'History unavailable' }),
      })
      .mockResolvedValueOnce(okJson({ rules: [] }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [],
      }));

    const { default: CapabilityDetailPage } = await import('@/capabilities/[capabilityId]/page.jsx');

    render(<CapabilityDetailPage />);

    expect(await screen.findByText('Research Agent')).toBeTruthy();
    expect(await screen.findByText(/history unavailable/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /retry history/i }));

    expect(await screen.findByText(/no recent capability events/i)).toBeTruthy();
  });

  it('keeps the page usable when health fails after the capability metadata loads', async () => {
    mockUseParams.mockReturnValue({ capabilityId: 'cap_1' });
    global.fetch = vi.fn()
      .mockResolvedValueOnce(okJson({
        capability: {
          capability_id: 'cap_1',
          name: 'Research Agent',
          slug: 'research-agent',
          risk_level: 'medium',
          source_type: 'http_api',
          invocation_schema: {
            endpoint: 'https://api.example.com/research',
            input_schema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  title: 'Search query',
                },
              },
            },
          },
        },
      }))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'Internal server error',
          detail: 'column "duration_ms" does not exist',
        }),
      })
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [
          {
            action_id: 'act_1',
            action_type: 'capability_invoke',
            status: 'completed',
          },
        ],
      }));

    const { default: CapabilityDetailPage } = await import('@/capabilities/[capabilityId]/page.jsx');

    render(<CapabilityDetailPage />);

    expect(await screen.findByText('Research Agent')).toBeTruthy();
    expect(screen.queryByText('Capability unavailable')).toBeNull();
    expect(await screen.findByText(/health summary unavailable/i)).toBeTruthy();
    expect(await screen.findByText(/duration_ms/i)).toBeTruthy();
    expect(await screen.findByText(/capability_invoke/i)).toBeTruthy();
  });

  it('disables test submission for invalid json and while a test is in flight', async () => {
    mockUseParams.mockReturnValue({ capabilityId: 'cap_1' });
    let resolveTest;
    const pendingTest = new Promise((resolve) => {
      resolveTest = resolve;
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce(okJson({
        capability: {
          capability_id: 'cap_1',
          name: 'Research Agent',
          slug: 'research-agent',
          risk_level: 'medium',
          source_type: 'http_api',
          invocation_schema: {
            endpoint: 'https://api.example.com/research',
            input_schema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  title: 'Search query',
                },
              },
            },
          },
        },
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        status: 'healthy',
        certification_status: 'certified',
        stale_check: false,
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [],
      }))
      .mockResolvedValueOnce(okJson({ rules: [] }))
      .mockImplementationOnce(() => pendingTest)
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        status: 'healthy',
        certification_status: 'certified',
        stale_check: false,
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [],
      }));

    const { default: CapabilityDetailPage } = await import('@/capabilities/[capabilityId]/page.jsx');

    render(<CapabilityDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: /run test/i }));
    fireEvent.click(await screen.findByRole('button', { name: /use advanced json/i }));

    const payload = await screen.findByLabelText('Test payload');
    const submit = screen.getByRole('button', { name: /submit test/i });

    fireEvent.change(payload, { target: { value: '{' } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(payload, { target: { value: '{"query":"What is x402?"}' } });
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /running/i }).disabled).toBe(true);
    });

    resolveTest({
      ok: true,
      json: async () => ({
        success: true,
        tested: true,
        capability_id: 'cap_1',
        test_action_id: 'act_9',
        message: 'ok',
        health_status: 'healthy',
        certification_status: 'certified',
      }),
    });

    expect(await screen.findByText('ok')).toBeTruthy();
  });

  it('hides runtime test affordances for registry-only capabilities', async () => {
    mockUseParams.mockReturnValue({ capabilityId: 'cap_1' });
    global.fetch = vi.fn()
      .mockResolvedValueOnce(okJson({
        capability: {
          capability_id: 'cap_1',
          name: 'Slack Notify Registry',
          slug: 'slack-notify-registry',
          risk_level: 'medium',
          source_type: 'internal_sdk',
          auth_type: 'none',
        },
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        status: 'unknown',
        certification_status: 'uncertified',
        stale_check: false,
      }))
      .mockResolvedValueOnce(okJson({
        capability_id: 'cap_1',
        events: [],
      }));

    const { default: CapabilityDetailPage } = await import('@/capabilities/[capabilityId]/page.jsx');

    render(<CapabilityDetailPage />);

    expect(await screen.findByText('Slack Notify Registry')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /run test/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /invoke/i })).toBeNull();
    expect(await screen.findByText(/testing and invocation are available for runnable http capabilities only/i)).toBeTruthy();
  });
});
