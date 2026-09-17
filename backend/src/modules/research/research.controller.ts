import { Body, Controller, Get, Post, Req } from '@nestjs/common';

import { DecideConsentDto } from './dto/decide-consent.dto';
import { ResearchService } from './research.service';

/**
 * A student's own research-consent decision. Authenticated by the global guard
 * like every other route; a student can only ever read or change their own.
 */
@Controller('research')
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Get('consent')
  status(@Req() req: any) {
    return this.research.status(req.user.userId);
  }

  @Post('consent')
  decide(@Body() body: DecideConsentDto, @Req() req: any) {
    return this.research.decide(req.user.userId, body.decision);
  }
}
