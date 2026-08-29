import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationOutboxItem, NotificationOutboxStatus } from '@/lib/types';
import AdminNotificationsPage from './page';

const listMock = vi.fn<(status?: NotificationOutboxStatus) => Promise<NotificationOutboxItem[]>>();
const retryMock = vi.fn<(id: string) => Promise<NotificationOutboxItem>>();

vi.mock('@/lib/endpoints', () => ({
  notificationsApi: {
    list: (status?: NotificationOutboxStatus) => listMock(status),
    retry: (id: string) => retryMock(id),
  },
}));

describe('AdminNotificationsPage', () => {
  afterEach(() => vi.clearAllMocks());

  it('offers retry only for FAILED rows and calls the retry endpoint for that row', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([
      {
        id: 'failed-1',
        type: 'SESSION_REMINDER',
        recipientUserId: 'user-1',
        status: 'FAILED',
        attempts: 5,
        createdAt: '2026-08-01T00:00:00Z',
        sentAt: null,
        lastError: 'SMTP unavailable',
        recipient: { id: 'user-1', email: 'a@example.com', fullName: 'A Learner' },
      },
      {
        id: 'sent-1',
        type: 'REGISTRATION',
        recipientUserId: 'user-2',
        status: 'SENT',
        attempts: 1,
        createdAt: '2026-08-01T00:00:00Z',
        sentAt: '2026-08-01T00:01:00Z',
        lastError: null,
        recipient: { id: 'user-2', email: 'b@example.com', fullName: 'B Learner' },
      },
    ]);
    retryMock.mockResolvedValue({
      id: 'failed-1',
      type: 'SESSION_REMINDER',
      recipientUserId: 'user-1',
      status: 'PENDING',
      attempts: 0,
      createdAt: '2026-08-01T00:00:00Z',
      sentAt: null,
      lastError: null,
      recipient: null,
    });

    render(<AdminNotificationsPage />);

    expect(await screen.findByText(/A Learner/)).toBeInTheDocument();
    expect(screen.getByText(/B Learner/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(retryMock).toHaveBeenCalledWith('failed-1'));
    expect(retryMock).not.toHaveBeenCalledWith('sent-1');
  });
});
