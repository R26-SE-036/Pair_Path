import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { InterventionsService } from './interventions.service';
import { CreateInterventionDto } from './dto/create-intervention.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('interventions')
@UseGuards(JwtAuthGuard)
export class InterventionsController {
  constructor(private readonly interventionsService: InterventionsService) {}

  @Post()
  create(@Body() createInterventionDto: CreateInterventionDto) {
    return this.interventionsService.create(createInterventionDto);
  }

  @Get('session/:sessionId')
  findBySession(@Param('sessionId') sessionId: string) {
    return this.interventionsService.findBySession(sessionId);
  }

  @Post(':id/respond')
  respond(
    @Param('id') id: string,
    @Body() body: { accepted: boolean },
  ) {
    return this.interventionsService.respond(id, body.accepted);
  }
}
