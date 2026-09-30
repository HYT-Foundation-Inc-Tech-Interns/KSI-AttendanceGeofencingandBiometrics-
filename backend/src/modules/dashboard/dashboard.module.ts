import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Employee } from '../../database/entities/employee.entity';
import { Site } from '../../database/entities/site.entity';
import { AttendanceEvent } from '../../database/entities/attendance-event.entity';
import { AttendanceAttempt } from '../../database/entities/attendance-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Employee,
      Site,
      AttendanceEvent,
      AttendanceAttempt,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
