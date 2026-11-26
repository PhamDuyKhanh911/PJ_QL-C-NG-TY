import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { InventoryReceiptSource } from '@prisma/client';
export class CreateInventoryReceiptItemDto { @IsString() variantId!: string; @IsInt() @Min(1) quantity!: number; @IsOptional() @IsBoolean() quarantined?: boolean; }
export class CreateInventoryReceiptDto { @IsString() warehouseId!: string; @IsEnum(InventoryReceiptSource) source!: InventoryReceiptSource; @IsOptional() @IsString() sourceReferenceId?: string; @IsOptional() @IsString() @MaxLength(250) note?: string; @IsArray() @ValidateNested({ each: true }) @Type(() => CreateInventoryReceiptItemDto) items!: CreateInventoryReceiptItemDto[]; }
