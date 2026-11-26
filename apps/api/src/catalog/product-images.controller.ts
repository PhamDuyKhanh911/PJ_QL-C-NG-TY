import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Controller('product-images')
export class ProductImagesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':productId')
  async get(@Param('productId') productId: string, @Res() response: Response) {
    const image = await this.prisma.productImage.findUnique({ where: { productId } });
    if (!image) throw new NotFoundException('Không tìm thấy hình ảnh sản phẩm');
    response
      .set({
        'Content-Type': image.mimeType,
        'Content-Length': String(image.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
      })
      .send(Buffer.from(image.data));
  }
}
