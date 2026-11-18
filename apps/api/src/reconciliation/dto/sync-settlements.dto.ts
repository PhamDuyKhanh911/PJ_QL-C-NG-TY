import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
class SettlementEntryDto {
  @IsString() orderNumber!: string;
  @IsOptional() @IsString() externalSettlementId?: string;
  @IsNumber() @Min(0) grossAmount!: number;
  @IsOptional() @IsNumber() @Min(0) platformFee = 0;
  @IsOptional() @IsNumber() @Min(0) shippingFee = 0;
  @IsOptional() @IsNumber() @Min(0) refundAmount = 0;
  @IsOptional() @IsNumber() @Min(0) otherFee = 0;
  @IsNumber() @Min(0) paidAmount!: number;
  @IsOptional() @IsDateString() settledAt?: string;
}
export class SyncSettlementsDto {
  @IsString() channelAccountId!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SettlementEntryDto) entries!: SettlementEntryDto[];
}
