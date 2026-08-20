import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { OeeStandardModule } from '../oee-standard/oee-standard.module';
import { LiveShiftService } from './live-shift.service';
import { LiveShiftController } from './live-shift.controller';

/**
 * The live shift screen.
 *
 * It imports the standard engine rather than reimplementing it. That is the
 * whole design: the live page and the analysis page are two windows onto one
 * store, so "this shift" cannot mean two different things depending on which
 * screen is open.
 */
@Module({
  imports: [DatabaseModule, OeeStandardModule],
  controllers: [LiveShiftController],
  providers: [LiveShiftService],
  exports: [LiveShiftService],
})
export class LiveShiftModule {}
