import { IsString, MinLength } from 'class-validator';

export class CancelOrderDto {
  @IsString() @MinLength(3) reasonCode!: string;
  @IsString() @MinLength(3) responsibleParty!: string;
}

