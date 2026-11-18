import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

class CreateVariantDto {
  @IsString() @MinLength(2) sku!: string;
  @IsOptional() @IsString() barcode?: string;
  @IsString() @MinLength(1) name!: string;
  @IsNumber() @Min(0) costPrice!: number;
  @IsNumber() @Min(0) salePrice!: number;
}

export class CreateProductDto {
  @IsString() @MinLength(2) name!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateVariantDto)
  variants!: CreateVariantDto[];
}

