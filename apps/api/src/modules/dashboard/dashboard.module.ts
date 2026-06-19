import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ProductionModule } from '../production/production.module';
import { ShiftModule } from '../shift/shift.module';

@Module({
  imports: [ProductionModule, ShiftModule], // KpiService (OEE engine) + ShiftService (current-shift analysis)
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
