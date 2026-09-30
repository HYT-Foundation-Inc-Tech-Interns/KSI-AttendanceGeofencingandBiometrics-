import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('statistics')
  @Roles(UserRole.ADMIN, UserRole.HR)
  async getStatistics(@Request() req: any) {
    const organizationId = req.user.organizationId;
    return this.dashboardService.getStatistics(organizationId);
  }

  @Get('recent-checkins')
  @Roles(UserRole.ADMIN, UserRole.HR)
  async getRecentCheckIns(@Request() req: any) {
    const organizationId = req.user.organizationId;
    return this.dashboardService.getRecentCheckIns(organizationId);
  }

  @Get('flagged-events')
  @Roles(UserRole.ADMIN, UserRole.HR)
  async getFlaggedEvents(@Request() req: any) {
    const organizationId = req.user.organizationId;
    return this.dashboardService.getFlaggedEvents(organizationId);
  }

  /**
   * Site geofences plus every active employee's last known position, for the
   * admin map. Positions come from punches, so each one carries the time it
   * was taken rather than being presented as live tracking.
   */
  @Get('map')
  @Roles(UserRole.ADMIN, UserRole.HR)
  async getMapOverview(@Request() req: any) {
    const organizationId = req.user.organizationId;
    return this.dashboardService.getMapOverview(organizationId);
  }
}
