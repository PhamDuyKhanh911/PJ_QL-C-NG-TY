import { IsEnum, IsInt, IsString, Min, MinLength } from 'class-validator';
export enum QuarantineDecision { RELEASE = 'RELEASE', WRITE_OFF = 'WRITE_OFF' }
export class InspectQuarantineDto {
  @IsString() balanceId!: string;
  @IsEnum(QuarantineDecision) decision!: QuarantineDecision;
  @IsInt() @Min(1) quantity!: number;
  @IsString() @MinLength(3) reason!: string;
}
