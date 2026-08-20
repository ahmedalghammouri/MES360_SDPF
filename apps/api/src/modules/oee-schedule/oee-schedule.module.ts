import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { OeeScheduleService } from './oee-schedule.service';
import { OeeScheduleWriter } from './oee-schedule.writer';
import { OeeScheduleController } from './oee-schedule.controller';

/**
 * The schedule-basis engine. Self-contained apart from the minute
 * classification, which it shares with the standard engine because it is
 * literally the same question — see minute-classification.ts.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [OeeScheduleController],
  providers: [OeeScheduleService, OeeScheduleWriter],
  exports: [OeeScheduleService],
})
export class OeeScheduleModule {}
