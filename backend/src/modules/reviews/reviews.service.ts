import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { PUBLIC_USER } from '../../common/public-select';
import { ReviewGeneratorService, ReviewRequest } from './review-generator.service';
import {
  ReviewContent,
  fromQuestionBank,
  markedAnswer,
  modeOf,
  promptsOf,
  readContent,
  runsOf,
  scoredCountOf,
  teamworkOf,
} from './session-review';

// Imported from here by the sessions module.
export { promptsOf } from './session-review';

/**
 * The review after a session ends.
 *
 * ==================== FROM A FORM TO A WALKTHROUGH ====================
 * It was the exercise's fixed yes/no prompts, identical for every pair that
 * ever attempted it. It is now written for the session that happened - the
 * student's own final code, whether it worked, and for a pair how they worked
 * together - by Study Guider's language model, as a few steps that each teach
 * one idea and then ask one multiple-choice question about it.
 *
 * The review is written ONCE per session and stored (SessionReview), so both
 * partners answer the same questions and their agreement still means
 * something. When it cannot be written - Study Guider down, over quota, not
 * configured - the fixed prompts become the steps instead, as Yes/No
 * questions, and that is stored in its place. A student is never left on a
 * spinner, and never shown invented content.
 *
 * Each answer is marked as it is given and locked (ReviewAnswer): the student
 * sees at once whether it was right and why, and cannot then change it. The
 * final submission is built from those locked answers, so the score is the
 * same number the old form produced - answers that match the expected ones -
 * and everything downstream (results page, Code Coach, the research export)
 * reads it unchanged.
 *
 * The expected answers, the explanations and the model solution stay on the
 * server until the student has answered: an explanation arrives with its
 * marked answer, and the solution with the submission.
 * ======================================================================
 */

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

