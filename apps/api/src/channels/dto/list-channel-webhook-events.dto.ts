import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListChannelWebhookEventsDto {
  @IsOptional() @IsString() channelAccountId?: string;
  @IsOptional() @IsIn(['ALL', 'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED']) status = 'ALL';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
