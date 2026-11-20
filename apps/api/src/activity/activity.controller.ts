import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { resolveDataScope } from '../auth/data-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ActivityService } from './activity.service';
import { ListActivityDto } from './dto/list-activity.dto';

@Controller('activity')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @RequirePermissions('activity.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListActivityDto) {
    return this.activity.list(user.organizationId, query, resolveDataScope(user, 'activity.read'));
  }

  @Get('actors')
  @RequirePermissions('activity.read')
  actors(@CurrentUser() user: AuthenticatedUser) {
    return this.activity.actors(user.organizationId, user.id, resolveDataScope(user, 'activity.read'));
  }
}
