import { Module } from '@nestjs/common';import { AuthModule } from '../auth/auth.module';import { AfterSalesController } from './after-sales.controller';import { AfterSalesService } from './after-sales.service';
@Module({imports:[AuthModule],controllers:[AfterSalesController],providers:[AfterSalesService]}) export class AfterSalesModule{}
