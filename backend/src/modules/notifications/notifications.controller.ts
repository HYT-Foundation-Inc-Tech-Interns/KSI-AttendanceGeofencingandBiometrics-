import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { NotificationsService } from './notifications.service';

/**
 * The notification bell's backing endpoints.
 *
 * Back-office only: a refused check-in is an operational event for the people
 * running the site, and it carries a photograph of whoever was standing there.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.HR)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List refused check-ins and check-outs' })
  @ApiQuery({ name: 'includeAcknowledged', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Unread count plus the page of items' })
  async list(
    @CurrentUser() user: any,
    @Query('includeAcknowledged') includeAcknowledged?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.notificationsService.list(user.organizationId, {
      includeAcknowledged: includeAcknowledged === 'true',
      limit: limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200) : 50,
      page: page ? Math.max(parseInt(page, 10) || 1, 1) : 1,
    });
  }

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss one notification without recording attendance' })
  @ApiParam({ name: 'id', description: 'Attempt UUID' })
  async acknowledge(@Param('id') id: string, @CurrentUser() user: any) {
    return this.notificationsService.acknowledge(id, user.organizationId, user.id);
  }

  @Post('acknowledge-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss every open notification' })
  async acknowledgeAll(@CurrentUser() user: any) {
    return this.notificationsService.acknowledgeAll(user.organizationId, user.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a refused punch and record it as attendance' })
  @ApiParam({ name: 'id', description: 'Attempt UUID' })
  @ApiResponse({ status: 200, description: 'Attendance event created' })
  @ApiResponse({ status: 400, description: 'Already approved, or no usable location' })
  async approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.notificationsService.approve(id, user.organizationId, user.id);
  }
}
