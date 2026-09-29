import {
  Controller,
  Post,
  Body,
  Param,
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
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { AdminService } from './admin.service';
import {
  ApproveAttendanceEventDto,
  RejectAttendanceEventDto,
} from './dto/review-attendance.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.HR)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('attendance/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a flagged attendance event' })
  @ApiParam({ name: 'id', description: 'Attendance event UUID' })
  @ApiResponse({ status: 200, description: 'Event approved' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: ApproveAttendanceEventDto,
  ) {
    return this.adminService.approveEvent(
      id,
      user.organizationId,
      { id: user.id, role: user.role },
      dto.notes,
    );
  }

  @Post('attendance/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a flagged attendance event' })
  @ApiParam({ name: 'id', description: 'Attendance event UUID' })
  @ApiResponse({ status: 200, description: 'Event rejected' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async reject(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: RejectAttendanceEventDto,
  ) {
    return this.adminService.rejectEvent(
      id,
      user.organizationId,
      { id: user.id, role: user.role },
      dto.reason,
    );
  }
}
