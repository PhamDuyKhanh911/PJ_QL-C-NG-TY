import { IsInt, IsOptional, IsString, MinLength, NotEquals } from 'class-validator';

export class AdjustInventoryDto {
  @IsString() warehouseId!: string;
  @IsString() variantId!: string;
  @IsInt() @NotEquals(0) quantity!: number;
  @IsString() @MinLength(3) reason!: string;
  @IsOptional() @IsString() referenceId?: string;
}

