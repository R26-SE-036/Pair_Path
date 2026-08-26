import { IsString, IsArray, IsObject, IsOptional, IsNumber } from 'class-validator';

export class PredictPairStateDto {
  @IsString()
  sessionId: string;

  // L5: raw events — features are computed by ml-service's canonical extractor.
  @IsArray()
  events: Array<Record<string, any>>;

  @IsObject()
  roles: Record<string, string>;

  @IsOptional()
  @IsNumber()
  lastRoleSwitchAt?: number;

  @IsOptional()
  @IsNumber()
  sessionStartAt?: number;
}
