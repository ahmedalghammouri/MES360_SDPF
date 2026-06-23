import { Module } from '@nestjs/common';

import { ShiftService } from './shift.service';
import { ShiftController } from './shift.controller';
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [ProductionModule], // KpiService → fact-store OEE reads
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class ShiftModule {}
