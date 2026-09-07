import { IsString, IsArray, IsEnum, IsOptional } from 'class-validator';

export class CreateQuestionDto {
  @IsString()
  topicId: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  difficulty: string;

  @IsString()
  @IsOptional()
  starterCode?: string;

  @IsString()
  referenceSolution: string;

  @IsArray()
  reviewQuestions: any[];

  @IsArray()
  conceptTags: any[];
}
