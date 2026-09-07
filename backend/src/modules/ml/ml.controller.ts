import { BadRequestException, Controller, Post, Body, UseGuards } from '@nestjs/common';
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
    // One of the two paths has to be taken. Neither means an empty feature
    // vector, which ml-service would answer with a confident prediction about
    // nothing rather than an error.
    if (!dto.events && !dto.features) {
      throw new BadRequestException(
        'Send either `events` (with `roles`) or a pre-computed `features` vector.',
      );
    }
    return this.mlService.predictPairState(dto);
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
