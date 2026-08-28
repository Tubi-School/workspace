import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Offering } from '@/lib/types';
import LearnerSubscriptionPage from './page';

const listOfferingsMock = vi.fn<() => Promise<Offering[]>>();
const checkoutMock = vi.fn<(offeringId: string) => Promise<{ checkoutUrl: string }>>();
vi.mock('@/lib/endpoints', () => ({
  paymentsApi: {
    listOfferings: () => listOfferingsMock(),
    checkout: (offeringId: string) => checkoutMock(offeringId),
  },
}));

function buildOffering(overrides: Partial<Offering> = {}): Offering {
  return {
    id: 'offering-1',
    name: 'Grade 8 Live Bundle',
    deliveryMode: 'LIVE_AND_RECORDED',
    monthlyPrice: '150.00',
    ...overrides,
  };
}

describe('LearnerSubscriptionPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists available offerings for the learner to subscribe to', async () => {
    listOfferingsMock.mockResolvedValue([buildOffering()]);

    render(<LearnerSubscriptionPage />);

    expect(await screen.findByText('Grade 8 Live Bundle')).toBeInTheDocument();
    expect(screen.getByText(/R150\.00/)).toBeInTheDocument();
  });

  it('redirects to the real provider checkout URL — never claims access was granted itself', async () => {
    listOfferingsMock.mockResolvedValue([buildOffering()]);
    checkoutMock.mockResolvedValue({ checkoutUrl: 'https://checkout.paystack.com/abc123' });
    const user = userEvent.setup();

    // jsdom does not implement navigation; asserting the assignment is
    // enough to prove this page hands off to the real provider rather
    // than fabricating success client-side.
    let assignedHref = '';
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        set href(value: string) {
          assignedHref = value;
        },
      },
      writable: true,
    });

    render(<LearnerSubscriptionPage />);

    await user.click(await screen.findByRole('button', { name: /subscribe/i }));

    await waitFor(() => expect(checkoutMock).toHaveBeenCalledWith('offering-1'));
    await waitFor(() => expect(assignedHref).toBe('https://checkout.paystack.com/abc123'));
  });

  it('shows the checkout error when payments are not configured, without crashing', async () => {
    listOfferingsMock.mockResolvedValue([buildOffering()]);
    checkoutMock.mockRejectedValue(new Error('Payments are not configured yet'));
    const user = userEvent.setup();

    render(<LearnerSubscriptionPage />);

    await user.click(await screen.findByRole('button', { name: /subscribe/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });
});
