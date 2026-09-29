import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SitesService } from './sites.service';
import { CreateSiteDto, UpdateSiteDto, GeofenceValidationDto, GetSiteResponseDto } from './dto/create-site.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';

@ApiTags('sites')
@ApiBearerAuth()
@Controller('sites')
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Create a new site' })
  @ApiResponse({ status: 201, description: 'Site created successfully', type: GetSiteResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid geofence configuration' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async create(
    @CurrentUser('organizationId') organizationId: string,
    @Body() createSiteDto: CreateSiteDto,
  ) {
    return this.sitesService.create(organizationId, createSiteDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all sites for organization' })
  @ApiResponse({ status: 200, description: 'Sites retrieved successfully', type: [GetSiteResponseDto] })
  async findAll(@CurrentUser('organizationId') organizationId: string) {
    return this.sitesService.findAll(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get site by ID' })
  @ApiResponse({ status: 200, description: 'Site retrieved successfully', type: GetSiteResponseDto })
  @ApiResponse({ status: 404, description: 'Site not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sitesService.findOne(id, organizationId);
  }

  @Get(':id/geofence')
  @ApiOperation({ summary: 'Get site geofence configuration' })
  @ApiResponse({ status: 200, description: 'Geofence data retrieved (for client-side UX only, server still validates)' })
  @ApiResponse({ status: 404, description: 'Site not found' })
  async getGeofence(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.sitesService.getGeofenceData(id, organizationId);
  }

  @Post(':id/validate-geofence')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate if GPS coordinates are within site geofence (server-authoritative)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Validation result',
    schema: {
      example: { withinGeofence: true, distance: 45 }
    }
  })
  @ApiResponse({ status: 400, description: 'Site has no geofence configured' })
  @ApiResponse({ status: 404, description: 'Site not found' })
  async validateGeofence(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() validationDto: GeofenceValidationDto,
  ) {
    return this.sitesService.validateGeofence(id, organizationId, validationDto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Update site' })
  @ApiResponse({ status: 200, description: 'Site updated successfully', type: GetSiteResponseDto })
  @ApiResponse({ status: 404, description: 'Site not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async update(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() updateSiteDto: UpdateSiteDto,
  ) {
    return this.sitesService.update(id, organizationId, updateSiteDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.HR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete site' })
  @ApiResponse({ status: 204, description: 'Site deleted successfully' })
  @ApiResponse({ status: 404, description: 'Site not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    await this.sitesService.remove(id, organizationId);
  }
}
