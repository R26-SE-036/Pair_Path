import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { MlService } from './ml.service';
import { PredictPairStateDto } from './dto/predict-pair-state.dto';
import { RecommendInterventionDto } from './dto/recommend-intervention.dto';
import { RetrieveHintDto } from './dto/retrieve-hint.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('ml')
@UseGuards(JwtAuthGuard)
export class MlController {
  constructor(private readonly mlService: MlService) {}

  @Post('predict-pair-state')
  async predictPairState(@Body() dto: PredictPairStateDto) {
    return this.mlService.predictPairState(
      dto.sessionId,
      dto.events,
      dto.roles,
      dto.lastRoleSwitchAt,
    );
  }

  @Post('recommend-intervention')
  async recommendIntervention(@Body() dto: RecommendInterventionDto) {
    return this.mlService.recommendIntervention(dto.sessionId, dto.predictedState, dto.confidence);
  }

  @Post('retrieve-hint')
  async retrieveHint(@Body() dto: RetrieveHintDto) {
    return this.mlService.retrieveHint(dto);
  }
}
