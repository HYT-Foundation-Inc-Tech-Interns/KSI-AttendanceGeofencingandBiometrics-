import {
  Controller,
  Post,
  Get,
  Delete,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
    return this.biometricService.enrollFace(user.organizationId, enrollDto);
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
    return this.biometricService.verifyFace(user.organizationId, verifyDto);
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
    return this.biometricService.getEmployeeEnrollments(user.organizationId, employeeId);
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
    return this.biometricService.revokeEnrollment(user.organizationId, enrollmentId);
  }
}
