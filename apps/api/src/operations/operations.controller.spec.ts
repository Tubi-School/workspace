import { OperationsController } from './operations.controller.js';
import type { OperationsService } from './operations.service.js';

describe('OperationsController', () => {
  it('delegates to OperationsService.getReport', async () => {
    const report = { database: 'ok' } as never;
    const service = { getReport: jest.fn().mockResolvedValue(report) };
    const controller = new OperationsController(service as unknown as OperationsService);

    await expect(controller.getReport()).resolves.toBe(report);
    expect(service.getReport).toHaveBeenCalled();
  });
});
