import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

class ChannelMappingDto {
  @IsString() channelAccountId!: string;
  @IsString() @MinLength(1) externalProductId!: string;
  @IsString() @MinLength(1) externalSkuId!: string;
  @IsOptional() @IsString() externalSku?: string;
}

export class ReplaceMappingsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChannelMappingDto)
  mappings!: ChannelMappingDto[];
}
