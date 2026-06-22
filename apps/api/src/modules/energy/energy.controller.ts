import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EnergyService } from './energy.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Energy')
@ApiBearerAuth('JWT-auth')
@Controller('energy')
export class EnergyController {
  constructor(private readonly energyService: EnergyService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Energy management overview KPIs' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getOverview(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.energyService.getOverview(user.factoryId, { areaId, lineId, machineId });
  }

  @Get('cockpit')
  @ApiOperation({ summary: 'Energy Command Center cockpit (overview + live + consumption + waste + specific energy)' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getCockpit(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.energyService.getEnergyCockpit(user.factoryId, { areaId, lineId, machineId }, { dateFrom, dateTo });
  }

  @Get('live')
  @ApiOperation({ summary: 'Live power per meter + standby/no-production detection' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getLive(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.energyService.getLivePower(user.factoryId, { areaId, lineId, machineId });
  }

  @Get('meters')
  @ApiOperation({ summary: 'List all energy meters with last reading' })
  async findMeters(@CurrentUser() user: RequestUser) {
    return this.energyService.findMeters(user.factoryId);
  }

  @Post('meters')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an energy meter' })
  async createMeter(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.energyService.createMeter(user.factoryId, dto);
  }

  @Patch('meters/:id')
  @ApiOperation({ summary: 'Update an energy meter' })
  async updateMeter(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.energyService.updateMeter(user.factoryId, id, dto);
  }

  @Delete('meters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate an energy meter' })
  async deleteMeter(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.energyService.deleteMeter(user.factoryId, id);
  }

  @Get('meter-templates')
  @ApiOperation({ summary: 'List built-in power-meter register templates' })
  getMeterTemplates() {
    return this.energyService.getMeterTemplates();
  }

  @Get('meters/:id/tags')
  @ApiOperation({ summary: 'List a meter’s ENERGY tags (separate from machine tags)' })
  async getMeterTags(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.energyService.getMeterTags(user.factoryId, id);
  }

  @Post('meters/:id/apply-template')
  @ApiOperation({ summary: 'Set the meter template; the edge gateway materializes the tags' })
  async applyTemplate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { templateKey: string },
  ) {
    return this.energyService.updateMeter(user.factoryId, id, { templateKey: dto.templateKey });
  }

  @Post('readings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add manual energy reading' })
  async addReading(
    @CurrentUser() user: RequestUser,
    @Body() dto: { meterId: string; value: number; timestamp?: string; source?: string },
  ) {
    return this.energyService.addReading(user.factoryId, dto);
  }

  @Get('tariffs')
  @ApiOperation({ summary: 'List configured energy cost tariffs (scoped rates)' })
  async listTariffs(@CurrentUser() user: RequestUser) {
    return this.energyService.listTariffs(user.factoryId);
  }

  @Post('tariffs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an energy cost tariff (factory/area/line/machine scope)' })
  async createTariff(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.energyService.createTariff(user.factoryId, dto);
  }

  @Patch('tariffs/:id')
  @ApiOperation({ summary: 'Update an energy cost tariff' })
  async updateTariff(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.energyService.updateTariff(user.factoryId, id, dto);
  }

  @Delete('tariffs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an energy cost tariff' })
  async deleteTariff(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.energyService.deleteTariff(user.factoryId, id);
  }

  @Get('consumption')
  @ApiOperation({ summary: 'Energy consumption data for charts' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'periodType', required: false })
  @ApiQuery({ name: 'meterId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getConsumption(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('periodType') periodType?: string,
    @Query('meterId') meterId?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.energyService.getConsumption(user.factoryId, { from, to, periodType, meterId, areaId, lineId, machineId });
  }
}
