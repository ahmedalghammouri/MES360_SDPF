import { Module } from '@nestjs/common';
import { ApsModule } from '../aps/aps.module';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { OEEService } from './oee.service';
import { KpiService } from './kpi.service';
import { MachineStatusService } from './machine-status.service';
import { OeeAnalyticsService } from './oee-analytics.service';
import { MachineStatusController } from './machine-status.controller';
import { ScheduleKpiService } from './schedule-kpi.service';
import { DowntimeController } from './downtime.controller';
import { DowntimeService } from './downtime.service';
import { RecipeController } from './recipe.controller';
import { RecipeService } from './recipe.service';
import { TraceabilityService } from './traceability.service';
import { TraceabilityController } from './traceability.controller';
import { WorkOrderSchedulerService } from './work-order-scheduler.service';
import { MaterialRequestService } from './material-request.service';
import { MaterialRequestController } from './material-request.controller';
import { HistorianModule } from '../historian/historian.module';

@Module({
  imports: [ApsModule, HistorianModule],
  controllers: [MachineStatusController, ProductionController, DowntimeController, RecipeController, TraceabilityController, MaterialRequestController],
  providers: [MachineStatusService, OeeAnalyticsService, ProductionService, OEEService, KpiService, ScheduleKpiService, DowntimeService, RecipeService, TraceabilityService, WorkOrderSchedulerService, MaterialRequestService],
  exports: [ProductionService, OEEService, KpiService, ScheduleKpiService, DowntimeService, RecipeService, TraceabilityService],
})
export class ProductionModule {}
