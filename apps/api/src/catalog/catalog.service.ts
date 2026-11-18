import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, search?: string) {
    return this.prisma.product.findMany({
      where: {
        organizationId,
        active: true,
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } }] } : {}),
      },
      include: { variants: { include: { balances: { include: { warehouse: true } } }, orderBy: { sku: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  create(organizationId: string, input: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        organizationId,
        name: input.name,
        variants: { create: input.variants },
      },
      include: { variants: true },
    });
  }
}

