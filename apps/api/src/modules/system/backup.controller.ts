import {
  Body, Controller, Delete, Get, Param, Post, Res, UseGuards, StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemOwnerGuard } from '../../common/guards/system-owner.guard';
import { BackupService } from './backup.service';

interface RequestUser {
  id: string;
  email: string;
  role: string;
  passwordHash: string;
  factoryId?: string | null;
}

/**
 * Database backup & restore.
 *
 * Owner-only, like the rest of the danger zone — a full dump is every record in
 * the plant in one downloadable file, and a restore replaces all of it.
 */
@ApiTags('System')
@ApiBearerAuth('JWT-auth')
@Controller('system/backups')
@UseGuards(SystemOwnerGuard)
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  @ApiOperation({ summary: 'List stored database backups (owner only)' })
  list() {
    return this.backups.list();
  }

  @Post()
  @ApiOperation({ summary: 'Take a new full database backup (owner only)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: { label?: string }) {
    return this.backups.create(user as never, dto?.label);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore the database from a backup — destructive (owner only)' })
  restore(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: { password: string; confirmation: string },
  ) {
    return this.backups.restore(user as never, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a stored backup (owner only)' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.backups.remove(user as never, id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download the archive (owner only)' })
  async download(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { stream, meta } = await this.backups.streamFor(id);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${meta.filename}"`,
      'Content-Length': String(meta.sizeBytes),
    });
    return new StreamableFile(stream);
  }
}
