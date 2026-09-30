import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  AttendanceAttempt,
  AttendanceEvent,
  Site,
} from '../../database/entities';

@Module({
  imports: [TypeOrmModule.forFeature([AttendanceAttempt, AttendanceEvent, Site])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
