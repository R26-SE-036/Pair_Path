import { IsArray, IsBoolean } from 'class-validator';

export class SubmitReviewDto {
  @IsArray()
  @IsBoolean({ each: true })
  answers: boolean[];
}
