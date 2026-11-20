import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListActivityDto {
  @IsOptional() @IsIn(['ALL', 'INVENTORY', 'FULFILLMENT', 'CHANNEL', 'PURCHASING', 'ADMINISTRATION', 'BACKUP']) category = 'ALL';
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(300) limit = 100;
}
