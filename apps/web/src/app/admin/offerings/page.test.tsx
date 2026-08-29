import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CourseWithRelations, DeliveryMode, Offering, OfferingWithCourses } from '@/lib/types';
import AdminOfferingsPage from './page';

interface CreateOfferingPayload {
  name: string;
  deliveryMode: DeliveryMode;
  monthlyPrice: number;
  courseIds: string[];
}

const listOfferingsMock = vi.fn<() => Promise<Offering[]>>();
const listCoursesMock = vi.fn<() => Promise<CourseWithRelations[]>>();
const createOfferingMock =
  vi.fn<(payload: CreateOfferingPayload) => Promise<OfferingWithCourses>>();

vi.mock('@/lib/endpoints', () => ({
  offeringsApi: {
    list: () => listOfferingsMock(),
    create: (payload: CreateOfferingPayload) => createOfferingMock(payload),
  },
  coursesApi: { list: () => listCoursesMock() },
}));

describe('AdminOfferingsPage', () => {
  afterEach(() => vi.clearAllMocks());

  it('submits the intended payload with selected courses represented by their ids', async () => {
    const user = userEvent.setup();
    listOfferingsMock.mockResolvedValue([]);
    listCoursesMock.mockResolvedValue([
      { id: 'course-maths', title: 'Mathematics' },
      { id: 'course-science', title: 'Science' },
    ] as CourseWithRelations[]);
    createOfferingMock.mockResolvedValue({
      id: 'offering-1',
      name: 'Grade 8 Live',
      deliveryMode: 'RECORDED_ONLY',
      monthlyPrice: '249.50',
      courses: [],
    });

    render(<AdminOfferingsPage />);

    await user.type(await screen.findByPlaceholderText(/Grade 8 Mathematics/), ' Grade 8 Live ');
    await user.selectOptions(screen.getByRole('combobox'), 'RECORDED_ONLY');
    await user.type(screen.getByRole('spinbutton'), '249.50');
    await user.click(screen.getByLabelText('Mathematics'));
    expect(screen.getByLabelText('Mathematics')).toBeChecked();
    expect(screen.getByLabelText('Science')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /create offering/i }));

    await waitFor(() =>
      expect(createOfferingMock).toHaveBeenCalledWith({
        name: 'Grade 8 Live',
        deliveryMode: 'RECORDED_ONLY',
        monthlyPrice: 249.5,
        courseIds: ['course-maths'],
      }),
    );
  });
});
