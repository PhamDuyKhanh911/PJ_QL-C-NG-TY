import { IsString } from 'class-validator';

export class SelectFacebookPageDto {
  @IsString()
  sessionId!: string;

  @IsString()
  pageId!: string;
}
