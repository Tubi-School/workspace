import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { SessionStatus } from '@/lib/types';

const TONE_BY_STATUS: Record<SessionStatus, BadgeTone> = {
  SCHEDULED: 'neutral',
  LIVE: 'danger',
  ENDED: 'success',
  CANCELED: 'warning',
};

const LABEL_BY_STATUS: Record<SessionStatus, string> = {
  SCHEDULED: 'Scheduled',
  LIVE: 'Live now',
  ENDED: 'Completed',
  CANCELED: 'Canceled',
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return <Badge tone={TONE_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>;
}
