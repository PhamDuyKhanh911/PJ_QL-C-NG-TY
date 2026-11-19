import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateVariantDto {
  @IsOptional() @IsString() @MinLength(2) sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsNumber() @Min(0) salePrice?: number;
}
