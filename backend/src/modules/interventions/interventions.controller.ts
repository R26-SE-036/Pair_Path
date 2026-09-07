import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { InterventionsService } from './interventions.service';
import { RespondToInterventionDto } from './dto/respond-to-intervention.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Both routes are scoped by session, and both check membership.
 *
 * `POST /interventions` is gone - see InterventionsService. `respond` moved
 * under the session it belongs to, so the id in the path can be checked
 * against something rather than trusted on its own.
 */
@Controller('interventions')
@UseGuards(JwtAuthGuard)
export class InterventionsController {
  constructor(private readonly interventionsService: InterventionsService) {}

  @Get('session/:sessionId')
  findBySession(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.interventionsService.findBySession(sessionId, req.user.userId);
  }

  @Post('session/:sessionId/:id/respond')
  respond(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @Body() body: RespondToInterventionDto,
    @Req() req: any,
  ) {
    return this.interventionsService.respond(sessionId, id, body.accepted, req.user.userId);
  }
}
