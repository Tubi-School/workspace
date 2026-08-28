import { NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service.js';
import { OfferingsService } from './offerings.service.js';

describe('OfferingsService', () => {
  let prisma: { offering: { findMany: jest.Mock; findUnique: jest.Mock } };
  let service: OfferingsService;

  beforeEach(() => {
    prisma = { offering: { findMany: jest.fn(), findUnique: jest.fn() } };
    service = new OfferingsService(prisma as unknown as PrismaService);
  });

  it('lists offerings ordered by name', async () => {
    prisma.offering.findMany.mockResolvedValue([{ id: '1', name: 'Live Math' }]);

    await expect(service.findAll()).resolves.toEqual([{ id: '1', name: 'Live Math' }]);
    expect(prisma.offering.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('returns one offering by id', async () => {
    prisma.offering.findUnique.mockResolvedValue({ id: '1', name: 'Live Math' });

    await expect(service.findOne('1')).resolves.toEqual({ id: '1', name: 'Live Math' });
  });

  it('rejects with 404 for a nonexistent offering', async () => {
    prisma.offering.findUnique.mockResolvedValue(null);

    await expect(service.findOne('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});
