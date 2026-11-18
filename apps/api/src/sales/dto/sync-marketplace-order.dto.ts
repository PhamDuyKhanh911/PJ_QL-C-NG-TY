import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
class SyncMarketplaceOrderItemDto { @IsString() externalSkuId!: string; @IsInt() @Min(1) quantity!: number; }
export class SyncMarketplaceOrderDto {
  @IsString() channelAccountId!: string;
  @IsString() externalOrderId!: string;
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() customerName?: string;
  @IsDateString() orderedAt!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SyncMarketplaceOrderItemDto) items!: SyncMarketplaceOrderItemDto[];
}
