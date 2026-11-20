import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAlertStatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED'])
  status!: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
