import { IsInt, Max, Min } from 'class-validator';

/** One answer to one review question. Which questions exist is checked in the service. */
export class AnswerReviewDto {
  @IsInt()
  @Min(0)
  @Max(50)
  step: number;

  @IsInt()
  @Min(0)
  @Max(10)
  choice: number;
}
