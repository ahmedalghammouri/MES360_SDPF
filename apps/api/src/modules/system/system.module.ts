import { Module } from '@nestjs/common';

import { HistorianModule } from '../historian/historian.module';
import { IotModule } from '../iot/iot.module';
import { SystemOwnerGuard } from '../../common/guards/system-owner.guard';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [HistorianModule, IotModule],
  controllers: [SystemController],
  providers: [SystemService, SystemOwnerGuard],
})
export class SystemModule {}
