import { IsIn, IsString } from 'class-validator';

export class AssignRoleDto {
  @IsString() roleId!: string;
  @IsIn(['ORGANIZATION', 'BRANCH', 'WAREHOUSE', 'CHANNEL']) scopeType!: string;
  @IsString() scopeId!: string;
}

