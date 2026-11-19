import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateChannelConnectionDto {
  @IsOptional() @IsIn(['SANDBOX', 'PRODUCTION']) environment?: 'SANDBOX' | 'PRODUCTION';
  @IsOptional() @IsString() @MaxLength(300) clientId?: string;
  @IsOptional() @IsString() @MaxLength(300) accountIdentifier?: string;
  @IsOptional() @IsString() @MaxLength(500) apiBaseUrl?: string;
  @IsOptional() @IsString() @MinLength(8) clientSecret?: string;
  @IsOptional() @IsString() @MinLength(8) accessToken?: string;
  @IsOptional() @IsString() @MinLength(8) refreshToken?: string;
  @IsOptional() @IsString() @MinLength(8) webhookSecret?: string;
  @IsOptional() @IsBoolean() orderSyncEnabled?: boolean;
  @IsOptional() @IsBoolean() inventorySyncEnabled?: boolean;
  @IsOptional() @IsBoolean() chatSyncEnabled?: boolean;
}
