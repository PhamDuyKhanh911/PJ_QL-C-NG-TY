import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { assertOrganizationScope, resolveDataScope } from '../auth/data-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AdministrationService } from './administration.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { PERMISSION_CATALOG } from './permissions.catalog';

@Controller('administration')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}
  @Get('permissions') @RequirePermissions('users.read') permissions(@CurrentUser() user: AuthenticatedUser) { this.assertAccess(user, 'users.read'); return PERMISSION_CATALOG; }
  @Get('scopes') @RequirePermissions('users.read') scopes(@CurrentUser() user: AuthenticatedUser) { this.assertAccess(user, 'users.read'); return this.administration.listScopes(user.organizationId); }
  @Get('users') @RequirePermissions('users.read') users(@CurrentUser() user: AuthenticatedUser) { this.assertAccess(user, 'users.read'); return this.administration.listUsers(user.organizationId); }
  @Post('users') @RequirePermissions('users.manage') createUser(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateUserDto) { this.assertAccess(user, 'users.manage'); return this.administration.createUser(user.organizationId, user.id, input); }
  @Patch('users/:id/status') @RequirePermissions('users.manage') setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateUserStatusDto) { this.assertAccess(user, 'users.manage'); return this.administration.setActive(user.organizationId, id, input.active, user.id); }
  @Get('roles') @RequirePermissions('users.read') roles(@CurrentUser() user: AuthenticatedUser) { this.assertAccess(user, 'users.read'); return this.administration.listRoles(user.organizationId); }
  @Post('roles') @RequirePermissions('roles.manage') createRole(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateRoleDto) { this.assertAccess(user, 'roles.manage'); return this.administration.createRole(user.organizationId, user.id, input); }
  @Post('users/:id/roles') @RequirePermissions('users.manage') assignRole(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: AssignRoleDto) { this.assertAccess(user, 'users.manage'); return this.administration.assignRole(user.organizationId, user.id, id, input); }
  @Delete('users/:id/roles/:assignmentId') @RequirePermissions('users.manage') revokeRole(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('assignmentId') assignmentId: string) { this.assertAccess(user, 'users.manage'); return this.administration.revokeRole(user.organizationId, user.id, id, assignmentId); }

  private assertAccess(user: AuthenticatedUser, permission: string) { assertOrganizationScope(resolveDataScope(user, permission)); }
}
