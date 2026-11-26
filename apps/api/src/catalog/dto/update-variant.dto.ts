import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateVariantDto {
  @IsOptional() @IsString() @MinLength(2) sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MaxLength(50) size?: string;
  @IsOptional() @IsString() @MaxLength(80) color?: string;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsNumber() @Min(0) salePrice?: number;
}
