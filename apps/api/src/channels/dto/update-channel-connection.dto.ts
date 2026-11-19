import { IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateChannelConnectionDto {
  @IsOptional() @IsIn(['SANDBOX', 'PRODUCTION']) environment?: 'SANDBOX' | 'PRODUCTION';
  @IsOptional() @IsString() @MaxLength(300) clientId?: string;
  @IsOptional() @IsString() @MaxLength(500) authorizationIdentifier?: string;
  @IsOptional() @IsString() @MaxLength(300) accountIdentifier?: string;
  @IsOptional() @IsString() @MaxLength(500) apiBaseUrl?: string;
  @IsOptional() @IsString() @MinLength(8) clientSecret?: string;
  @IsOptional() @IsString() @MinLength(8) accessToken?: string;
  @IsOptional() @IsString() @MinLength(8) refreshToken?: string;
  @IsOptional() @IsISO8601() accessTokenExpiresAt?: string;
  @IsOptional() @IsISO8601() refreshTokenExpiresAt?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) grantedScopes?: string[];
  @IsOptional() @IsString() @MinLength(8) webhookSecret?: string;
  @IsOptional() @IsBoolean() orderSyncEnabled?: boolean;
  @IsOptional() @IsBoolean() inventorySyncEnabled?: boolean;
  @IsOptional() @IsBoolean() chatSyncEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(100) defaultWarehouseId?: string;
}
