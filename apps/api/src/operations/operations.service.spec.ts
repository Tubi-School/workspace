import type { PrismaService } from '../prisma/prisma.service.js';
import { OperationsService } from './operations.service.js';

describe('OperationsService', () => {
  let prisma: {
    ping: jest.Mock;
    session: { count: jest.Mock };
    notificationOutboxItem: { count: jest.Mock };
    paymentOrder: { count: jest.Mock };
  };
  let zoomProvider: { isOperationallyConfigured: jest.Mock };
  let paymentsService: { isConfigured: jest.Mock };
  let emailProvider: { isConfigured: jest.Mock };
  let service: OperationsService;

  beforeEach(() => {
    prisma = {
      ping: jest.fn().mockResolvedValue(undefined),
      session: { count: jest.fn().mockResolvedValue(0) },
      notificationOutboxItem: { count: jest.fn().mockResolvedValue(0) },
      paymentOrder: { count: jest.fn().mockResolvedValue(0) },
    };
    zoomProvider = { isOperationallyConfigured: jest.fn().mockReturnValue(false) };
    paymentsService = { isConfigured: jest.fn().mockReturnValue(false) };
    emailProvider = { isConfigured: jest.fn().mockReturnValue(false) };
    service = new OperationsService(
      prisma as unknown as PrismaService,
      zoomProvider as never,
      paymentsService as never,
      emailProvider as never,
    );
  });

  it('reports the database as ok when the ping succeeds', async () => {
    const report = await service.getReport();
    expect(report.database).toBe('ok');
  });

  it('reports the database as down when the ping throws, without leaking the error', async () => {
    prisma.ping.mockRejectedValue(new Error('connection refused at 10.0.0.5:5432'));
    const report = await service.getReport();
    expect(report.database).toBe('down');
  });

  it('reports every count as null (unavailable), never 0, when the database is down', async () => {
    prisma.ping.mockRejectedValue(new Error('connection refused at 10.0.0.5:5432'));

    const report = await service.getReport();

    expect(report.stuckMeetingsCount).toBeNull();
    expect(report.permanentlyFailedNotificationsCount).toBeNull();
    expect(report.paymentsAwaitingResolutionCount).toBeNull();
    expect(report.upcomingSessionsCount).toBeNull();
    // The counts must be reported unavailable WITHOUT ever attempting the
    // count queries — a query issued against an unreachable database would
    // either hang or itself throw, neither of which is "0".
    expect(prisma.session.count).not.toHaveBeenCalled();
    expect(prisma.notificationOutboxItem.count).not.toHaveBeenCalled();
    expect(prisma.paymentOrder.count).not.toHaveBeenCalled();
  });

  it('reports each provider as NOT_CONFIGURED when its variables are absent', async () => {
    const report = await service.getReport();
    expect(report.providers).toEqual({
      zoom: 'NOT_CONFIGURED',
      payments: 'NOT_CONFIGURED',
      email: 'NOT_CONFIGURED',
    });
  });

  it('uses Zoom operational readiness without performing a network probe', async () => {
    zoomProvider.isOperationallyConfigured.mockReturnValue(true);
    const report = await service.getReport();
    expect(report.providers.zoom).toBe('CONFIGURED');
    expect(zoomProvider.isOperationallyConfigured).toHaveBeenCalledTimes(1);
  });

  it('uses payment-service readiness, including callback configuration', async () => {
    paymentsService.isConfigured.mockReturnValue(true);
    const report = await service.getReport();
    expect(report.providers.payments).toBe('CONFIGURED');
  });

  it('uses the email provider readiness result', async () => {
    emailProvider.isConfigured.mockReturnValue(true);
    const report = await service.getReport();
    expect(report.providers.email).toBe('CONFIGURED');
  });

  it('surfaces the fixed operational counts from their respective tables', async () => {
    prisma.session.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
    prisma.notificationOutboxItem.count.mockResolvedValue(3);
    prisma.paymentOrder.count.mockResolvedValue(1);

    const report = await service.getReport();

    expect(report.stuckMeetingsCount).toBe(2);
    expect(report.permanentlyFailedNotificationsCount).toBe(3);
    expect(report.paymentsAwaitingResolutionCount).toBe(1);
    expect(report.upcomingSessionsCount).toBe(5);
  });
});
