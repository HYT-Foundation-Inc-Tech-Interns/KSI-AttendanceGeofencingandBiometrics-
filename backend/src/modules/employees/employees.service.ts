import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Employee, User, UserRole } from '../../database/entities';
import { MailService } from '../mail/mail.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/create-employee.dto';
import {
  generateTemporaryPassword,
  canonicalEmail,
} from '../../common/utils/password.util';

/** Cost factor for bcrypt. Matches AuthService.hashPassword. */
const BCRYPT_ROUNDS = 10;

export interface EmployeeAccountSummary {
  email: string;
  role: string;
  temporaryPassword?: string;
  emailSent: boolean;
  emailError?: string;
  /** True when this call created the login, false when it already existed. */
  created: boolean;
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    @InjectRepository(Employee)
    private employeeRepository: Repository<Employee>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly mailService: MailService,
  ) {}

  /**
   * Create the employee record.
   *
   * Deliberately does NOT create a login or send anything. Provisioning the
   * account is a separate, explicit step the administrator takes per employee
   * (`issueCredentials`), so that nothing is emailed until a person decides it
   * should be — and so a mistyped address can be corrected before credentials
   * are sent to it.
   */
  async create(
    organizationId: string,
    createEmployeeDto: CreateEmployeeDto,
  ): Promise<Employee> {
    const existing = await this.employeeRepository.findOne({
      where: { employeeCode: createEmployeeDto.employeeCode },
    });

    if (existing) {
      throw new ConflictException(
        `Employee code ${createEmployeeDto.employeeCode} already exists`,
      );
    }

    const email = canonicalEmail(createEmployeeDto.email);

    // `users.email` is globally unique, so an address already backing a login
    // can never be issued to a second employee. Catching it here reports the
    // problem while the administrator is still looking at the form, instead of
    // letting them discover it later when issuing credentials fails.
    const emailTaken = await this.userRepository.findOne({ where: { email } });
    if (emailTaken) {
      throw new ConflictException(
        `An account already exists for ${email}. Use a different email address.`,
      );
    }

    // Two employees sharing an address is not blocked by any constraint, but
    // only one of them could ever be issued a login, so it is refused here.
    const duplicate = await this.employeeRepository.findOne({
      where: { email },
    });
    if (duplicate) {
      throw new ConflictException(
        `Employee ${duplicate.employeeCode} already uses ${email}. Use a different email address.`,
      );
    }

    const employee = await this.employeeRepository.save(
      this.employeeRepository.create({
        ...createEmployeeDto,
        email,
        organizationId,
      }),
    );

    this.logger.log(`Created employee ${employee.employeeCode} (${email})`);

    return employee;
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

  /**
   * Update an employee, keeping the linked login account in step.
   *
   * This is the bug that produced the "logged in as juan.delacruz but the
   * dashboard says Ryan Cepeda Domer" report: the employee's name and email
   * could be edited here while the `users` row kept the values it was created
   * with, so the two records drifted and the dashboard (which reads the
   * employee) disagreed with the login (which reads the user).
   */
  async update(
    id: string,
    organizationId: string,
    updateEmployeeDto: UpdateEmployeeDto,
  ): Promise<Employee> {
    const employee = await this.findOne(id, organizationId);

    const defined = Object.fromEntries(
      Object.entries(updateEmployeeDto).filter(([, value]) => value !== undefined),
    ) as UpdateEmployeeDto;

    const nextEmail = defined.email ? canonicalEmail(defined.email) : undefined;
    const emailChanged = nextEmail !== undefined && nextEmail !== employee.email;
    const nameChanged =
      defined.fullName !== undefined && defined.fullName !== employee.fullName;

    if (emailChanged) {
      const clash = await this.userRepository.findOne({
        where: { email: nextEmail as string },
      });
      // A clash with this employee's own account is a no-op, not an error.
      if (clash && clash.employeeId !== employee.id) {
        throw new ConflictException(
          `An account already exists for ${nextEmail}. Use a different email address.`,
        );
      }
    }

    const saved = await this.employeeRepository.manager.transaction(
      async (manager) => {
        Object.assign(employee, defined);
        if (nextEmail !== undefined) {
          employee.email = nextEmail;
        }
        const result = await manager.save(employee);

        if (emailChanged || nameChanged) {
          const user = await manager.findOne(User, {
            where: { employeeId: employee.id },
          });

          if (user) {
            if (emailChanged) user.email = nextEmail as string;
            if (nameChanged) user.fullName = defined.fullName as string;
            await manager.save(user);
            this.logger.log(
              `Synced login ${user.email} to employee ${employee.employeeCode}`,
            );
          } else {
            this.logger.warn(
              `Employee ${employee.employeeCode} has no login account to sync`,
            );
          }
        }

        return result;
      },
    );

    return saved;
  }

  /**
   * Delete an employee and their login.
   *
   * `users.employee_id` is ON DELETE SET NULL, so removing only the employee
   * would leave a working credential attached to nobody. The account is
   * deleted explicitly, inside the same transaction.
   *
   * Note this also removes the employee's attendance history: the
   * `attendance_events.employee_id` foreign key is ON DELETE CASCADE. That is
   * pre-existing behaviour and matches how the delete button already reads,
   * but it is destructive and not recoverable.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const employee = await this.findOne(id, organizationId);

    await this.employeeRepository.manager.transaction(async (manager) => {
      await manager.delete(User, { employeeId: employee.id });
      await manager.remove(employee);
    });
  }

  /**
   * Create or reset an employee's login and email them the password.
   *
   * This is the only path that provisions an account. It is exposed to
   * administrators alone, and is what the "Generate account" button on the
   * Employees page calls.
   *
   * It also creates the account when the employee has none — which is now the
   * normal case, since `create()` no longer provisions one — so it doubles as
   * the repair path for records that exist without a way to sign in.
   */
  async issueCredentials(
    id: string,
    organizationId: string,
  ): Promise<EmployeeAccountSummary> {
    const employee = await this.findOne(id, organizationId);

    if (!employee.email) {
      throw new BadRequestException(
        'This employee has no email address, so no account can be created. Add an email first.',
      );
    }

    const email = canonicalEmail(employee.email);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);

    let user = await this.userRepository.findOne({
      where: { employeeId: employee.id },
    });
    const created = !user;

    if (!user) {
      const emailTaken = await this.userRepository.findOne({ where: { email } });
      if (emailTaken) {
        throw new ConflictException(
          `An account already exists for ${email} but is not linked to this employee.`,
        );
      }

      user = this.userRepository.create({
        organizationId,
        employeeId: employee.id,
        email,
        fullName: employee.fullName,
        role: UserRole.EMPLOYEE,
        passwordHash,
        isActive: true,
        mustChangePassword: true,
      });
    } else {
      user.email = email;
      user.fullName = employee.fullName;
      user.passwordHash = passwordHash;
      user.isActive = true;
      /*
       * Set on reset as well as creation. This password was generated by an
       * administrator and delivered by email, so it is temporary in exactly
       * the same way a first one is -- and a reset is often done precisely
       * because the previous one is suspect.
       */
      user.mustChangePassword = true;
    }

    await this.userRepository.save(user);

    this.logger.log(
      `${created ? 'Created' : 'Reset'} login for employee ${employee.employeeCode} (${email})`,
    );

    const delivery = await this.deliverCredentials({
      to: email,
      fullName: employee.fullName,
      temporaryPassword,
    });

    return {
      email,
      role: user.role,
      temporaryPassword,
      created,
      ...delivery,
    };
  }

  /**
   * Send the credentials to the employee.
   *
   * A failure here is reported, never thrown: the employee and their account
   * are already committed by the time this runs, and a mail outage must not
   * undo that. The caller passes the outcome to the administrator, who can
   * read the password off the screen and hand it over instead.
   */
  private async deliverCredentials(params: {
    to: string;
    fullName: string;
    temporaryPassword: string;
  }): Promise<{ emailSent: boolean; emailError?: string }> {
    const result = await this.mailService.sendEmployeeCredentials(params);

    if (!result.sent) {
      this.logger.warn(
        `Could not email credentials to ${params.to}: ${result.error}`,
      );
    }

    return { emailSent: result.sent, emailError: result.error };
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
