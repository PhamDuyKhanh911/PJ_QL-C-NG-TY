import { IsString } from 'class-validator';
export class CloseSaleDto { @IsString() orderId!: string; }
