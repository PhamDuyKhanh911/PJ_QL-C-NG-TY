import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from './auth.types';

export type DataScope = {
  organization: boolean;
  branchIds: string[];
  warehouseIds: string[];
  channelIds: string[];
};

export function resolveDataScope(user: AuthenticatedUser, permission: string): DataScope {
  const assignments = user.roleScopes.filter((item) => item.permissions.includes('*') || item.permissions.includes(permission));
  const ids = (type: string) => [...new Set(assignments.filter((item) => item.type === type && item.id).map((item) => item.id!))];
  return {
    organization: assignments.some((item) => item.type === 'ORGANIZATION' && item.id === user.organizationId),
    branchIds: ids('BRANCH'),
    warehouseIds: ids('WAREHOUSE'),
    channelIds: ids('CHANNEL'),
  };
}

export function warehouseScopeWhere(organizationId: string, scope: DataScope): Prisma.WarehouseWhereInput {
  const organization = { branch: { organizationId } };
  if (scope.organization) return organization;
  const OR: Prisma.WarehouseWhereInput[] = [];
  if (scope.branchIds.length) OR.push({ branchId: { in: scope.branchIds } });
  if (scope.warehouseIds.length) OR.push({ id: { in: scope.warehouseIds } });
  return { ...organization, ...(OR.length ? { OR } : { id: '__NO_WAREHOUSE_SCOPE__' }) };
}

export function channelScopeWhere(organizationId: string, scope: DataScope): Prisma.SalesChannelAccountWhereInput {
  if (scope.organization) return { organizationId };
  return { organizationId, id: scope.channelIds.length ? { in: scope.channelIds } : '__NO_CHANNEL_SCOPE__' };
}

export function orderScopeWhere(organizationId: string, scope: DataScope): Prisma.SalesOrderWhereInput {
  const organization = { channelAccount: { organizationId } };
  if (scope.organization) return organization;
  const OR: Prisma.SalesOrderWhereInput[] = [];
  if (scope.channelIds.length) OR.push({ channelAccountId: { in: scope.channelIds } });
  if (scope.warehouseIds.length) OR.push({ warehouseId: { in: scope.warehouseIds } });
  if (scope.branchIds.length) OR.push({ warehouse: { branchId: { in: scope.branchIds } } });
  return { ...organization, ...(OR.length ? { OR } : { id: '__NO_ORDER_SCOPE__' }) };
}

export function assertChannelScope(scope: DataScope, channelId: string) {
  if (!scope.organization && !scope.channelIds.includes(channelId)) throw new ForbiddenException('Bạn không được phân quyền cho seller này');
}

export function assertOrganizationScope(scope: DataScope) {
  if (!scope.organization) throw new ForbiddenException('Thao tác này yêu cầu phạm vi toàn công ty');
}
