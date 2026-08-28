import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AttendanceStatusBadge } from './attendance-status-badge';

describe('AttendanceStatusBadge', () => {
  it('renders PENDING as "Pending"', () => {
    render(<AttendanceStatusBadge status="PENDING" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders ABSENT as "Absent"', () => {
    render(<AttendanceStatusBadge status="ABSENT" />);
    expect(screen.getByText('Absent')).toBeInTheDocument();
  });

  it('renders PRESENT with LIVE completion mode as "Present (Live)"', () => {
    render(<AttendanceStatusBadge status="PRESENT" completionMode="LIVE" />);
    expect(screen.getByText('Present (Live)')).toBeInTheDocument();
  });

  it('renders PRESENT with RECORDED completion mode as "Present (Recorded)"', () => {
    render(<AttendanceStatusBadge status="PRESENT" completionMode="RECORDED" />);
    expect(screen.getByText('Present (Recorded)')).toBeInTheDocument();
  });

  it('never renders the raw enum token "PRESENT" or "COMPLETION_MODE" verbatim', () => {
    render(<AttendanceStatusBadge status="PRESENT" completionMode="LIVE" />);
    expect(screen.queryByText('PRESENT')).not.toBeInTheDocument();
  });
});
