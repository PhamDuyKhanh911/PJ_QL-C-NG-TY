import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CatalogService } from './catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsDto } from './dto/list-products.dto';

@Controller('catalog/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get() @RequirePermissions('catalog.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListProductsDto) { return this.catalog.list(user.organizationId, query.search); }
  @Post() @RequirePermissions('catalog.create')
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateProductDto) { return this.catalog.create(user.organizationId, input); }
}

