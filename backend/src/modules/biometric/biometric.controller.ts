import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
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
import { BiometricService } from './biometric.service';
import { EnrollFaceDto, EnrollFaceResponseDto } from './dto/enroll-face.dto';
import { VerifyFaceDto, VerifyFaceResponseDto } from './dto/verify-face.dto';

@ApiTags('Biometric')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('biometric')
export class BiometricController {
  constructor(private readonly biometricService: BiometricService) {}

  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Enroll employee face',
    description:
      'Capture and enroll employee face biometric. Validates liveness and quality.',
  })
  @ApiResponse({
    status: 201,
    description: 'Face enrolled successfully',
    type: EnrollFaceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid face image or quality too low' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async enrollFace(
    @CurrentUser() user: any,
    @Body() enrollDto: EnrollFaceDto,
  ): Promise<EnrollFaceResponseDto> {
    return this.biometricService.enrollFace(user.organizationId, enrollDto, user);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify employee face',
    description:
      'Verify live face against enrolled biometric. Used for attendance check-in/out.',
  })
  @ApiResponse({
    status: 200,
    description: 'Face verification result',
    type: VerifyFaceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'No enrollment found for employee' })
  @ApiResponse({ status: 401, description: 'Face verification failed' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async verifyFace(
    @CurrentUser() user: any,
    @Body() verifyDto: VerifyFaceDto,
  ): Promise<VerifyFaceResponseDto> {
    return this.biometricService.verifyFace(user.organizationId, verifyDto, user);
  }

  /*
   * Declared before 'enrollments/:employeeId' on purpose: Nest matches routes
   * in declaration order, so the reverse order would make a request for
   * 'enrollments' fall into the parameterised handler with employeeId
   * undefined.
   */
  @Get('enrollments')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.HR)
  @ApiOperation({
    summary: 'List every face enrollment in the organization',
    description:
      'Back-office view of who has a face on file, including the frame each ' +
      'employee enrolled with. The 128-d descriptor is never included.',
  })
  @ApiQuery({ name: 'includeRevoked', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'List of enrollments' })
  async listEnrollments(
    @CurrentUser() user: any,
    @Query('includeRevoked') includeRevoked?: string,
  ) {
    return this.biometricService.listOrganizationEnrollments(
      user.organizationId,
      user,
      { includeRevoked: includeRevoked === 'true' },
    );
  }

  @Get('enrollments/:employeeId')
  @ApiOperation({
    summary: 'Get employee enrollments',
    description: 'List all device enrollments for an employee',
  })
  @ApiParam({ name: 'employeeId', description: 'Employee UUID' })
  @ApiResponse({ status: 200, description: 'List of enrollments' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async getEnrollments(@CurrentUser() user: any, @Param('employeeId') employeeId: string) {
    return this.biometricService.getEmployeeEnrollments(user.organizationId, employeeId, user);
  }

  @Delete('enrollments/:enrollmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke device enrollment',
    description: 'Revoke a specific device enrollment (e.g., lost device)',
  })
  @ApiParam({ name: 'enrollmentId', description: 'Device enrollment UUID' })
  @ApiResponse({ status: 204, description: 'Enrollment revoked' })
  @ApiResponse({ status: 404, description: 'Enrollment not found' })
  async revokeEnrollment(
    @CurrentUser() user: any,
    @Param('enrollmentId') enrollmentId: string,
  ): Promise<void> {
    return this.biometricService.revokeEnrollment(user.organizationId, enrollmentId, user);
  }
}
