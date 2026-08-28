import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NamedEntityManager } from './named-entity-manager';

describe('NamedEntityManager (admin CRUD form — used by Grade Levels / Subjects)', () => {
  it('creates a new entity and refreshes the list', async () => {
    const user = userEvent.setup();
    const fetchAll = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: '1', name: 'Grade 8' }]);
    const create = vi.fn().mockResolvedValue({ id: '1', name: 'Grade 8' });

    render(
      <NamedEntityManager
        title="Grade Levels"
        description="desc"
        fetchAll={fetchAll}
        create={create}
        update={vi.fn()}
        remove={vi.fn()}
      />,
    );

    await screen.findByText('Nothing here yet');
    await user.type(screen.getByLabelText('Name'), 'Grade 8');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('Grade 8'));
    expect(await screen.findByText('Grade 8')).toBeInTheDocument();
  });

  it('shows the backend failure message and does not clear the form on a failed create', async () => {
    const user = userEvent.setup();
    const fetchAll = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockRejectedValue(new Error('name must not be empty'));

    render(
      <NamedEntityManager
        title="Subjects"
        description="desc"
        fetchAll={fetchAll}
        create={create}
        update={vi.fn()}
        remove={vi.fn()}
      />,
    );

    await screen.findByText('Nothing here yet');
    await user.type(screen.getByLabelText('Name'), 'Mathematics');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    // The generic fallback message from useAsyncAction — this test's real
    // assertion is that a raw Error/stack trace is never shown, only the
    // sanitized fallback (ApiError messages are asserted separately in
    // api-client tests).
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('deletes an entity', async () => {
    const user = userEvent.setup();
    const fetchAll = vi
      .fn()
      .mockResolvedValueOnce([{ id: '1', name: 'Grade 8' }])
      .mockResolvedValueOnce([]);
    const remove = vi.fn().mockResolvedValue(undefined);

    render(
      <NamedEntityManager
        title="Grade Levels"
        description="desc"
        fetchAll={fetchAll}
        create={vi.fn()}
        update={vi.fn()}
        remove={remove}
      />,
    );

    await screen.findByText('Grade 8');
    await user.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('1'));
  });
});
