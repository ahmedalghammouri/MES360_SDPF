import {
  Controller, Get, Post, Patch, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { AlarmsService } from './alarms.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { CreateAlarmDto, ResolveAlarmDto } from './dto/alarms.dto';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Alarms')
@ApiBearerAuth('JWT-auth')
@Controller('alarms')
export class AlarmsController {
  constructor(private readonly alarms: AlarmsService) {}

  @Get()
  @ApiOperation({ summary: 'List alarm events with filters' })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({ name: 'jobOrderId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('severity') severity?: string,
    @Query('active') active?: string,
    @Query('jobOrderId') jobOrderId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.alarms.list(user.factoryId, {
      machineId,
      severity,
      active: active === 'true',
      jobOrderId,
      workOrderId,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Alarm KPIs (active, unacknowledged, critical, last 24h, avg resolution)' })
  kpis(@CurrentUser() user: RequestUser) {
    return this.alarms.kpis(user.factoryId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuditLog('ALARM_CREATE')
  @ApiOperation({ summary: 'Raise a manual alarm from the shop floor (tagged to machine / job order)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateAlarmDto) {
    return this.alarms.create(user.factoryId, user.id, dto);
  }

  @Patch(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @AuditLog('ALARM_ACK')
  @ApiOperation({ summary: 'Acknowledge an alarm' })
  acknowledge(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.alarms.acknowledge(user.factoryId, id, user.id);
  }

  @Patch(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @AuditLog('ALARM_RESOLVE')
  @ApiOperation({ summary: 'Resolve an alarm (auto-acknowledges, records duration)' })
  resolve(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlarmDto,
  ) {
    return this.alarms.resolve(user.factoryId, id, user.id, dto);
  }
}
