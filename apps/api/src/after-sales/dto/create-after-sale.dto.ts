import { AfterSaleType } from '@prisma/client';
import { IsEnum, IsInt, IsString, Min, MinLength } from 'class-validator';
export class CreateAfterSaleDto {
  @IsString() orderId!: string;
  @IsString() variantId!: string;
  @IsEnum(AfterSaleType) type!: AfterSaleType;
  @IsInt() @Min(1) quantity!: number;
  @IsString() @MinLength(3) reasonCode!: string;
  @IsString() @MinLength(3) responsibleParty!: string;
}
