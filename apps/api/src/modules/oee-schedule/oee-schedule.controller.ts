import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { OeeScheduleService, type ScheduleScope } from './oee-schedule.service';
import { OeeScheduleWriter } from './oee-schedule.writer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { resolveLocalRange } from '../../common/plant-time.util';

interface RequestUser { id: string; factoryId: string | null }

/** Last instant of the plant-local day `d` falls in. */
function endOfLocalDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

/**
 * The schedule basis, on its own path.
 *
 * Third engine, third store, third page. It reads the same signals as the other
 * two and divides them by a different denominator, so a disagreement between any
 * pair of them is information rather than a bug — and none of them can be
 * quietly corrected into agreeing with another.
 */
@ApiTags('OEE Schedule')
@ApiBearerAuth('JWT-auth')
@Controller('oee-schedule')
export class OeeScheduleController {
  constructor(
    private readonly service: OeeScheduleService,
    private readonly writer: OeeScheduleWriter,
  ) {}

  @Get()
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'The committed-slot time model, per machine, job order and shift' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'YYYY-MM-DD, plant-local' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'YYYY-MM-DD, plant-local' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'jobOrderId', required: false })
  @ApiQuery({ name: 'shiftTemplateId', required: false })
  async overview(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('machineId') machineId?: string,
    @Query('lineId') lineId?: string,
    @Query('jobOrderId') jobOrderId?: string,
    @Query('shiftTemplateId') shiftTemplateId?: string,
  ) {
    const { from, to } = resolveLocalRange(dateFrom, dateTo, 1);
    // resolveLocalRange caps the end at "now", which is right for rows that only
    // exist once time has passed and wrong for a slot that extends into the rest
    // of the day. The slot gets the end of the range as ASKED FOR.
    const slotTo = dateTo ? new Date(`${dateTo}T23:59:59.999`) : endOfLocalDay(new Date());
    const scope: ScheduleScope = {
      areaId: areaId || undefined,
      machineId: machineId || undefined,
      lineId: lineId || undefined,
      jobOrderId: jobOrderId || undefined,
      shiftTemplateId: shiftTemplateId || undefined,
    };
    const f = user.factoryId;

    const [overview, machines, jobOrders, shifts, states] = await Promise.all([
      this.service.overview(f, from, to, slotTo, scope),
      this.service.byMachine(f, from, to, slotTo, scope),
      this.service.byJobOrder(f, from, to, slotTo, scope),
      this.service.byShift(f, from, to, slotTo, scope),
      this.service.stateBreakdown(f, from, to, scope),
    ]);
    return { ...overview, machines, jobOrders, shifts, states };
  }

  /** Capture one minute on demand, for a compressed verification run. */
  @Post('capture')
  @RequirePermissions('production:write')
  @ApiOperation({ summary: 'Capture the just-closed minute now (for simulation and verification)' })
  @ApiQuery({ name: 'at', required: false, description: 'ISO instant to capture the minute BEFORE. Simulation only.' })
  async capture(@Query('at') at?: string) {
    let when = new Date();
    if (at) {
      const parsed = new Date(at);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`'at' is not a valid instant: ${at}`);
      when = parsed;
    }
    const written = await this.writer.captureMinute(when);
    return { written, at: when.toISOString() };
  }
}
