import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LaunchOperationsReport } from '@/lib/types';
import AdminOperationsPage from './page';

const getReportMock = vi.fn<() => Promise<LaunchOperationsReport>>();
vi.mock('@/lib/endpoints', () => ({
  operationsApi: { getReport: () => getReportMock() },
}));

describe('AdminOperationsPage', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders database and provider states returned by the operations API', async () => {
    getReportMock.mockResolvedValue({
      database: 'down',
      providers: { zoom: 'CONFIGURED', payments: 'NOT_CONFIGURED', email: 'CONFIGURED' },
      stuckMeetingsCount: 2,
      permanentlyFailedNotificationsCount: 3,
      paymentsAwaitingResolutionCount: 4,
      upcomingSessionsCount: 5,
    });

    render(<AdminOperationsPage />);

    expect(await screen.findByText('Down')).toBeInTheDocument();
    expect(screen.getAllByText('Configured')).toHaveLength(2);
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText('Zoom (live classes)')).toBeInTheDocument();
    expect(screen.getByText('Payments (Paystack)')).toBeInTheDocument();
    expect(screen.getByText('Email (SMTP)')).toBeInTheDocument();
  });

  it('renders "Unavailable" — never a misleading 0 — for every count when the database is down', async () => {
    getReportMock.mockResolvedValue({
      database: 'down',
      providers: { zoom: 'NOT_CONFIGURED', payments: 'NOT_CONFIGURED', email: 'NOT_CONFIGURED' },
      stuckMeetingsCount: null,
      permanentlyFailedNotificationsCount: null,
      paymentsAwaitingResolutionCount: null,
      upcomingSessionsCount: null,
    });

    render(<AdminOperationsPage />);

    expect(await screen.findAllByText('Unavailable')).toHaveLength(4);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
