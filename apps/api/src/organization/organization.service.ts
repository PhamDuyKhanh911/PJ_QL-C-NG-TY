import { Injectable } from '@nestjs/common';
import { channelScopeWhere, type DataScope, warehouseScopeWhere } from '../auth/data-scope';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}
  async getOverview(organizationId: string, scope: DataScope) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        branches: {
          where: scope.organization ? {} : { OR: [{ id: { in: scope.branchIds } }, { warehouses: { some: { id: { in: scope.warehouseIds } } } }] },
          include: { warehouses: { where: warehouseScopeWhere(organizationId, scope) } },
        },
        channels: { where: channelScopeWhere(organizationId, scope), orderBy: { name: 'asc' } },
        _count: { select: { users: true, products: true, customers: true } },
      },
    });
    if (!scope.organization) organization._count = { users: 0, products: 0, customers: 0 };
    return organization;
  }
}
