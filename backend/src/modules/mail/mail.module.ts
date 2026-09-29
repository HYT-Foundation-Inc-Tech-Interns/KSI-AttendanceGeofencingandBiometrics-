import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Outbound email.
 *
 * Exported so feature modules (employees, and later the check-in one-time
 * codes) can inject MailService without re-declaring it.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
