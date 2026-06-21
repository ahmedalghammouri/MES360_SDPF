import { Module } from '@nestjs/common';
import { ApsModule } from '../aps/aps.module';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { OEEService } from './oee.service';
import { KpiService } from './kpi.service';
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
  controllers: [ProductionController, DowntimeController, RecipeController, TraceabilityController, MaterialRequestController],
  providers: [ProductionService, OEEService, KpiService, DowntimeService, RecipeService, TraceabilityService, WorkOrderSchedulerService, MaterialRequestService],
  exports: [ProductionService, OEEService, KpiService, DowntimeService, RecipeService, TraceabilityService],
})
export class ProductionModule {}
