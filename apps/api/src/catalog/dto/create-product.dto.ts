import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class CreateVariantDto {
  @IsString() @MinLength(2) sku!: string;
  @IsOptional() @IsString() barcode?: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() @MaxLength(50) size?: string;
  @IsOptional() @IsString() @MaxLength(80) color?: string;
  @IsNumber() @Min(0) costPrice!: number;
  @IsNumber() @Min(0) salePrice!: number;
}

export class CreateProductDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateVariantDto)
  variants!: CreateVariantDto[];
}
