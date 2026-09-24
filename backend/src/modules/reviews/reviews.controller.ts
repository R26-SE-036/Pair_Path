import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { AnswerReviewDto } from './dto/answer-review.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get(':sessionId')
  async getReview(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.reviewsService.getReview(sessionId, req.user.userId);
  }

  /** One answer, marked straight away and locked. */
  @Post(':sessionId/answer')
  async answer(
    @Param('sessionId') sessionId: string,
    @Body() dto: AnswerReviewDto,
    @Req() req: any,
  ) {
    return this.reviewsService.answer(sessionId, req.user.userId, dto.step, dto.choice);
  }

  /** Finish: built from the answers already given, so there is no body. */
  @Post(':sessionId/submit')
  async submitReview(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.reviewsService.submitReview(sessionId, req.user.userId);
  }

  @Get(':sessionId/result')
  async getResult(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.reviewsService.getResult(sessionId, req.user.userId);
  }
}
