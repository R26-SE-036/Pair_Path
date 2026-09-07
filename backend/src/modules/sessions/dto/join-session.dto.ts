import { IsString, Length } from 'class-validator';

export class JoinSessionDto {
  @IsString()
  @Length(6, 6)
  joinCode: string;
}
