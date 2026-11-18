import { ArrayMinSize, IsArray, IsString } from 'class-validator';
export class BatchDispatchDto {
  @IsString() channelAccountId!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) orderIds!: string[];
}
