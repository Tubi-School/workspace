import type { RoleName } from '@/lib/types';

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The single source of truth for role-aware navigation. Both the desktop
 * sidebar and the mobile nav read from this — there is exactly one place
 * that decides what each role can navigate to, so the RBAC UX tests in
 * nav-config.spec.ts can assert against it directly rather than against
 * rendered markup.
 */
export const NAV_BY_ROLE: Record<RoleName, NavItem[]> = {
  ADMIN: [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/sessions', label: 'Sessions' },
    { href: '/admin/courses', label: 'Courses' },
    { href: '/admin/teachers', label: 'Teachers' },
    { href: '/admin/learners', label: 'Learners' },
    { href: '/admin/subscription-access', label: 'Subscription Access' },
    { href: '/admin/payments', label: 'Payments' },
    { href: '/admin/academic-terms', label: 'Academic Terms' },
    { href: '/admin/subjects', label: 'Subjects' },
    { href: '/admin/grade-levels', label: 'Grade Levels' },
  ],
  TEACHER: [
    { href: '/teacher', label: 'Overview' },
    { href: '/teacher/sessions', label: 'My Sessions' },
  ],
  LEARNER: [
    { href: '/learner', label: 'My Sessions' },
    { href: '/learner/subscription', label: 'Subscription' },
  ],
};

export function homeRouteForRole(role: RoleName): string {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'TEACHER':
      return '/teacher';
    case 'LEARNER':
      return '/learner';
  }
}
