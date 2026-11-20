import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
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
  @Get('permissions') @RequirePermissions('users.read') permissions() { return PERMISSION_CATALOG; }
  @Get('users') @RequirePermissions('users.read') users(@CurrentUser() user: AuthenticatedUser) { return this.administration.listUsers(user.organizationId); }
  @Post('users') @RequirePermissions('users.manage') createUser(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateUserDto) { return this.administration.createUser(user.organizationId, user.id, input); }
  @Patch('users/:id/status') @RequirePermissions('users.manage') setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateUserStatusDto) { return this.administration.setActive(user.organizationId, id, input.active, user.id); }
  @Get('roles') @RequirePermissions('users.read') roles(@CurrentUser() user: AuthenticatedUser) { return this.administration.listRoles(user.organizationId); }
  @Post('roles') @RequirePermissions('roles.manage') createRole(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateRoleDto) { return this.administration.createRole(user.organizationId, user.id, input); }
  @Post('users/:id/roles') @RequirePermissions('users.manage') assignRole(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: AssignRoleDto) { return this.administration.assignRole(user.organizationId, user.id, id, input); }
}
