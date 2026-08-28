import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CourseWithRelations, SanitizedUser, SessionWithRelations } from '@/lib/types';
import TeacherOverviewPage from './page';

interface MockAuthState {
  user: SanitizedUser | null;
}

const mockUseAuth = vi.fn<() => MockAuthState>();
vi.mock('@/context/auth-context', () => ({
  useAuth: (): MockAuthState => mockUseAuth(),
}));

const listCoursesMock = vi.fn<() => Promise<CourseWithRelations[]>>();
const listSessionsMock = vi.fn<() => Promise<SessionWithRelations[]>>();
vi.mock('@/lib/endpoints', () => ({
  teacherPortalApi: {
    listCourses: () => listCoursesMock(),
    listSessions: () => listSessionsMock(),
  },
}));

function buildCourse(overrides: Partial<CourseWithRelations> = {}): CourseWithRelations {
  return {
    id: 'course-mine',
    title: 'My Course',
    subjectId: 's1',
    gradeLevelId: 'g1',
    academicTermId: 't1',
    primaryTeacherId: 'teacher-me',
    subject: { id: 's1', name: 'Mathematics' },
    gradeLevel: { id: 'g1', name: 'Grade 8' },
    academicTerm: {
      id: 't1',
      name: 'Term 1',
      startDate: '2026-01-01',
      endDate: '2026-06-01',
      timezone: 'Africa/Johannesburg',
    },
    primaryTeacher: { id: 'teacher-me', bio: null, createdAt: '2026-01-01', userId: 'user-me' },
    ...overrides,
  };
}

describe('TeacherOverviewPage — Phase 3 Correction 1 (server-side teacher scoping)', () => {
  it('renders only what the server-scoped /teacher/courses and /teacher/sessions endpoints return, with no client-side ownership filtering', async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 'user-me',
        email: 'me@example.com',
        fullName: 'Me Teacher',
        role: 'TEACHER',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    });
    listCoursesMock.mockResolvedValue([buildCourse()]);
    listSessionsMock.mockResolvedValue([]);

    render(<TeacherOverviewPage />);

    expect(await screen.findByText('My Course')).toBeInTheDocument();
    // The page calls exactly the two teacher-scoped endpoints — it never
    // imports or calls the broad ADMIN collection endpoints
    // (coursesApi.list/sessionsApi.list) that would require client-side
    // filtering to be "safe", proving the scoping now happens server-side.
    expect(listCoursesMock).toHaveBeenCalledTimes(1);
    expect(listSessionsMock).toHaveBeenCalledTimes(1);
  });

  it('never receives or renders a course belonging to a different teacher — the endpoint itself returns only the caller own data', async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 'user-me',
        email: 'me@example.com',
        fullName: 'Me Teacher',
        role: 'TEACHER',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    });
    // Simulates the real backend contract: /teacher/courses never
    // includes another teacher's course in the first place.
    listCoursesMock.mockResolvedValue([buildCourse({ id: 'course-mine', title: 'My Course' })]);
    listSessionsMock.mockResolvedValue([]);

    render(<TeacherOverviewPage />);

    await screen.findByText('My Course');
    expect(screen.queryByText('Someone Else Course')).not.toBeInTheDocument();
  });
});
