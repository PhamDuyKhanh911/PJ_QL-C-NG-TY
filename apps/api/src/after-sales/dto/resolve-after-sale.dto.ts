import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
export class ResolveAfterSaleDto {
  @IsBoolean() approved!: boolean;
  @IsOptional() @IsString() @MinLength(3) note?: string;
}
