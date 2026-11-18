import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}
  getOverview(organizationId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        branches: { include: { warehouses: true } },
        channels: { orderBy: { name: 'asc' } },
        _count: { select: { users: true, products: true, customers: true } },
      },
    });
  }
}

