import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { RawMaterialsService } from './raw-materials.service';
import { StockMovementsService } from './stock-movements.service';
import { TraceabilityModule } from '../traceability/traceability.module';

@Module({
  imports: [TraceabilityModule],
  controllers: [InventoryController],
  providers: [InventoryService, RawMaterialsService, StockMovementsService],
  exports: [InventoryService, RawMaterialsService, StockMovementsService],
})
export class InventoryModule {}
