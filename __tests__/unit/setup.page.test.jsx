import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { mockGetReadinessReport, mockProjectReadinessReport, mockHeaders } = vi.hoisted(() => ({
  mockGetReadinessReport: vi.fn(),
  mockProjectReadinessReport: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock('@/lib/readiness.mjs', () => ({
  getReadinessReport: mockGetReadinessReport,
  projectReadinessReport: mockProjectReadinessReport,
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

import SetupPage from '@/setup/page.jsx';

describe('/setup page', () => {
  it('renders the operator truth surface instead of redirecting', async () => {
    mockHeaders.mockResolvedValue(new Map([['cookie', '']]));
    mockGetReadinessReport.mockResolvedValue({ checkedAt: '2026-04-18T22:00:00.000Z' });
    mockProjectReadinessReport.mockReturnValue({
      checkedAt: '2026-04-18T22:00:00.000Z',
      verification: {
        overall: 'ready_unverified',
        label: 'Ready but not fully verified',
        summary: 'Core checks are passing, but deeper validation or operator follow-up is still pending.',
        readiness: 'healthy',
        fullyVerified: false,
      },
      sections: [
        {
          id: 'database',
          title: 'Database Verification',
          status: 'pass',
          summary: 'Database connection and core schema checks passed.',
          whatWasChecked: 'DATABASE_URL presence, live connection, and core schema.',
          checks: [
            {
              id: 'db_connection',
              label: 'Connection test',
              status: 'pass',
              detail: 'Database connection succeeded.',
              subDetail: '',
              nextAction: '',
            },
          ],
        },
      ],
      workflow: [
        {
          id: 'sdk_live',
          title: 'SDK and integration verification',
          status: 'pending',
          summary: 'Paste your API key above and click "Run test" to capture live proof.',
          nextAction: 'Use the validation flow.',
        },
      ],
      recommendations: [
        {
          id: 'run_sdk_validation',
          title: 'Validate your connection',
          variant: 'info',
          summary: 'Core verification passed.',
          details: ['Use the run test flow.'],
          code: 'npm run doctor',
          note: 'This is a verification step.',
        },
      ],
    });

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByRole('heading', { name: /deployment truth surface/i })).toBeTruthy();
    expect(screen.getByText(/database verification/i)).toBeTruthy();
    expect(screen.getByText(/validate your connection/i)).toBeTruthy();
    expect(screen.getByText(/ready but not fully verified/i)).toBeTruthy();
    expect(screen.queryByText(/redirect/i)).toBeNull();
  });
});
