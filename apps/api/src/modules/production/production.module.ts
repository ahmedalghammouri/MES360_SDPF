import { Module } from '@nestjs/common';
import { AttainmentSnapshotService } from './attainment-snapshot.service';
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
import { LiveController } from './live.controller';
import { LiveKpiService } from './live-kpi.service';
import { HistorianModule } from '../historian/historian.module';

@Module({
  imports: [ApsModule, HistorianModule],
  controllers: [LiveController, MachineStatusController, ProductionController, DowntimeController, RecipeController, TraceabilityController, MaterialRequestController],
  providers: [
    AttainmentSnapshotService,LiveKpiService, MachineStatusService, OeeAnalyticsService, ProductionService, OEEService, KpiService, ScheduleKpiService, DowntimeService, RecipeService, TraceabilityService, WorkOrderSchedulerService, MaterialRequestService],
  exports: [
    AttainmentSnapshotService,LiveKpiService, ProductionService, OEEService, KpiService, ScheduleKpiService, DowntimeService, RecipeService, TraceabilityService],
})
export class ProductionModule {}
