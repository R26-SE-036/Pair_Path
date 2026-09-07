import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { PUBLIC_QUESTION, PUBLIC_USER } from '../../common/public-select';

/**
 * A review prompt and the answer a pair who did the exercise well would give.
 *
 * `expected` is not always true. The old prompts were all phrased so that yes
 * was the good answer and scored as the count of yes answers, which measures
 * willingness to tick boxes rather than what happened in the session. See
 * prisma/question-bank.ts.
 */
interface ReviewPrompt {
  prompt: string;
  expected: boolean;
}

/**
 * Read the prompts off a question, in either shape.
 *
 * Questions seeded before `expected` existed store a plain array of strings.
 * Those are treated as expecting `true`, which is exactly the old scoring - so
 * an old row keeps the score it always had rather than silently changing.
 */
function promptsOf(reviewQuestions: unknown): ReviewPrompt[] {
  if (!Array.isArray(reviewQuestions)) return [];

  return reviewQuestions.flatMap((entry) => {
    if (typeof entry === 'string') return [{ prompt: entry, expected: true }];
    if (entry && typeof entry === 'object' && 'prompt' in entry) {
      const row = entry as { prompt: unknown; expected?: unknown };
      return typeof row.prompt === 'string'
        ? [{ prompt: row.prompt, expected: row.expected !== false }]
        : [];
    }
    return [];
  });
}

/** How many answers agree with what the exercise expected. */
function scoreAgainst(answers: boolean[], prompts: ReviewPrompt[]): number {
  return prompts.reduce(
    (total, prompt, index) => total + (answers[index] === prompt.expected ? 1 : 0),
    0,
  );
}

/**
 * How often the two partners gave the same answer, once both have submitted.
 *
 * Null for one submission - it is a property of the pair, not of a student.
 */
