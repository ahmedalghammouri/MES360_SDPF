import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Dashboard')
@ApiBearerAuth('JWT-auth')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get real-time operations dashboard data' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'timeframe', required: false, description: 'today | shift | week | month | custom' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO date (YYYY-MM-DD)' })
  async getOverview(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getOverview(
      user.factoryId,
      { areaId, lineId, machineId },
      { timeframe, dateFrom, dateTo },
    );
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Get current shift KPIs' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getKPIs(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    const data = await this.dashboardService.getOverview(user.factoryId, { areaId, lineId, machineId });
    return data.kpis;
  }
}
