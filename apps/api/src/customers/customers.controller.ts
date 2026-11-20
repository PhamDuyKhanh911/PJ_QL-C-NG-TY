import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CustomersService } from './customers.service';
import { ListCustomersDto } from './dto/list-customers.dto';
import { resolveDataScope } from '../auth/data-scope';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('customers.read')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCustomersDto) { return this.customers.list(user.organizationId, query, resolveDataScope(user, 'customers.read')); }
  @Get(':id') detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.customers.detail(user.organizationId, id, resolveDataScope(user, 'customers.read')); }
}
