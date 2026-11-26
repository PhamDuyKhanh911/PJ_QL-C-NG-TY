import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class InitializeInventoryDto {
  @IsString() warehouseId!: string;
  @IsString() variantId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() @MaxLength(250) note?: string;
}
