import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AfterSalesService } from './after-sales.service';
import { resolveDataScope } from '../auth/data-scope';
import { CreateAfterSaleDto } from './dto/create-after-sale.dto';
import { ResolveAfterSaleDto } from './dto/resolve-after-sale.dto';
@Controller('after-sales') @UseGuards(JwtAuthGuard, PermissionsGuard)
export class AfterSalesController {
  constructor(private readonly service: AfterSalesService) {}
  @Get() @RequirePermissions('after_sales.read') list(@CurrentUser() user: AuthenticatedUser,@Query('status') status?:string){return this.service.list(user.organizationId,status,resolveDataScope(user,'after_sales.read'))}
  @Post() @RequirePermissions('after_sales.manage') create(@CurrentUser() user:AuthenticatedUser,@Body() input:CreateAfterSaleDto){return this.service.create(user.organizationId,input,resolveDataScope(user,'after_sales.manage'))}
  @Post(':id/resolve') @RequirePermissions('after_sales.manage') resolve(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string,@Body() input:ResolveAfterSaleDto){return this.service.resolve(user.organizationId,id,user.id,input,resolveDataScope(user,'after_sales.manage'))}
  @Post(':id/receive') @RequirePermissions('after_sales.receive') receive(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string,@Body('note') note?:string){return this.service.receive(user.organizationId,id,user.id,note,resolveDataScope(user,'after_sales.receive'))}
  @Post(':id/mark-lost') @RequirePermissions('after_sales.manage') markLost(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string,@Body('note') note?:string){return this.service.markLost(user.organizationId,id,note,resolveDataScope(user,'after_sales.manage'))}
}
