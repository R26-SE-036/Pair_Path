import { IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';

export const SESSION_MODES = ['EXERCISE', 'FREE'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export class CreateSessionDto {
  /** EXERCISE when omitted, which is every client written before FREE existed. */
  @IsOptional()
  @IsIn(SESSION_MODES)
  mode?: SessionMode;

  /** Required for an exercise session; ignored for a free one. */
  @ValidateIf((dto: CreateSessionDto) => dto.mode !== 'FREE')
  @IsString()
  questionId?: string;
}
