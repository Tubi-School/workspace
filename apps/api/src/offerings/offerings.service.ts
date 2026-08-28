import { Injectable, NotFoundException } from '@nestjs/common';

import type { Offering } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Read-only ADMIN access to the sellable Offering catalog (Phase 3
 * external review, Correction 3). Closes the one gap the Phase 3 review
 * disclosed honestly: SubscriptionAccess grants reference an offeringId,
 * but nothing let an ADMIN discover which Offerings exist to grant.
 *
 * Deliberately minimal — no create/update/delete here. Offering rows are
 * not currently created through any API in this codebase (they predate
 * this milestone); adding full Offering administration, pricing-engine
 * work, or payment/billing logic is explicitly out of scope for this
 * correction, which asks only for "the smallest backend capability needed
 * to close the gap."
 */
@Injectable()
export class OfferingsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Offering[]> {
    return this.prisma.offering.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<Offering> {
    const offering = await this.prisma.offering.findUnique({ where: { id } });

    if (!offering) {
      throw new NotFoundException(`Offering ${id} not found`);
    }

    return offering;
  }
}
