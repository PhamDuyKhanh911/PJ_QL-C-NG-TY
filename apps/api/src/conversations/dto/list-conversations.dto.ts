import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListConversationsDto {
  @IsOptional() @IsString() channelAccountId?: string;
  @IsOptional() @IsIn(['ALL', 'OPEN', 'UNREAD', 'UNREPLIED', 'REPLIED', 'ARCHIVED']) status = 'ALL';
  @IsOptional() @IsString() search?: string;
}

