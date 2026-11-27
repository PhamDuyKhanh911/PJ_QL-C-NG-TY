import { ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStocktakeDto {
  @IsString()
  warehouseId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  variantIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
