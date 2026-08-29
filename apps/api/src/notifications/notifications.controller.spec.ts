import { NotificationsController } from './notifications.controller.js';
import type { NotificationsService } from './notifications.service.js';

describe('NotificationsController', () => {
  let service: { listAll: jest.Mock; retryFailed: jest.Mock };
  let controller: NotificationsController;

  beforeEach(() => {
    service = { listAll: jest.fn(), retryFailed: jest.fn() };
    controller = new NotificationsController(service as unknown as NotificationsService);
  });

  it('findAll delegates to listAll with the status filter', async () => {
    service.listAll.mockResolvedValue([]);

    await controller.findAll({ status: 'FAILED' } as never);

    expect(service.listAll).toHaveBeenCalledWith('FAILED');
  });

  it('retry delegates to retryFailed', async () => {
    service.retryFailed.mockResolvedValue({ id: 'n1' });

    const result = await controller.retry('n1');

    expect(service.retryFailed).toHaveBeenCalledWith('n1');
    expect(result).toEqual({ id: 'n1' });
  });
});
