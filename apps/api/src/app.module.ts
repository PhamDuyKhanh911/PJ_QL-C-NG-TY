import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { HealthController } from './health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { OrganizationModule } from './organization/organization.module';
import { PrismaModule } from './prisma/prisma.module';
import { SalesModule } from './sales/sales.module';
import { AdministrationModule } from './administration/administration.module';
import { ConversationsModule } from './conversations/conversations.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CustomersModule } from './customers/customers.module';
import { ChannelsModule } from './channels/channels.module';
import { AfterSalesModule } from './after-sales/after-sales.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'local-development-secret-change-me',
      signOptions: { expiresIn: '8h' },
    }),
    AuthModule,
    OrganizationModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
    AdministrationModule,
    ConversationsModule,
    DashboardModule,
    CustomersModule,
    ChannelsModule,
    AfterSalesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
