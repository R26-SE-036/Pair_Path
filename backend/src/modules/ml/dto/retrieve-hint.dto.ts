import { IsString, IsArray, IsOptional } from 'class-validator';

export class RetrieveHintDto {
  @IsString()
  sessionId: string;

  @IsOptional()
  @IsString()
  pairId?: string;

  @IsOptional()
  @IsString()
  predictedState?: string;

  @IsOptional()
  @IsString()
  interventionType?: string;

  @IsArray()
  @IsString({ each: true })
  questionConceptTags: string[];

  @IsOptional()
  @IsString()
  recentErrorContext?: string;

  @IsOptional()
  @IsString()
  recentCodeSnippet?: string;
}
