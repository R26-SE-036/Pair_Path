import { IsString, IsUUID } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  questionId: string;
}
