import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AttendanceRecordWithLearner, SessionWithRelations } from '@/lib/types';
import TeacherSessionDetailPage from './page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'session-1' }),
}));

const getSessionMock = vi.fn<() => Promise<SessionWithRelations>>();
const getAttendanceMock = vi.fn<() => Promise<AttendanceRecordWithLearner[]>>();
vi.mock('@/lib/endpoints', () => ({
  teacherPortalApi: { getSession: () => getSessionMock() },
  attendanceApi: { getForSessionAsTeacher: () => getAttendanceMock() },
}));

function buildSession(overrides: Partial<SessionWithRelations> = {}): SessionWithRelations {
  return {
    id: 'session-1',
    courseId: 'course-1',
    sessionDate: '2026-07-01',
    startTime: '2026-07-01T11:00:00Z',
    endTime: '2026-07-01T12:00:00Z',
    attendanceCutoffAt: '2026-07-01T21:59:00Z',
    liveMeetingUrl: 'https://meet.example.com/room',
    status: 'LIVE',
    canceledAt: null,
    replacementForSessionId: null,
    meetingProvider: null,
    meetingProvisioningStatus: 'NOT_REQUIRED',
    meetingProvisioningError: null,
    course: { id: 'course-1', title: 'Algebra I' },
    teachers: [
      {
        sessionId: 'session-1',
        teacherId: 'teacher-1',
        teacherRole: 'PRIMARY',
        teacher: {
          id: 'teacher-1',
          bio: null,
          createdAt: '2026-01-01',
          userId: 'user-1',
          user: {
            id: 'user-1',
            email: 't@example.com',
            fullName: 'Teacher One',
            role: 'TEACHER',
            isActive: true,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        },
      },
    ],
    ...overrides,
  };
}

describe('TeacherSessionDetailPage — live classroom join', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('offers "Join class" for a LIVE session with a provisioned meeting', async () => {
    getSessionMock.mockResolvedValue(
      buildSession({ status: 'LIVE', liveMeetingUrl: 'https://zoom.example.invalid/j/1' }),
    );
    getAttendanceMock.mockResolvedValue([]);

    render(<TeacherSessionDetailPage />);

    expect(await screen.findByRole('link', { name: /join class/i })).toHaveAttribute(
      'href',
      'https://zoom.example.invalid/j/1',
    );
  });

  it('offers "Start class" (not "Join") for a SCHEDULED session with a provisioned meeting', async () => {
    getSessionMock.mockResolvedValue(
      buildSession({ status: 'SCHEDULED', liveMeetingUrl: 'https://zoom.example.invalid/j/1' }),
    );
    getAttendanceMock.mockResolvedValue([]);

    render(<TeacherSessionDetailPage />);

    expect(await screen.findByRole('link', { name: /start class/i })).toBeInTheDocument();
  });

  it('never fabricates a join link when the meeting has not been provisioned yet', async () => {
    getSessionMock.mockResolvedValue(
      buildSession({
        liveMeetingUrl: '',
        meetingProvisioningStatus: 'FAILED',
      }),
    );
    getAttendanceMock.mockResolvedValue([]);

    render(<TeacherSessionDetailPage />);

    await screen.findByText('Algebra I');
    expect(screen.queryByRole('link', { name: /join class|start class/i })).not.toBeInTheDocument();
    expect(screen.getByText(/contact an administrator/i)).toBeInTheDocument();
  });
});

describe('TeacherSessionDetailPage — authorization-sensitive UI (Phase 3 external review, documentation correction)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders no ADMIN-only lifecycle controls (mark live / mark ended / cancel), for a SCHEDULED session', async () => {
    getSessionMock.mockResolvedValue(buildSession({ status: 'SCHEDULED' }));
    getAttendanceMock.mockResolvedValue([]);

    render(<TeacherSessionDetailPage />);

    await screen.findByText('Algebra I');
    expect(screen.queryByRole('button', { name: /mark live/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark ended/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel session/i })).not.toBeInTheDocument();
  });

  it('renders no ADMIN-only lifecycle controls for a LIVE session either', async () => {
    getSessionMock.mockResolvedValue(buildSession({ status: 'LIVE' }));
    getAttendanceMock.mockResolvedValue([]);

    render(<TeacherSessionDetailPage />);

    await screen.findByText('Algebra I');
    expect(screen.queryByRole('button', { name: /mark live/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark ended/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel session/i })).not.toBeInTheDocument();
  });

  it('renders no recording-publish form, for an ENDED session where the admin equivalent would enable one', async () => {
    getSessionMock.mockResolvedValue(buildSession({ status: 'ENDED' }));
    getAttendanceMock.mockResolvedValue([]);

    render(<TeacherSessionDetailPage />);

    await screen.findByText('Algebra I');
    expect(screen.queryByRole('button', { name: /publish recording/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/recording url/i)).not.toBeInTheDocument();
  });

  it('renders no teacher-assignment mutation controls (add/remove teacher)', async () => {
    getSessionMock.mockResolvedValue(buildSession());
    getAttendanceMock.mockResolvedValue([]);

    render(<TeacherSessionDetailPage />);

    await screen.findByText('Teacher One');
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^assign$/i })).not.toBeInTheDocument();
  });
});
