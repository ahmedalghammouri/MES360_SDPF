import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService } from './ai.service';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('AI')
@ApiBearerAuth('JWT-auth')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('insights')
  @ApiOperation({ summary: 'Get rule-based AI insights derived from live operational data' })
  async getInsights(@CurrentUser() user: RequestUser) {
    return this.aiService.getInsights(user.factoryId);
  }
}
