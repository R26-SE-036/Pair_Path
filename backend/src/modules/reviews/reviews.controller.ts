import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get(':sessionId')
  async getReview(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.reviewsService.getReview(sessionId, req.user.userId);
  }

  @Post(':sessionId/submit')
  async submitReview(
    @Param('sessionId') sessionId: string,
    @Body() submitReviewDto: SubmitReviewDto,
    @Req() req: any,
  ) {
    return this.reviewsService.submitReview(sessionId, submitReviewDto, req.user.userId);
  }

  @Get(':sessionId/result')
  async getResult(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.reviewsService.getResult(sessionId, req.user.userId);
  }
}
