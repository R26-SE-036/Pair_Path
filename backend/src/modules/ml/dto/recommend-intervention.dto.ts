import { IsString, IsNumber } from 'class-validator';

export class RecommendInterventionDto {
  @IsString()
  sessionId: string;

  @IsString()
  predictedState: string;

  @IsNumber()
  confidence: number;
}
