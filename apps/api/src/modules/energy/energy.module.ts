import { Module } from '@nestjs/common';
import { EnergyController } from './energy.controller';
import { EnergyService } from './energy.service';
import { EnergyWoMachineService } from './energy-wo-machine.service';
import { EnergyAnalyticsService } from './energy-analytics.service';

@Module({
  controllers: [EnergyController],
  providers: [EnergyService, EnergyWoMachineService, EnergyAnalyticsService],
  exports: [EnergyService, EnergyWoMachineService, EnergyAnalyticsService],
})
export class EnergyModule {}
