import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PaymentOrder } from '@/lib/types';
import AdminPaymentsPage from './page';

const listAllMock = vi.fn<() => Promise<PaymentOrder[]>>();
vi.mock('@/lib/endpoints', () => ({
  paymentsApi: { listAll: () => listAllMock() },
}));

function buildOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-1',
    learnerId: 'learner-1',
    offeringId: 'offering-1',
    provider: 'PAYSTACK',
    providerReference: 'ref-1',
    amountMinor: 15000,
    currency: 'ZAR',
    status: 'PAID',
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('AdminPaymentsPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists payment orders with their verified status', async () => {
    listAllMock.mockResolvedValue([buildOrder()]);

    render(<AdminPaymentsPage />);

    expect(await screen.findByText(/ZAR 150\.00/)).toBeInTheDocument();
    expect(screen.getByText('PAID')).toBeInTheDocument();
  });

  it('shows an empty state when no orders exist yet', async () => {
    listAllMock.mockResolvedValue([]);

    render(<AdminPaymentsPage />);

    expect(await screen.findByText(/no payment orders yet/i)).toBeInTheDocument();
  });
});
