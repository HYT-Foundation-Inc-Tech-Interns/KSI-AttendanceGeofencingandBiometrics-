import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  GetEmployeeResponseDto,
  EmployeeAccountDto,
} from './dto/create-employee.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a new employee',
    description:
      'Creates the employee record only. No login is created and no email is sent; ' +
      'use POST /employees/:id/credentials to provision the account, which returns a ' +
      'one-time temporary password and emails it to the employee.',
  })
  @ApiResponse({
    status: 201,
    description: 'Employee created',
    type: GetEmployeeResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Employee code or email already in use' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async create(
    @CurrentUser('organizationId') organizationId: string,
    @Body() createEmployeeDto: CreateEmployeeDto,
  ) {
    return this.employeesService.create(organizationId, createEmployeeDto);
  }

  @Post(':id/credentials')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Create or reset an employee's login and email the password",
    description:
      'Provisions the login if the employee has none, otherwise resets its password, ' +
      'then emails the credentials. Returns the temporary password once. ' +
      'Administrators only.',
  })
  @ApiResponse({ status: 200, description: 'Credentials issued', type: EmployeeAccountDto })
  @ApiResponse({ status: 400, description: 'Employee has no email address' })
  @ApiResponse({
    status: 409,
    description: 'Email already used by an account not linked to this employee',
  })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async issueCredentials(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.employeesService.issueCredentials(id, organizationId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.HR)
  @ApiOperation({
    summary: 'Get all employees for organization',
    description:
      'Back-office only. This returns the whole directory including every ' +
      'employee email address, so it is not reachable with an employee token. ' +
      'The check-in page reads the signed-in employee from GET /employees/:id.',
  })
  @ApiQuery({ name: 'siteId', required: false, description: 'Filter by site ID' })
  @ApiResponse({ status: 200, description: 'Employees retrieved successfully', type: [GetEmployeeResponseDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async findAll(
    @CurrentUser('organizationId') organizationId: string,
    @Query('siteId') siteId?: string,
  ) {
    return this.employeesService.findAll(organizationId, siteId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee by ID' })
  @ApiResponse({ status: 200, description: 'Employee retrieved successfully', type: GetEmployeeResponseDto })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.employeesService.findOne(id, organizationId);
  }

  @Get(':id/site')
  @ApiOperation({ summary: 'Get employee assigned site' })
  @ApiResponse({ status: 200, description: 'Site information retrieved' })
  @ApiResponse({ status: 404, description: 'Employee has no assigned site' })
  async getAssignedSite(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.employeesService.getAssignedSite(id, organizationId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Update employee' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully', type: GetEmployeeResponseDto })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async update(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(id, organizationId, updateEmployeeDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.HR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete employee' })
  @ApiResponse({ status: 204, description: 'Employee deleted successfully' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async remove(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    await this.employeesService.remove(id, organizationId);
  }
}
