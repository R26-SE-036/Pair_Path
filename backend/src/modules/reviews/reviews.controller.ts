import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Request } from 'express';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get(':sessionId')
  async getReview(@Param('sessionId') sessionId: string) {
    return this.reviewsService.getReview(sessionId);
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
  async getResult(@Param('sessionId') sessionId: string) {
    return this.reviewsService.getResult(sessionId);
  }
}