function agreementBetween(
  reviews: Array<{ answers: unknown }>,
): { matched: number; outOf: number } | null {
  if (reviews.length !== 2) return null;

  const [first, second] = reviews.map((r) => (Array.isArray(r.answers) ? r.answers : []));
  const outOf = Math.min(first.length, second.length);
  if (outOf === 0) return null;

  let matched = 0;
  for (let i = 0; i < outOf; i += 1) {
    if (first[i] === second[i]) matched += 1;
  }
  return { matched, outOf };
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  /**
   * Refuse unless this student is in this session.
   *
   * getReview and getResult had no check at all: any signed-in student could
   * read another pair's review answers and scores by changing the id. And
   * because `include: { user: true }` returns every scalar on the users row,
   * the response carried both students' bcrypt hashes with them.
   *
   * NotFound rather than Forbidden - "you may not see this one" confirms the
   * session exists, which is the one thing a stranger could learn from it.
   */
  private async requireMembership(sessionId: string, userId: string) {
    const membership = await this.prisma.pairSessionMember.findFirst({
      where: { sessionId, userId },
      select: { id: true },
    });
    if (!membership) {
      throw new NotFoundException('Session not found');
    }
  }

  /**
   * The review form, in the shape the client actually reads.
   *
   * ==================== WHY THIS IS NOT A SESSION ====================
   * It used to return the whole PairSession. The client reads
   * `{ questions, alreadySubmitted }` off the response - neither of which a
   * session has - so `questions` was undefined, the page rendered an empty
   * form, and pressing Submit sent an empty array. Every peer review in the
   * database is therefore a score of 0 recorded against no answers, and
   * nothing anywhere reported a problem: the request succeeded, the row was
   * written, and generateRecommendations dutifully advised "needs improvement".
   *
   * The prompts are sent WITHOUT their expected answers, for the same reason
   * the question is sent without referenceSolution.
   * ===================================================================
   */
  async getReview(sessionId: string, userId: string) {
    await this.requireMembership(sessionId, userId);

    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      include: {
        question: PUBLIC_QUESTION,
        reviews: { select: { userId: true } },
      },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    return {
      sessionId: session.id,
      status: session.status,
      question: {
        title: session.question?.title,
        description: session.question?.description,
      },
      questions: promptsOf(session.question?.reviewQuestions).map((p) => p.prompt),
      // Without this the page offers the form again to somebody who has
      // already answered, and submitting is refused with an error that reads
      // like a fault rather than a fact.
      alreadySubmitted: session.reviews.some((r) => r.userId === userId),
      partnerSubmitted: session.reviews.some((r) => r.userId !== userId),
    };
  }

  async submitReview(sessionId: string, submitReviewDto: SubmitReviewDto, userId: string) {
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      include: {
        members: true,
        reviews: true,
        question: { select: { reviewQuestions: true } },
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

    const prompts = promptsOf(
      (session as { question?: { reviewQuestions?: unknown } }).question?.reviewQuestions,
    );

    // One answer per prompt, in order. A short array would silently score as
    // if the unanswered prompts had been got wrong, and a long one means the
    // client is answering something this question does not ask.
    if (submitReviewDto.answers.length !== prompts.length) {
      throw new BadRequestException(
        `This review has ${prompts.length} prompts; ${submitReviewDto.answers.length} answers were sent.`,
      );
    }

    const score = scoreAgainst(submitReviewDto.answers, prompts);

    const review = await this.prisma.reviewSubmission.create({
      data: {
        sessionId,
        userId,
        answers: submitReviewDto.answers,
        score,
      },
      include: {
        user: { select: PUBLIC_USER },
      },
    });

    // Tell the partner's results page to refresh — whoever finished first is
    // already sitting on a page that only knows about their own submission.
    this.websocketGateway.notifyReviewSubmitted(sessionId, { userId });

    return review;
  }

  async getResult(sessionId: string, userId: string) {
    await this.requireMembership(sessionId, userId);

    const reviews = await this.prisma.reviewSubmission.findMany({
      where: { sessionId },
      include: {
        user: { select: PUBLIC_USER },
      },
    });

    if (reviews.length === 0) {
      throw new BadRequestException('No reviews submitted yet');
    }

    const averageScore = reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length;

    // Out of how many. The thresholds below used to be absolute numbers
    // against an assumed ten prompts, so a question with six could not reach
    // "excellent" however well the pair did - and one with twenty would reach
    // it while agreeing with under half.
    const outOf = await this.promptCount(sessionId);

    return {
      sessionId,
      reviews: reviews.map((review) => ({
        userId: review.userId,
        firstName: review.user.firstName,
        lastName: review.user.lastName,
        score: review.score,
      })),
      averageScore,
      outOf,
      /*
       * Whether the two students SAW THE SAME SESSION.
       *
       * The point of a peer review answered independently is the comparison,
       * and only the scores were being reported - so two partners who agreed
       * with the exercise equally often but disagreed with each other about
       * every single prompt looked identical to two who agreed on everything.
       * Null until both have submitted, because it is not a property of one
       * submission.
       */
      agreement: agreementBetween(reviews),
      recommendations: this.generateRecommendations(averageScore, outOf),
    };
  }

  /** Out of how many prompts, so a percentage means something. */
  async promptCount(sessionId: string): Promise<number> {
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      select: { question: { select: { reviewQuestions: true } } },
    });
    return promptsOf(session?.question?.reviewQuestions).length;
  }

  /** Proportional, so the advice does not depend on how many prompts a question has. */
  private generateRecommendations(score: number, outOf: number): string[] {
    if (outOf === 0) {
      return ['This exercise has no review prompts attached to it.'];
    }

    const share = score / outOf;

    if (share >= 0.9) {
      return [
        'Your answers line up with how the exercise is meant to go.',
        'Try one of the intermediate exercises next.',
      ];
    }
    if (share >= 0.7) {
      return [
        'Mostly on track. Look back at the prompts you and your partner answered differently.',
        'Practise the same concept once more before moving on.',
      ];
    }
    if (share >= 0.5) {
      return [
        'Worth revisiting this concept together before the next exercise.',
        'Read the prompts again and talk through the ones you were unsure about.',
      ];
    }
    return [
      'Work through this concept again — the lesson for it is in Study.',
      'Try the exercise a second time and narrow down where it first went wrong.',
    ];
  }
}
