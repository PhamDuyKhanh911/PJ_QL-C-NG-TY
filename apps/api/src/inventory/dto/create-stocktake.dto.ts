import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStocktakeDto {
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
