import { IsOptional, IsString, MinLength } from 'class-validator';

export class ResolveChannelMappingDto {
  @IsString() @MinLength(1)
  reconciliationId!: string;

  @IsString() @MinLength(1)
  variantId!: string;

  @IsOptional() @IsString()
  externalProductId?: string;
}
