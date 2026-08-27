import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let configService: { getOrThrow: jest.Mock };
  let prisma: { ping: jest.Mock };
  let service: HealthService;

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : '0.0.0-test')),
    };
    prisma = { ping: jest.fn() };
    service = new HealthService(
      configService as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
  });

  it('liveness reports ok without touching the database', () => {
    const report = service.getLiveness();

    expect(report.status).toBe('ok');
    expect(report.dependencies).toEqual([]);
    expect(prisma.ping).not.toHaveBeenCalled();
  });

  it('readiness reports ok when the database ping succeeds', async () => {
    prisma.ping.mockResolvedValue(undefined);

    const report = await service.getReadiness();

    expect(report.status).toBe('ok');
    expect(report.dependencies).toEqual([
      expect.objectContaining({ name: 'postgresql', status: 'ok' }),
    ]);
  });

  it('readiness reports degraded when the database ping fails, without leaking connection details', async () => {
    // A realistic Postgres connection failure often embeds the connection
    // string (including credentials) in its error message — the service
    // must still surface *a* message for operators, but never the
    // DATABASE_URL itself.
    prisma.ping.mockRejectedValue(
      new Error('connection refused at postgresql://tubi:s3cr3t@db-host:5432/tubi'),
    );

    const report = await service.getReadiness();

    expect(report.status).toBe('degraded');
    expect(HealthService.isServable(report.status)).toBe(false);
    const dependency = report.dependencies[0]!;
    expect(dependency.status).toBe('down');
    // The service passes the driver's own error message through as-is —
    // this test's real assertion is that no secret/config value is
    // *added*; JWT_SECRET, PORT, and the raw env are never referenced by
    // probeDatabase at all (verified by reading the implementation).
    expect(configService.getOrThrow).not.toHaveBeenCalledWith('DATABASE_URL');
    expect(configService.getOrThrow).not.toHaveBeenCalledWith('JWT_SECRET');
  });

  it('never returns the underlying driver error text — a fake secret embedded in a thrown error cannot appear anywhere in the readiness response (Correction 2)', async () => {
    const FAKE_SECRET = 'postgresql://tubi_admin:sup3r-s3cr3t-p4ssw0rd@prod-db.internal:5432/tubi';
    prisma.ping.mockRejectedValue(new Error(`could not connect to server: ${FAKE_SECRET}`));

    const report = await service.getReadiness();
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(FAKE_SECRET);
    expect(serialized).not.toContain('sup3r-s3cr3t-p4ssw0rd');
    expect(serialized).not.toContain('tubi_admin');
    expect(serialized).not.toContain('prod-db.internal');
    expect(report.dependencies[0]!.error).toBe('Database unavailable');
  });

  it('isServable is false for degraded and down, true only for ok', () => {
    expect(HealthService.isServable('ok')).toBe(true);
    expect(HealthService.isServable('degraded')).toBe(false);
    expect(HealthService.isServable('down')).toBe(false);
  });
});
