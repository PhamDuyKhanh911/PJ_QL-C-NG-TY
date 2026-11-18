import { IsOptional, IsString, MinLength } from 'class-validator';

export class FulfillmentActionDto {
  @IsOptional() @IsString() @MinLength(2) note?: string;
  @IsOptional() @IsString() @MinLength(2) carrierName?: string;
  @IsOptional() @IsString() @MinLength(2) trackingCode?: string;
}
