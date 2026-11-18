import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ReceivePurchaseOrderItemDto {
  @IsString() itemId!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class ReceivePurchaseOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReceivePurchaseOrderItemDto)
  items!: ReceivePurchaseOrderItemDto[];
  @IsOptional() @IsString() note?: string;
}
