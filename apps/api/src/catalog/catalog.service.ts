import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelSyncStatus, ChannelType, Prisma } from '@prisma/client';
import { queueInventorySync } from '../channels/queue-inventory-sync';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, CreateVariantDto } from './dto/create-product.dto';
import { ReplaceMappingsDto } from './dto/replace-mappings.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, search?: string, includeInactive = false) {
    return this.prisma.product.findMany({
      where: {
        organizationId,
        ...(!includeInactive ? { active: true } : {}),
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { variants: { some: { sku: { contains: search, mode: 'insensitive' as const } } } }] } : {}),
      },
      include: {
        variants: {
          include: {
            balances: { include: { warehouse: true } },
            mappings: { include: { channelAccount: { select: { id: true, code: true, name: true, type: true, active: true } } }, orderBy: { channelAccount: { name: 'asc' } } },
          },
          orderBy: { sku: 'asc' },
        },
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  channels(organizationId: string) {
    return this.prisma.salesChannelAccount.findMany({
      where: { organizationId, active: true },
      select: { id: true, code: true, name: true, type: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async create(organizationId: string, input: CreateProductDto) {
    this.validateUniqueSkus(input.variants.map((variant) => variant.sku));
    try {
      return await this.prisma.product.create({
        data: {
          organizationId,
          name: input.name.trim(),
          variants: { create: input.variants.map((variant) => this.variantData(variant)) },
        },
        include: { variants: true },
      });
    } catch (error) {
      this.handleUniqueConflict(error);
    }
  }

  async updateProduct(organizationId: string, userId: string, productId: string, input: UpdateProductDto) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId }, include: { variants: { select: { id: true } } } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: product.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      if (input.active !== undefined && input.active !== product.active) {
        await queueInventorySync(tx, product.variants.map((variant) => variant.id), userId, input.active ? 'PRODUCT_REACTIVATED' : 'PRODUCT_DEACTIVATED');
      }
      return updated;
    });
  }

  async createVariant(organizationId: string, productId: string, input: CreateVariantDto) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
    try {
      return await this.prisma.productVariant.create({ data: { productId: product.id, ...this.variantData(input) } });
    } catch (error) {
      this.handleUniqueConflict(error);
    }
  }

  async updateVariant(organizationId: string, userId: string, variantId: string, input: UpdateVariantDto) {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, product: { organizationId } } });
    if (!variant) throw new NotFoundException('Không tìm thấy SKU');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.productVariant.update({
          where: { id: variant.id },
          data: {
            ...(input.sku !== undefined ? { sku: input.sku.trim().toUpperCase() } : {}),
            ...(input.barcode !== undefined ? { barcode: input.barcode.trim() || null } : {}),
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
            ...(input.salePrice !== undefined ? { salePrice: input.salePrice } : {}),
          },
        });
        if (input.sku !== undefined && updated.sku !== variant.sku) await queueInventorySync(tx, [variant.id], userId, 'INTERNAL_SKU_UPDATED');
        return updated;
      });
    } catch (error) {
      this.handleUniqueConflict(error);
    }
  }

  async replaceMappings(organizationId: string, userId: string, variantId: string, input: ReplaceMappingsDto) {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, product: { organizationId } } });
    if (!variant) throw new NotFoundException('Không tìm thấy SKU');
    const channelIds = input.mappings.map((mapping) => mapping.channelAccountId);
    if (new Set(channelIds).size !== channelIds.length) throw new BadRequestException('Một seller chỉ được ánh xạ một lần cho mỗi SKU');
    const channels = await this.prisma.salesChannelAccount.findMany({ where: { organizationId, id: { in: channelIds }, active: true, type: { not: ChannelType.OFFLINE_STORE } }, select: { id: true } });
    if (channels.length !== channelIds.length) throw new BadRequestException('Có seller không tồn tại hoặc đã ngừng hoạt động');
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.channelSkuMapping.findMany({ where: { variantId: variant.id, channelAccount: { organizationId, active: true, type: { not: ChannelType.OFFLINE_STORE } } } });
        const incomingByChannel = new Map(input.mappings.map((mapping) => [mapping.channelAccountId, mapping]));
        const removedOrChanged = existing.filter((mapping) => {
          const incoming = incomingByChannel.get(mapping.channelAccountId);
          return !incoming || incoming.externalSkuId.trim() !== mapping.externalSkuId;
        });
        for (const mapping of removedOrChanged) await tx.channelSyncRun.create({
          data: {
            channelAccountId: mapping.channelAccountId,
            status: ChannelSyncStatus.RUNNING,
            direction: 'AUTO_SKU_MAPPING_REMOVED',
            mappedSkuCount: 1,
            snapshot: [{ sku: variant.sku, externalProductId: mapping.externalProductId, externalSkuId: mapping.externalSkuId, available: 0, trigger: 'SKU_MAPPING_REMOVED' }],
            triggeredById: userId,
          },
        });
        await tx.channelSkuMapping.deleteMany({ where: { variantId: variant.id, channelAccount: { organizationId, active: true, type: { not: ChannelType.OFFLINE_STORE } } } });
        if (input.mappings.length) await tx.channelSkuMapping.createMany({
          data: input.mappings.map((mapping) => ({
            variantId: variant.id,
            channelAccountId: mapping.channelAccountId,
            externalProductId: mapping.externalProductId.trim(),
            externalSkuId: mapping.externalSkuId.trim(),
            externalSku: mapping.externalSku?.trim() || variant.sku,
          })),
        });
        await queueInventorySync(tx, [variant.id], userId, 'SKU_MAPPING_UPDATED');
      });
      return this.prisma.productVariant.findUnique({
        where: { id: variant.id },
        include: { mappings: { include: { channelAccount: { select: { id: true, code: true, name: true, type: true } } } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Mã SKU ngoài đã được dùng trong seller này');
      throw error;
    }
  }

  private variantData(input: CreateVariantDto) {
    return {
      sku: input.sku.trim().toUpperCase(),
      barcode: input.barcode?.trim() || null,
      name: input.name.trim(),
      costPrice: input.costPrice,
      salePrice: input.salePrice,
    };
  }

  private validateUniqueSkus(skus: string[]) {
    const normalized = skus.map((sku) => sku.trim().toUpperCase());
    if (new Set(normalized).size !== normalized.length) throw new BadRequestException('Danh sách biến thể có SKU trùng nhau');
  }

  private handleUniqueConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('SKU hoặc mã vạch đã tồn tại');
    throw error;
  }
}
