import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { AttendanceStatus, CompletionMode } from '@/lib/types';

const TONE_BY_STATUS: Record<AttendanceStatus, BadgeTone> = {
  PENDING: 'neutral',
  PRESENT: 'success',
  ABSENT: 'danger',
};

/**
 * Renders attendance in human language only — "Present (Live)", "Absent",
 * "Pending" — never internal terms like completionMode/CompletionMode
 * enum values verbatim, and never a frontend-computed percentage. The
 * backend is authoritative for the status and completionMode values
 * themselves (Phase 2F attendance engine); this component only translates
 * them to words.
 */
export function AttendanceStatusBadge({
  status,
  completionMode,
}: {
  status: AttendanceStatus;
  completionMode?: CompletionMode | null;
}) {
  const label =
    status === 'PRESENT'
      ? `Present${completionMode ? ` (${completionMode === 'LIVE' ? 'Live' : 'Recorded'})` : ''}`
      : status === 'ABSENT'
        ? 'Absent'
        : 'Pending';

  return <Badge tone={TONE_BY_STATUS[status]}>{label}</Badge>;
}
