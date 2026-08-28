import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AttendanceRecord, CoverageSummary, LearnerVisibleSession } from '@/lib/types';
import LearnerSessionDetailPage from './page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'session-1' }),
}));

const getSessionMock = vi.fn<(id: string) => Promise<LearnerVisibleSession>>();
const getAttendanceMock = vi.fn<(id: string) => Promise<AttendanceRecord & CoverageSummary>>();
vi.mock('@/lib/endpoints', () => ({
  learnerPortalApi: {
    getSession: (id: string) => getSessionMock(id),
    getAttendance: (id: string) => getAttendanceMock(id),
    reportWatchedInterval: vi.fn(),
  },
}));

function buildSession(overrides: Partial<LearnerVisibleSession> = {}): LearnerVisibleSession {
  return {
    id: 'session-1',
    sessionDate: '2026-07-01',
    startTime: '2026-07-01T11:00:00Z',
    endTime: '2026-07-01T12:00:00Z',
    liveMeetingUrl: 'https://meet.example.com/room',
    status: 'SCHEDULED',
    course: { id: 'course-1', title: 'Algebra I' },
    recording: null,
    ...overrides,
  };
}

function buildAttendance(
  overrides: Partial<AttendanceRecord & CoverageSummary> = {},
): AttendanceRecord & CoverageSummary {
  return {
    id: 'record-1',
    sessionId: 'session-1',
    learnerId: 'learner-1',
    completionMode: null,
    completedAt: null,
    status: 'PENDING',
    createdAt: '2026-07-01T00:00:00Z',
    liveCoverageMs: 0,
    recordedCoverageSeconds: null,
    ...overrides,
  };
}

describe('LearnerSessionDetailPage — DeliveryMode UI enforcement', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the "Join live class" action when the backend returns a real liveMeetingUrl (LIVE_AND_RECORDED entitlement)', async () => {
    getSessionMock.mockResolvedValue(
      buildSession({ liveMeetingUrl: 'https://meet.example.com/room' }),
    );
    getAttendanceMock.mockResolvedValue(buildAttendance());

    render(<LearnerSessionDetailPage />);

    expect(await screen.findByRole('link', { name: /join live class/i })).toHaveAttribute(
      'href',
      'https://meet.example.com/room',
    );
  });

  it('hides live access entirely when the backend redacts liveMeetingUrl to an empty string (RECORDED_ONLY entitlement) — never inferred client-side', async () => {
    getSessionMock.mockResolvedValue(buildSession({ liveMeetingUrl: '' }));
    getAttendanceMock.mockResolvedValue(buildAttendance());

    render(<LearnerSessionDetailPage />);

    await screen.findByText('Algebra I');
    expect(screen.queryByRole('link', { name: /join live class/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not included in your current plan/i)).toBeInTheDocument();
  });

  it('shows the recording section only when the backend has published one', async () => {
    getSessionMock.mockResolvedValue(
      buildSession({
        recording: {
          id: 'rec-1',
          sessionId: 'session-1',
          recordingUrl: 'https://cdn.example.com/rec.mp4',
          availableFrom: '2026-07-01T13:00:00Z',
          totalSeconds: 3600,
        },
      }),
    );
    getAttendanceMock.mockResolvedValue(buildAttendance());

    render(<LearnerSessionDetailPage />);

    expect(await screen.findByRole('link', { name: /open recording/i })).toHaveAttribute(
      'href',
      'https://cdn.example.com/rec.mp4',
    );
  });

  it('renders attendance in human language, including LIVE completion mode', async () => {
    getSessionMock.mockResolvedValue(buildSession());
    getAttendanceMock.mockResolvedValue(
      buildAttendance({ status: 'PRESENT', completionMode: 'LIVE', liveCoverageMs: 35 * 60_000 }),
    );

    render(<LearnerSessionDetailPage />);

    expect(await screen.findByText('Present (Live)')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/35 minute/)).toBeInTheDocument());
  });
});
