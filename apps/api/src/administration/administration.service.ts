import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { PERMISSION_CATALOG } from './permissions.catalog';

@Injectable()
export class AdministrationService {
  constructor(private readonly prisma: PrismaService, private readonly passwords: PasswordService) {}

  listUsers(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true, email: true, displayName: true, active: true, roleAssignments: { include: { role: { select: { id: true, code: true, name: true, permissions: true } } } } },
      orderBy: { displayName: 'asc' },
    });
  }

  listRoles(organizationId: string) {
    return this.prisma.role.findMany({ where: { organizationId }, include: { _count: { select: { assignments: true } } }, orderBy: { name: 'asc' } });
  }

  async listScopes(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true, branches: { select: { id: true, name: true, warehouses: { select: { id: true, name: true, code: true } } } }, channels: { where: { active: true }, select: { id: true, name: true, code: true, type: true }, orderBy: { name: 'asc' } } },
    });
    return {
      ORGANIZATION: [{ id: organization.id, name: organization.name }],
      BRANCH: organization.branches.map((branch) => ({ id: branch.id, name: branch.name })),
      WAREHOUSE: organization.branches.flatMap((branch) => branch.warehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name, detail: `${branch.name} · ${warehouse.code}` }))),
      CHANNEL: organization.channels.map((channel) => ({ id: channel.id, name: channel.name, detail: `${channel.code} · ${channel.type}` })),
    };
  }

  async createUser(organizationId: string, actorId: string, input: CreateUserDto) {
    try {
      const created = await this.prisma.user.create({
        data: { organizationId, email: input.email.toLowerCase(), displayName: input.displayName, passwordHash: await this.passwords.hash(input.password) },
        select: { id: true, email: true, displayName: true, active: true },
      });
      await this.prisma.auditEvent.create({ data: { organizationId, actorId, category: 'ADMINISTRATION', action: 'USER_CREATED', entityType: 'USER', entityId: created.id, summary: `Tạo tài khoản nhân viên ${created.displayName}`, metadata: { email: created.email } } });
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Email đã tồn tại trong doanh nghiệp');
      throw error;
    }
  }

  async createRole(organizationId: string, actorId: string, input: CreateRoleDto) {
    const known = new Set<string>(PERMISSION_CATALOG.map((item) => item.code));
    const unknown = input.permissions.filter((permission) => permission !== '*' && !known.has(permission));
    if (unknown.length) throw new BadRequestException(`Quyền không hợp lệ: ${unknown.join(', ')}`);
    try {
      const created = await this.prisma.role.create({ data: { organizationId, code: input.code.toUpperCase(), name: input.name, permissions: input.permissions } });
      await this.prisma.auditEvent.create({ data: { organizationId, actorId, category: 'ADMINISTRATION', action: 'ROLE_CREATED', entityType: 'ROLE', entityId: created.id, summary: `Tạo vai trò ${created.name}`, metadata: { code: created.code, permissionCount: input.permissions.length } } });
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Mã vai trò đã tồn tại');
      throw error;
    }
  }

  async assignRole(organizationId: string, actorId: string, userId: string, input: AssignRoleDto) {
    const [user, role] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId, organizationId } }),
      this.prisma.role.findFirst({ where: { id: input.roleId, organizationId } }),
    ]);
    if (!user || !role) throw new NotFoundException('Không tìm thấy nhân viên hoặc vai trò');
    await this.validateScope(organizationId, input.scopeType, input.scopeId);
    const assignment = await this.prisma.userRoleAssignment.upsert({
      where: { userId_roleId_scopeType_scopeId: { userId, roleId: role.id, scopeType: input.scopeType, scopeId: input.scopeId } },
      update: {},
      create: { userId, roleId: role.id, scopeType: input.scopeType, scopeId: input.scopeId },
      include: { role: true },
    });
    await this.prisma.auditEvent.create({ data: { organizationId, actorId, category: 'ADMINISTRATION', action: 'ROLE_ASSIGNED', entityType: 'USER', entityId: user.id, summary: `Gán vai trò ${role.name} cho ${user.displayName}`, metadata: { scopeType: input.scopeType, scopeId: input.scopeId } } });
    return assignment;
  }

  async revokeRole(organizationId: string, actorId: string, userId: string, assignmentId: string) {
    const assignment = await this.prisma.userRoleAssignment.findFirst({ where: { id: assignmentId, userId, user: { organizationId } }, include: { user: true, role: true } });
    if (!assignment) throw new NotFoundException('Không tìm thấy lượt gán vai trò');
    const permissions = Array.isArray(assignment.role.permissions) ? assignment.role.permissions : [];
    if (actorId === userId && permissions.includes('*')) throw new BadRequestException('Không thể tự thu hồi quyền toàn quyền của tài khoản đang đăng nhập');
    await this.prisma.userRoleAssignment.delete({ where: { id: assignment.id } });
    await this.prisma.auditEvent.create({ data: { organizationId, actorId, category: 'ADMINISTRATION', action: 'ROLE_REVOKED', entityType: 'USER', entityId: userId, summary: `Thu hồi vai trò ${assignment.role.name} khỏi ${assignment.user.displayName}`, metadata: { scopeType: assignment.scopeType, scopeId: assignment.scopeId ?? '' } } });
    return { id: assignment.id, revoked: true };
  }

  async setActive(organizationId: string, userId: string, active: boolean, currentUserId: string) {
    if (userId === currentUserId && !active) throw new BadRequestException('Không thể tự vô hiệu hóa tài khoản đang đăng nhập');
    const result = await this.prisma.user.updateMany({ where: { id: userId, organizationId }, data: { active } });
    if (!result.count) throw new NotFoundException('Không tìm thấy nhân viên');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } });
    await this.prisma.auditEvent.create({ data: { organizationId, actorId: currentUserId, category: 'ADMINISTRATION', action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', entityType: 'USER', entityId: userId, summary: `${active ? 'Mở khóa' : 'Khóa'} tài khoản ${target?.displayName ?? target?.email ?? userId}` } });
    return { id: userId, active };
  }

  private async validateScope(organizationId: string, scopeType: string, scopeId: string) {
    let valid = false;
    if (scopeType === 'ORGANIZATION') valid = scopeId === organizationId;
    if (scopeType === 'BRANCH') valid = Boolean(await this.prisma.branch.findFirst({ where: { id: scopeId, organizationId } }));
    if (scopeType === 'WAREHOUSE') valid = Boolean(await this.prisma.warehouse.findFirst({ where: { id: scopeId, branch: { organizationId } } }));
    if (scopeType === 'CHANNEL') valid = Boolean(await this.prisma.salesChannelAccount.findFirst({ where: { id: scopeId, organizationId } }));
    if (!valid) throw new BadRequestException('Phạm vi dữ liệu không thuộc doanh nghiệp hiện tại');
  }
}
