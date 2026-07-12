import { Module } from '@nestjs/common';
import { BufferService } from './buffer.service';
import { IngestService } from './ingest.service';
import { CounterService } from './counter.service';
import { EnergyReadingService } from './energy-reading.service';
import { StatusService } from './status.service';
import { ModbusPollerService } from './modbus-poller.service';
import { ModbusLogService } from './modbus-log.service';

@Module({
  providers: [BufferService, IngestService, CounterService, EnergyReadingService, StatusService, ModbusPollerService, ModbusLogService],
  exports: [ModbusPollerService, IngestService, CounterService, BufferService, ModbusLogService],
})
export class AcquisitionModule {}
