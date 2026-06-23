import { Module } from '@nestjs/common';

import { InfluxService } from './influx.service';
import { HistorianService } from './historian.service';
import { HistorianScheduler } from './historian.scheduler';
import { HistorianController } from './historian.controller';
import { ProductionSnapshotService } from './production-snapshot.service';
import { ProductionSnapshotBackfill } from './production-snapshot.backfill';

@Module({
  controllers: [HistorianController],
  providers: [InfluxService, HistorianService, HistorianScheduler, ProductionSnapshotService, ProductionSnapshotBackfill],
  exports: [HistorianService, InfluxService, ProductionSnapshotService, ProductionSnapshotBackfill],
})
export class HistorianModule {}
