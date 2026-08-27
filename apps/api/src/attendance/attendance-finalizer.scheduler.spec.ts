import { AttendanceFinalizerScheduler } from './attendance-finalizer.scheduler.js';
import type { AttendanceService } from './attendance.service.js';

describe('AttendanceFinalizerScheduler', () => {
  let attendanceService: { finalizeDueRecords: jest.Mock };
  let scheduler: AttendanceFinalizerScheduler;

  beforeEach(() => {
    attendanceService = { finalizeDueRecords: jest.fn() };
    scheduler = new AttendanceFinalizerScheduler(attendanceService as unknown as AttendanceService);
  });

  it('calls finalizeDueRecords on each run', async () => {
    attendanceService.finalizeDueRecords.mockResolvedValue({ finalizedCount: 0 });

    await scheduler.run();

    expect(attendanceService.finalizeDueRecords).toHaveBeenCalledTimes(1);
  });

  it('is safe to invoke repeatedly (idempotent by delegation to the already-idempotent finalizer)', async () => {
    attendanceService.finalizeDueRecords
      .mockResolvedValueOnce({ finalizedCount: 3 })
      .mockResolvedValueOnce({ finalizedCount: 0 });

    await scheduler.run();
    await scheduler.run();

    expect(attendanceService.finalizeDueRecords).toHaveBeenCalledTimes(2);
  });

  it('propagates rejection rather than swallowing a failed finalization run', async () => {
    attendanceService.finalizeDueRecords.mockRejectedValue(new Error('db unreachable'));

    await expect(scheduler.run()).rejects.toThrow('db unreachable');
  });
});
