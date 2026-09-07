import { IsString, IsEnum } from 'class-validator';

export class CreateInterventionDto {
  @IsString()
  sessionId: string;

  @IsEnum(['PRODUCTIVE', 'DRIVER_DOMINANCE', 'PASSIVE_NAVIGATOR', 'LOGIC_STRUGGLE', 'DISENGAGED'])
  state: string;

  @IsString()
  action: string;

  @IsString()
  uiTarget: string;

  @IsString()
  uiEffect: string;

  @IsString()
  message: string;
}