type SessionForRequest = {
  startedAt: Date;
  endedAt: Date | null;
  finalCode: string | null;
  question: {
    title: string;
    description: string;
    difficulty: string;
    conceptTags: unknown;
    starterCode: string;
    referenceSolution: string;
    expectedOutput: string | null;
  } | null;
};

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  /**
   * Reviews being written right now, by session. Both partners reach the page
   * within seconds of each other; this is what stops that costing two model
   * calls. The table's primary key catches the rare case this misses.
   */
  private readonly preparing = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly generator: ReviewGeneratorService,
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
   * Make sure this session has a review, writing it if it has none.
   *
   * Resolves once one is stored. Safe to call as often as the page polls.
   */
  prepare(sessionId: string): Promise<void> {
    let job = this.preparing.get(sessionId);
    if (!job) {
      job = this.writeReview(sessionId).finally(() => this.preparing.delete(sessionId));
      this.preparing.set(sessionId, job);
    }
    return job;
  }

  private async writeReview(sessionId: string): Promise<void> {
    const existing = await this.prisma.sessionReview.findUnique({
      where: { sessionId },
      select: { sessionId: true },
    });
    if (existing) return;

    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      select: {
        startedAt: true,
        endedAt: true,
        finalCode: true,
        members: { select: { userId: true } },
        question: {
          select: {
            title: true,
            description: true,
            difficulty: true,
            conceptTags: true,
            starterCode: true,
            referenceSolution: true,
            expectedOutput: true,
            reviewQuestions: true,
          },
        },
      },
    });
    if (!session) return;

    const mode = modeOf(session.members);
    let content: ReviewContent | null = null;
    let source = 'question_bank';
    let model: string | null = null;

    if (this.generator.configured && session.question) {
      try {
        const written = await this.generator.generate(await this.reviewRequest(sessionId, session, mode));
        content = written.content;
        model = written.model;
        source = 'generated';
      } catch (error) {
        // Logged for whoever runs the platform; the student gets the fixed
        // prompts, which are real content, instead of an error.
        this.logger.warn(
          `Session ${sessionId}: review could not be written, using the exercise's own prompts. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    content ??= fromQuestionBank(promptsOf(session.question?.reviewQuestions));

    try {
      await this.prisma.sessionReview.create({
        data: { sessionId, source, mode, content: content as any, modelVersion: model },
      });
    } catch (error: any) {
      // The partner's request stored one first. Theirs stands, so both answer
      // the same review.
      if (error?.code !== 'P2002') throw error;
    }
  }

  /** What Study Guider is told about the session. Counts, never chat text or names. */
  private async reviewRequest(
    sessionId: string,
    session: SessionForRequest,
    mode: 'solo' | 'pair',
  ): Promise<ReviewRequest> {
    const question = session.question!;
    const runResults = await this.prisma.sessionEvent.findMany({
      where: { sessionId, eventType: 'CODE_RUN_RESULT' },
      select: { metadata: true },
    });
    const { outcome, runs } = runsOf(runResults, question.expectedOutput !== null);

    let teamwork: ReviewRequest['teamwork'] = null;
    if (mode === 'pair') {
      const grouped = await this.prisma.sessionEvent.groupBy({
        by: ['userId', 'role', 'eventType'],
        where: { sessionId },
        _count: { _all: true },
      });
      teamwork = teamworkOf(
        grouped.map((g) => ({ userId: g.userId, role: g.role, eventType: g.eventType, count: g._count._all })),
        session.startedAt,
        session.endedAt,
      );
    }

    const tags = Array.isArray(question.conceptTags)
      ? question.conceptTags.filter((t): t is string => typeof t === 'string').slice(0, 20)
      : [];

    return {
      mode,
      exercise: {
        title: question.title.slice(0, 300),
        description: question.description.slice(0, 6000),
        difficulty: question.difficulty ? question.difficulty.slice(0, 40) : null,
        concept_tags: tags,
        expected_output: question.expectedOutput ? question.expectedOutput.slice(0, 4000) : null,
        reference_solution: question.referenceSolution.slice(0, 20000),
      },
      code: (session.finalCode || question.starterCode || '').slice(0, 20000),
      outcome,
      runs,
      teamwork,
    };
  }

  /** The stored review, read back through the same checks, or the fixed prompts. */
  private contentOf(stored: unknown, reviewQuestions: unknown): ReviewContent {
    return readContent(stored) ?? fromQuestionBank(promptsOf(reviewQuestions));
  }

  /**
   * The review, in the shape the page reads - without its answers.
   *
   * `ready: false` while it is being written; the page polls. The questions
   * go out with their options and nothing else. Answers already given come
   * back marked, so a reload resumes where the student was, and the model
   * solution appears only once this student has submitted.
   */
  async getReview(sessionId: string, userId: string) {
    await this.requireMembership(sessionId, userId);

    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        finalCode: true,
        question: {
          select: {
            title: true,
            description: true,
            starterCode: true,
            referenceSolution: true,
            reviewQuestions: true,
          },
        },
        review: { select: { content: true, mode: true, source: true } },
        reviews: { select: { userId: true } },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const alreadySubmitted = session.reviews.some((r) => r.userId === userId);
    const base = {
      sessionId: session.id,
      status: session.status,
      question: { title: session.question?.title, description: session.question?.description },
      // Without these the page offers the review again to somebody who has
      // already answered, and submitting is refused with an error that reads
      // like a fault rather than a fact.
      alreadySubmitted,
      partnerSubmitted: session.reviews.some((r) => r.userId !== userId),
    };

    if (session.status !== 'COMPLETED') {
      return { ...base, ready: false };
    }

    if (!session.review) {
      // Started here rather than awaited: writing takes several seconds and
      // the page shows that it is happening.
      this.prepare(sessionId).catch((error) =>
        this.logger.error(`Session ${sessionId}: could not store a review. ${error}`),
      );
      return { ...base, ready: false };
    }

    const content = this.contentOf(session.review.content, session.question?.reviewQuestions);
    const given = await this.prisma.reviewAnswer.findMany({
      where: { sessionId, userId },
      select: { step: true, choice: true, correct: true },
      orderBy: { step: 'asc' },
    });

    return {
      ...base,
      ready: true,
      mode: session.review.mode,
      source: session.review.source,
      title: content.title,
      summary: content.summary,
      code: session.finalCode || session.question?.starterCode || '',
      steps: content.steps.map((step) => ({
        teach: step.teach,
        lines: step.lines,
        prompt: step.question.prompt,
        options: step.question.options,
      })),
      reflection: content.reflection,
      answers: given.map((a) => markedAnswer(content, a)),
      solution: alreadySubmitted
        ? { code: session.question?.referenceSolution ?? '', note: content.solutionNote }
        : null,
    };
  }

  /** The completed session and its review, or the reason there is none to answer. */
  private async answerable(sessionId: string, userId: string) {
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        members: { select: { userId: true } },
        reviews: { select: { userId: true } },
        review: { select: { content: true } },
        question: { select: { referenceSolution: true, reviewQuestions: true } },
      },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    if (session.status === 'EXPIRED') {
      // Told apart from "not finished yet", because the remedy is different:
      // there is nothing to wait for and no button to press. The session was
      // closed by the idle sweep after nobody touched it for half an hour.
      throw new BadRequestException(
        'This session expired without being finished, so there is nothing to review.',
      );
    }

    if (session.status !== 'COMPLETED') {
      throw new BadRequestException('Session must be completed to submit review');
    }

    if (!session.members.some((m) => m.userId === userId)) {
      throw new ForbiddenException('Not a member of this session');
    }

    if (session.reviews.some((r) => r.userId === userId)) {
      throw new BadRequestException('Review already submitted');
    }

    if (!session.review) {
      throw new BadRequestException('The review is still being prepared.');
    }

    return { session, content: this.contentOf(session.review.content, session.question?.reviewQuestions) };
  }

  /**
   * Answer one question. Marked at once and locked.
   *
   * Answering the same question again returns the first answer, unchanged:
   * once the explanation has been seen, a second try would not be the
   * student's answer any more.
   */
  async answer(sessionId: string, userId: string, step: number, choice: number) {
    const { content } = await this.answerable(sessionId, userId);

    const scored = content.steps.length;
    const item = step < scored ? content.steps[step].question : content.reflection[step - scored];
    if (!item) {
      throw new BadRequestException(`This review has no question ${step}.`);
    }
    if (choice >= item.options.length) {
      throw new BadRequestException(`Question ${step} has ${item.options.length} options.`);
    }

    const key = { sessionId_userId_step: { sessionId, userId, step } };
    const existing = await this.prisma.reviewAnswer.findUnique({ where: key });
    if (existing) return markedAnswer(content, existing);

    const correct = step < scored ? choice === content.steps[step].question.answer : null;
    try {
      const saved = await this.prisma.reviewAnswer.create({
        data: { sessionId, userId, step, choice, correct },
      });
      return markedAnswer(content, saved);
    } catch (error: any) {
      // A double click raced itself. The first answer stands.
      if (error?.code !== 'P2002') throw error;
      return markedAnswer(content, (await this.prisma.reviewAnswer.findUnique({ where: key }))!);
    }
  }

  /**
   * Finish the review: every scored question answered, score recorded.
   *
   * The teamwork questions are optional. They have no right answer, and a
   * student who does not want to reflect on their partner in writing should
   * not be stopped from finishing.
   */
  async submitReview(sessionId: string, userId: string) {
    const { session, content } = await this.answerable(sessionId, userId);

    const given = await this.prisma.reviewAnswer.findMany({
      where: { sessionId, userId },
      select: { step: true, choice: true, correct: true },
    });
    const byStep = new Map(given.map((a) => [a.step, a]));

    const missing = content.steps.filter((_, index) => !byStep.has(index)).length;
    if (missing > 0) {
      throw new BadRequestException(
        `Answer every question first: ${missing} of ${content.steps.length} still to go.`,
      );
    }

    const choices = content.steps.map((_, index) => byStep.get(index)!.choice);
    const score = content.steps.filter((_, index) => byStep.get(index)!.correct === true).length;

    await this.prisma.reviewSubmission.create({
      data: { sessionId, userId, answers: choices, score },
    });

    // Tell the partner's results page to refresh — whoever finished first is
    // already sitting on a page that only knows about their own submission.
    this.websocketGateway.notifyReviewSubmitted(sessionId, { userId });

    return {
      score,
      outOf: content.steps.length,
      solution: { code: session.question?.referenceSolution ?? '', note: content.solutionNote },
    };
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

  /** Out of how many scored questions, so a percentage means something. */
  async promptCount(sessionId: string): Promise<number> {
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      select: {
        review: { select: { content: true } },
        question: { select: { reviewQuestions: true } },
      },
    });
    return scoredCountOf(session?.review?.content, session?.question?.reviewQuestions);
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
