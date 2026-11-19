import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CatalogService } from './catalog.service';
import { CreateProductDto, CreateVariantDto } from './dto/create-product.dto';
import { ListProductsDto } from './dto/list-products.dto';
import { ReplaceMappingsDto } from './dto/replace-mappings.dto';
import { ResolveChannelMappingDto } from './dto/resolve-channel-mapping.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Controller('catalog')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products') @RequirePermissions('catalog.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListProductsDto) {
    return this.catalog.list(user.organizationId, query.search, query.includeInactive);
  }

  @Get('channels') @RequirePermissions('catalog.read')
  channels(@CurrentUser() user: AuthenticatedUser) { return this.catalog.channels(user.organizationId); }

  @Get('unmapped-channel-skus') @RequirePermissions('catalog.read')
  unmappedChannelSkus(@CurrentUser() user: AuthenticatedUser) { return this.catalog.unmappedChannelSkus(user.organizationId); }

  @Post('channel-mappings/resolve') @RequirePermissions('catalog.manage')
  resolveChannelMapping(@CurrentUser() user: AuthenticatedUser, @Body() input: ResolveChannelMappingDto) {
    return this.catalog.resolveChannelMapping(user.organizationId, user.id, input);
  }

  @Post('products') @RequirePermissions('catalog.create')
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateProductDto) {
    return this.catalog.create(user.organizationId, input);
  }

  @Patch('products/:id') @RequirePermissions('catalog.manage')
  updateProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateProductDto) {
    return this.catalog.updateProduct(user.organizationId, user.id, id, input);
  }

  @Post('products/:id/variants') @RequirePermissions('catalog.manage')
  createVariant(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CreateVariantDto) {
    return this.catalog.createVariant(user.organizationId, id, input);
  }

  @Patch('variants/:id') @RequirePermissions('catalog.manage')
  updateVariant(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateVariantDto) {
    return this.catalog.updateVariant(user.organizationId, user.id, id, input);
  }

  @Put('variants/:id/mappings') @RequirePermissions('catalog.manage')
  replaceMappings(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ReplaceMappingsDto) {
    return this.catalog.replaceMappings(user.organizationId, user.id, id, input);
  }
}
