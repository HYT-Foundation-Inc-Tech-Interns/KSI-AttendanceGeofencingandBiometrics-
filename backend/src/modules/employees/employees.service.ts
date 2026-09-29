import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from '../../database/entities';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/create-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private employeeRepository: Repository<Employee>,
  ) {}

  async create(organizationId: string, createEmployeeDto: CreateEmployeeDto): Promise<Employee> {
    // Check if employee code already exists
    const existing = await this.employeeRepository.findOne({
      where: { employeeCode: createEmployeeDto.employeeCode },
    });

    if (existing) {
      throw new ConflictException(`Employee code ${createEmployeeDto.employeeCode} already exists`);
    }

    const employee = this.employeeRepository.create({
      organizationId,
      ...createEmployeeDto,
    });

    return this.employeeRepository.save(employee);
  }

  async findAll(organizationId: string, siteId?: string): Promise<Employee[]> {
    const where: any = { organizationId };
    
    if (siteId) {
      where.siteId = siteId;
    }

    return this.employeeRepository.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['site'],
    });
  }

  async findOne(id: string, organizationId: string): Promise<Employee> {
    const employee = await this.employeeRepository.findOne({
      where: { id, organizationId },
      relations: ['site'],
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async findByCode(employeeCode: string, organizationId: string): Promise<Employee> {
    const employee = await this.employeeRepository.findOne({
      where: { employeeCode, organizationId },
      relations: ['site'],
    });

    if (!employee) {
      throw new NotFoundException(`Employee with code ${employeeCode} not found`);
    }

    return employee;
  }

  async update(id: string, organizationId: string, updateEmployeeDto: UpdateEmployeeDto): Promise<Employee> {
    const employee = await this.findOne(id, organizationId);

    Object.assign(employee, updateEmployeeDto);

    return this.employeeRepository.save(employee);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const employee = await this.findOne(id, organizationId);
    await this.employeeRepository.remove(employee);
  }

  /**
   * Get employee's assigned site information
   */
  async getAssignedSite(employeeId: string, organizationId: string) {
    const employee = await this.findOne(employeeId, organizationId);

    if (!employee.site) {
      throw new NotFoundException('Employee has no assigned site');
    }

    return employee.site;
  }
}
