import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

class CreateOrderItemDto {
  @IsString() variantId!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class CreateOrderDto {
  @IsString() channelAccountId!: string;
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() @MinLength(2) customerName?: string;
  @IsOptional() @IsString() @MinLength(2) recipientName?: string;
  @IsOptional() @IsString() @MinLength(8) recipientPhone?: string;
  @IsOptional() @IsString() @MinLength(3) recipientAddress?: string;
  @IsOptional() @IsString() recipientNote?: string;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @IsNumber() @Min(0) discount = 0;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
