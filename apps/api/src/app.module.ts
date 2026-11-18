import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { OrganizationModule } from './organization/organization.module';
import { PrismaModule } from './prisma/prisma.module';

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
  ],
  controllers: [HealthController],
})
export class AppModule {}
