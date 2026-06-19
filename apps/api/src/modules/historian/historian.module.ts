import { Module } from '@nestjs/common';

import { InfluxService } from './influx.service';
import { HistorianService } from './historian.service';
import { HistorianScheduler } from './historian.scheduler';
import { HistorianController } from './historian.controller';

@Module({
  controllers: [HistorianController],
  providers: [InfluxService, HistorianService, HistorianScheduler],
  exports: [HistorianService, InfluxService],
})
export class HistorianModule {}
