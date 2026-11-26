import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogController } from './catalog.controller';
import { ProductImagesController } from './product-images.controller';
import { CatalogService } from './catalog.service';

@Module({ imports: [AuthModule], controllers: [CatalogController, ProductImagesController], providers: [CatalogService] })
export class CatalogModule {}
