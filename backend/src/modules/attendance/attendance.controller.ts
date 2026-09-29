import {
  Controller,
  Post,
  Get,
  Body,
  Query,
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
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { AttendanceService } from './attendance.service';
import {
  CheckInDto,
  CheckOutDto,
  AttendanceEventResponseDto,
} from './dto/check-in.dto';
import { ListAttendanceEventsQueryDto } from './dto/list-attendance-events.dto';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Check-in employee',
    description:
      'Record employee check-in with GPS geofence validation and biometric verification',
  })
  @ApiResponse({
    status: 201,
    description: 'Check-in successful',
    type: AttendanceEventResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Already checked in or validation failed' })
  @ApiResponse({ status: 401, description: 'Outside geofence or biometric verification failed' })
  @ApiResponse({ status: 404, description: 'Employee or site not found' })
  async checkIn(
    @CurrentUser() user: any,
    @Body() checkInDto: CheckInDto,
  ): Promise<AttendanceEventResponseDto> {
    return this.attendanceService.checkIn(user.organizationId, checkInDto, user);
  }

  @Post('check-out')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Check-out employee',
    description:
      'Record employee check-out with GPS geofence validation and biometric verification',
  })
  @ApiResponse({
    status: 201,
    description: 'Check-out successful',
    type: AttendanceEventResponseDto,
  })
  @ApiResponse({ status: 400, description: 'No active check-in or validation failed' })
  @ApiResponse({ status: 401, description: 'Outside geofence or biometric verification failed' })
  @ApiResponse({ status: 404, description: 'Employee or site not found' })
  async checkOut(
    @CurrentUser() user: any,
    @Body() checkOutDto: CheckOutDto,
  ): Promise<AttendanceEventResponseDto> {
    return this.attendanceService.checkOut(user.organizationId, checkOutDto, user);
  }

  @Get('events')
  @Roles(UserRole.ADMIN, UserRole.HR)
  @ApiOperation({
    summary: 'List attendance events for the organization',
    description:
      'Paginated, filterable list of attendance events with employee and site names resolved. ' +
      'Back-office only: this spans every employee, so it is not reachable with an ' +
      'employee token. Employees read their own history from ' +
      'GET /attendance/employee/:employeeId.',
  })
  @ApiResponse({ status: 200, description: 'Attendance events retrieved' })
  async findAllEvents(
    @CurrentUser() user: any,
    @Query() query: ListAttendanceEventsQueryDto,
  ) {
    return this.attendanceService.findAllEvents(user.organizationId, query);
  }

  @Get('employee/:employeeId')
  @ApiOperation({
    summary: 'Get employee attendance history',
    description: 'Retrieve attendance events for a specific employee',
  })
  @ApiParam({ name: 'employeeId', description: 'Employee UUID' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Filter from date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'Filter to date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'Attendance history retrieved' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async getEmployeeAttendance(
    @CurrentUser() user: any,
    @Param('employeeId') employeeId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    return this.attendanceService.getEmployeeAttendance(
      user.organizationId,
      employeeId,
      start,
      end,
    );
  }
}
