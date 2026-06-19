import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemOwnerGuard } from '../../common/guards/system-owner.guard';
import { SystemService } from './system.service';
import { ResetSystemDto } from './dto/reset.dto';

interface RequestUser {
  id: string;
  email: string;
  role: string;
  passwordHash: string;
  factoryId?: string | null;
}

@ApiTags('System')
@ApiBearerAuth('JWT-auth')
@Controller('system')
export class SystemController {
  constructor(
    private readonly systemService: SystemService,
    private readonly ownerGuard: SystemOwnerGuard,
  ) {}

  /**
   * Lightweight probe used by the UI to decide whether to render the Danger
   * Zone. Authenticated for everyone, but only reveals owner status — never
   * 403s, so non-owners simply don't see the section.
   */
  @Get('owner-check')
  @ApiOperation({ summary: 'Whether the current user is the designated system owner' })
  ownerCheck(@CurrentUser() user: RequestUser) {
    return {
      isOwner: this.ownerGuard.isOwner(user),
      ownerEmail: this.ownerGuard.getOwnerEmail(),
      email: user.email,
      role: user.role,
    };
  }

  @Get('status')
  @UseGuards(SystemOwnerGuard)
  @ApiOperation({ summary: 'Resettable-data snapshot (owner only)' })
  status() {
    return this.systemService.getStatus();
  }

  @Post('reset')
  @UseGuards(SystemOwnerGuard)
  @ApiOperation({ summary: 'Destructive reset of production data and/or historian (owner only)' })
  reset(@CurrentUser() user: RequestUser, @Body() dto: ResetSystemDto, @Req() req: any) {
    return this.systemService.reset(
      user,
      dto,
      { ip: req?.ip, userAgent: req?.headers?.['user-agent'] },
    );
  }

  @Post('historian/pause')
  @UseGuards(SystemOwnerGuard)
  @ApiOperation({ summary: 'Pause/resume historian writes (owner only)' })
  setHistorianPaused(@Body() body: { paused?: boolean }) {
    return this.systemService.setHistorianPaused(!!body?.paused);
  }
}
