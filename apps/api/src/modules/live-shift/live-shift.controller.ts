import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { LiveShiftService, LIVE_WINDOWS, isLiveWindow } from './live-shift.service';
import { OeeStandardService, type OeeScope } from '../oee-standard/oee-standard.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

interface RequestUser { id: string; factoryId: string | null }

/**
 * The current shift, live.
 *
 * ── Why there is no dateFrom/dateTo here ────────────────────────────────────
 * The window is the shift, and the shift is decided by the clock. Accepting a
 * date pair would let this screen be pointed at last Tuesday, at which point it
 * is the analysis page with a worse filter — and the two would start to disagree
 * about the same Tuesday, which is the failure this split exists to end.
 *
 * A widget may narrow to a TAIL of the shift (`window=60`), and the service
 * clamps that to the shift start, so nothing on the page can show minutes that
 * belong to the shift before.
 */
@ApiTags('Live Shift')
@ApiBearerAuth('JWT-auth')
@Controller('live-shift')
export class LiveShiftController {
  constructor(
    private readonly live: LiveShiftService,
    private readonly oee: OeeStandardService,
  ) {}

  private scope(q: Record<string, string | undefined>): OeeScope {
    return {
      areaId: q.areaId || undefined,
      lineId: q.lineId || undefined,
      machineId: q.machineId || undefined,
      skuId: q.skuId || undefined,
      workOrderId: q.workOrderId || undefined,
      productionOrderId: q.productionOrderId || undefined,
      productionOrderNumber: q.productionOrderNumber || undefined,
    };
  }

  /**
   * Everything the live screen needs, for one window, in one round trip.
   *
   * The per-widget range controls each call this again with their own `window`,
   * which costs a request but keeps every widget's numbers self-consistent — a
   * shared payload sliced client-side would have each widget re-deriving totals,
   * and that is exactly how the counts drifted before.
   */
  @Get()
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'Current shift: header, orders, machines, totals, trend and timeline' })
  @ApiQuery({
    name: 'window', required: false,
    description: `Tail of the shift to show: ${Object.keys(LIVE_WINDOWS).join(' | ')}`,
  })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'productionOrderId', required: false })
  @ApiQuery({ name: 'productionOrderNumber', required: false })
  async overview(
    @CurrentUser() user: RequestUser,
    @Query('window') windowKey?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('skuId') skuId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('productionOrderNumber') productionOrderNumber?: string,
  ) {
    const f = user.factoryId;
    const scope = this.scope({ areaId, lineId, machineId, skuId, workOrderId, productionOrderId, productionOrderNumber });
    // An unknown window falls back to the whole shift rather than 400-ing: a
    // stale bookmark should show the shift, not an error page.
    const w = isLiveWindow(windowKey) ? (windowKey as string) : 'shift';

    const shift = await this.live.currentShift(f);
    const win = this.live.windowOf(shift, w);
    // The shift is also a scope dimension — without it the totals would cover
    // whatever minutes fall in the window regardless of which shift claimed them,
    // which at a shift boundary is two shifts added together.
    const scoped: OeeScope = { ...scope, shiftTemplateId: shift.templateId ?? undefined };
    const bucketMin = this.live.bucketMinutesFor(win.minutes);

    // A window that has not started yet (the first seconds of a shift) has no
    // rows and no meaningful trend. Returning the header alone is honest; running
    // six aggregates over an empty range to print zeros is not.
    if (win.minutes <= 0) {
      return {
        shift, window: win, bucketMin, empty: true,
        totals: null, machines: [], jobOrders: [], machineNow: [],
        trend: [], timeline: [], states: [], rejectReasons: null,
        production: null, windows: LIVE_WINDOWS,
      };
    }

    const [totals, machines, jobOrders, machineNow, trend, states, timeline, rejectReasons] =
      await Promise.all([
        this.oee.overview(f, win.from, win.to, scoped),
        this.oee.byMachine(f, win.from, win.to, scoped),
        this.live.jobOrders(f, win.from, win.to, scope),
        this.live.machineNow(f, scope),
        this.oee.trendByMinutes(f, win.from, win.to, bucketMin, scoped),
        this.oee.stateBreakdown(f, win.from, win.to, scoped),
        this.live.timelineSegments(f, win.from, win.to, scope),
        this.live.rejectReasons(f, win.from, win.to, scope),
      ]);

    // `overview()` carries its own `window` (the bare from/to it was given). The
    // live window is spread AFTER it on purpose: it is the same span plus the
    // label and the clamp flag, and the page needs to be able to say "last hour,
    // truncated to 20 min" rather than just showing two timestamps.
    return {
      ...totals,
      shift, window: win, bucketMin, empty: false,
      machines, jobOrders, machineNow, trend, states, timeline, rejectReasons,
      windows: LIVE_WINDOWS,
    };
  }
}
