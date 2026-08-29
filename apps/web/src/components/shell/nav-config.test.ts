import { describe, expect, it } from 'vitest';

import { NAV_BY_ROLE, homeRouteForRole } from './nav-config';

describe('NAV_BY_ROLE (RBAC navigation)', () => {
  it('gives ADMIN access to every administrative section', () => {
    const hrefs = NAV_BY_ROLE.ADMIN.map((item) => item.href);
    expect(hrefs).toContain('/admin');
    expect(hrefs).toContain('/admin/sessions');
    expect(hrefs).toContain('/admin/courses');
    expect(hrefs).toContain('/admin/teachers');
    expect(hrefs).toContain('/admin/learners');
    expect(hrefs).toContain('/admin/subscription-access');
    expect(hrefs).toContain('/admin/offerings');
    expect(hrefs).toContain('/admin/notifications');
    expect(hrefs).toContain('/admin/operations');
  });

  it('gives TEACHER only teaching-operations navigation, never admin governance routes', () => {
    const hrefs = NAV_BY_ROLE.TEACHER.map((item) => item.href);
    expect(hrefs).toEqual(['/teacher', '/teacher/sessions']);
    expect(hrefs.some((href) => href.startsWith('/admin'))).toBe(false);
  });

  it('gives LEARNER only their own session-centric and commercial navigation', () => {
    const hrefs = NAV_BY_ROLE.LEARNER.map((item) => item.href);
    expect(hrefs).toEqual(['/learner', '/learner/subscription']);
    expect(hrefs.some((href) => href.startsWith('/admin') || href.startsWith('/teacher'))).toBe(
      false,
    );
  });

  it('routes each role home to its own workspace, never a different role’s', () => {
    expect(homeRouteForRole('ADMIN')).toBe('/admin');
    expect(homeRouteForRole('TEACHER')).toBe('/teacher');
    expect(homeRouteForRole('LEARNER')).toBe('/learner');
  });
});
