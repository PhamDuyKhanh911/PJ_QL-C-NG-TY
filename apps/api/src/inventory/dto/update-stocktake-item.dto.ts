import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateStocktakeItemDto {
  @IsInt()
  @Min(0)
  countedQuantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
