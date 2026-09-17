import { IsString } from 'class-validator';

export class RunJavaDto {
  @IsString()
  code: string;
}
