import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AttendanceEvent, SyncAuditLog } from '../../database/entities';

@Module({
  imports: [TypeOrmModule.forFeature([AttendanceEvent, SyncAuditLog])],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
