import { Controller, Get, Param, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { assertOrganizationScope, resolveDataScope } from '../auth/data-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { BackupsService } from './backups.service';

@Controller('backups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('backups.manage')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { this.assertAccess(user); return this.backups.list(); }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser) { this.assertAccess(user); return this.backups.create(user.organizationId, user.id); }

  @Post(':fileName/verify')
  verify(@CurrentUser() user: AuthenticatedUser, @Param('fileName') fileName: string) { this.assertAccess(user); return this.backups.verify(fileName); }

  @Get(':fileName/download')
  async download(@CurrentUser() user: AuthenticatedUser, @Param('fileName') fileName: string, @Res({ passthrough: true }) response: Response) {
    this.assertAccess(user);
    const backup = await this.backups.download(fileName);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${backup.fileName}"`);
    response.setHeader('Content-Length', backup.sizeBytes.toString());
    return new StreamableFile(createReadStream(backup.absolutePath));
  }

  private assertAccess(user: AuthenticatedUser) { assertOrganizationScope(resolveDataScope(user, 'backups.manage')); }
}
