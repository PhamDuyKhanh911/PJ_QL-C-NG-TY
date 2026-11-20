import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListAlertsDto {
  @IsOptional()
  @IsIn(['ALL', 'CRITICAL', 'WARNING', 'INFO'])
  severity = 'ALL';

  @IsOptional()
  @IsIn(['ALL', 'INVENTORY', 'RECONCILIATION', 'INTEGRATION', 'CONNECTION', 'RETURN'])
  type = 'ALL';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED'])
  status = 'ACTIVE';
}
