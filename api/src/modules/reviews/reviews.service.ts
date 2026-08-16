import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  async getReview(sessionId: string) {
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      include: {
        question: true,
        reviews: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    return session;
  }

  async submitReview(sessionId: string, submitReviewDto: SubmitReviewDto, userId: string) {
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      include: {
        members: true,
        reviews: true,
      },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    if (session.status !== 'COMPLETED') {
      throw new BadRequestException('Session must be completed to submit review');
    }

    // Check if user is a member
    const isMember = session.members.some(m => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this session');
    }

    // Check if already submitted
    const existingReview = session.reviews.find(r => r.userId === userId);
    if (existingReview) {
      throw new BadRequestException('Review already submitted');
    }

    // Calculate score
    const score = this.calculateScore(submitReviewDto.answers);

    const review = await this.prisma.reviewSubmission.create({
      data: {
        sessionId,
        userId,
        answers: submitReviewDto.answers,
        score,
      },
      include: {
        user: true,
      },
    });

    // Tell the partner's results page to refresh — whoever finished first is
    // already sitting on a page that only knows about their own submission.
    this.websocketGateway.notifyReviewSubmitted(sessionId, { userId });

    return review;
  }

  async getResult(sessionId: string) {
    const reviews = await this.prisma.reviewSubmission.findMany({
      where: { sessionId },
      include: {
        user: true,
      },
    });

    if (reviews.length === 0) {
      throw new BadRequestException('No reviews submitted yet');
    }

    const averageScore = reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length;

    return {
      sessionId,
      reviews: reviews.map(review => ({
        userId: review.userId,
        firstName: review.user.firstName,
        lastName: review.user.lastName,
        score: review.score,
      })),
      averageScore,
      recommendations: this.generateRecommendations(averageScore),
    };
  }

  private calculateScore(answers: boolean[]): number {
    return answers.filter(answer => answer).length;
  }

  private generateRecommendations(score: number): string[] {
    if (score >= 9) {
      return ['Excellent performance! Keep up the great work.', 'Consider helping others with pair programming.'];
    } else if (score >= 7) {
      return ['Good performance! Focus on areas for improvement.', 'Practice more complex problems.'];
    } else if (score >= 5) {
      return ['Fair performance. Review the concepts carefully.', 'Consider additional practice sessions.'];
    } else {
      return ['Needs improvement. Review the fundamentals.', 'Seek additional help and practice more.'];
    }
  }
}
