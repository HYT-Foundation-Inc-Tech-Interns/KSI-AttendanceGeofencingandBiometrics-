import {
  Controller,
  Get,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { BiometricRetentionService } from './biometric-retention.service';

/**
 * Retention control, for the person who has to answer "when are these
 * photographs gone?".
 *
 * ADMIN only, not ADMIN/HR: HR uses the images, but changing when they are
 * destroyed is a data-protection decision.
 */
@ApiTags('Maintenance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly retentionService: BiometricRetentionService,
  ) {}

  @Get('biometric-retention')
  @ApiOperation({
    summary: 'Report the biometric retention window',
    description:
      'The configured number of days and the cutoff a sweep would use right now.',
  })
  async status() {
    const result = await this.retentionService.describe();
    return result;
  }

  @Post('biometric-retention/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run the biometric retention sweep now',
    description:
      'Clears face photographs older than the retention window. Rows are kept; ' +
      'only the images are removed. The 128-d descriptor is never touched.',
  })
  @ApiResponse({ status: 200, description: 'Counts of images cleared' })
  async run() {
    const result = await this.retentionService.sweep();

    if (!result) {
      return {
        ran: false,
        reason:
          'BIOMETRIC_RETENTION_DAYS is not a positive number of days, so the sweep is disabled.',
      };
    }

    return { ran: true, ...result };
  }
}
