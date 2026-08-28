import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LearnerWithUser, Offering, SubscriptionAccess } from '@/lib/types';
import SubscriptionAccessPage from './page';

const listGrantsMock = vi.fn<() => Promise<SubscriptionAccess[]>>();
const createGrantMock = vi.fn<(dto: unknown) => Promise<SubscriptionAccess>>();
const listLearnersMock = vi.fn<() => Promise<LearnerWithUser[]>>();
const listOfferingsMock = vi.fn<() => Promise<Offering[]>>();

vi.mock('@/lib/endpoints', () => ({
  subscriptionAccessApi: {
    list: () => listGrantsMock(),
    create: (dto: unknown) => createGrantMock(dto),
    revoke: vi.fn(),
  },
  learnersApi: { list: () => listLearnersMock() },
  offeringsApi: { list: () => listOfferingsMock() },
}));

const LEARNER: LearnerWithUser = {
  id: 'learner-1',
  dateOfBirth: null,
  guardianContact: null,
  createdAt: '2026-01-01',
  userId: 'user-1',
  user: {
    id: 'user-1',
    email: 'learner@example.com',
    fullName: 'Lea Rner',
    role: 'LEARNER',
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
};

const OFFERING: Offering = {
  id: 'offering-1',
  name: 'Grade 8 Mathematics — Live',
  deliveryMode: 'LIVE_AND_RECORDED',
  monthlyPrice: '499.00',
};

describe('SubscriptionAccessPage — Phase 3 external review Correction 3 (real Offering selector)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('populates the Offering field from GET /admin/offerings as a real select, not a free-text UUID field', async () => {
    listGrantsMock.mockResolvedValue([]);
    listLearnersMock.mockResolvedValue([LEARNER]);
    listOfferingsMock.mockResolvedValue([OFFERING]);

    render(<SubscriptionAccessPage />);

    const offeringSelect = await screen.findByLabelText('Offering');
    expect(offeringSelect.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: /Grade 8 Mathematics — Live/ })).toBeInTheDocument();
    // No raw UUID text input for the offering exists anywhere on the page.
    expect(screen.queryByPlaceholderText(/uuid/i)).not.toBeInTheDocument();
  });

  it('submits the grant with the real offeringId selected from the dropdown', async () => {
    const user = userEvent.setup();
    listGrantsMock.mockResolvedValue([]);
    listLearnersMock.mockResolvedValue([LEARNER]);
    listOfferingsMock.mockResolvedValue([OFFERING]);
    createGrantMock.mockResolvedValue({
      id: 'grant-1',
      learnerId: LEARNER.id,
      offeringId: OFFERING.id,
      status: 'ACTIVE',
      currentPeriodStart: '2026-01-01',
      currentPeriodEnd: '2026-12-31',
    });

    render(<SubscriptionAccessPage />);

    await screen.findByLabelText('Offering');
    await user.selectOptions(screen.getByLabelText('Learner'), LEARNER.id);
    await user.selectOptions(screen.getByLabelText('Offering'), OFFERING.id);
    await user.type(screen.getByLabelText('Period start'), '2026-01-01');
    await user.type(screen.getByLabelText('Period end'), '2026-12-31');
    await user.click(screen.getByRole('button', { name: /grant access/i }));

    await waitFor(() =>
      expect(createGrantMock).toHaveBeenCalledWith(
        expect.objectContaining({ offeringId: OFFERING.id, learnerId: LEARNER.id }),
      ),
    );
  });

  it('renders the offering NAME (not the raw id) in the grants list once the grant exists', async () => {
    listGrantsMock.mockResolvedValue([
      {
        id: 'grant-1',
        learnerId: LEARNER.id,
        offeringId: OFFERING.id,
        status: 'ACTIVE',
        currentPeriodStart: '2026-01-01',
        currentPeriodEnd: '2026-12-31',
      },
    ]);
    listLearnersMock.mockResolvedValue([LEARNER]);
    listOfferingsMock.mockResolvedValue([OFFERING]);

    render(<SubscriptionAccessPage />);

    expect(await screen.findByText('Grade 8 Mathematics — Live')).toBeInTheDocument();
  });
});
