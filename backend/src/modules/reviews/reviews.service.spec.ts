/**
 * Peer review answers, and the only outcome measure this component has.
 *
 * Two boundaries, both previously absent:
 *
 *   reviews        `getReview` and `getResult` had no membership check, so any
 *                  signed-in student could read another pair's answers and
 *                  scores by changing the id - with both students' password
 *                  hashes attached, because `include: { user: true }` returns
 *                  every scalar on the row.
 *
 *   interventions  `respond` updated on `{ id }` alone. `accepted` is the only
 *                  evidence anyone has about whether these nudges help, which
 *                  is the research question - so a client that can write it
 *                  for a session it is not in can answer that question itself.
 */

import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

import { ReviewsService } from './reviews.service';
import { InterventionsService } from '../interventions/interventions.service';

interface Session {
  id: string;
  status: string;
  members: Array<{ userId: string }>;
  reviews: Array<{ userId: string; score: number; answers?: boolean[] }>;
  question?: { title?: string; description?: string; reviewQuestions?: unknown };
}

function fakePrisma(sessions: Session[], interventions: any[] = []) {
  return {
    interventionUpdates: [] as any[],

    pairSessionMember: {
      findFirst: async ({ where }: any) => {
        const session = sessions.find((s) => s.id === where.sessionId);
        return session?.members.some((m) => m.userId === where.userId)
          ? { id: 'membership' }
          : null;
      },
    },

    pairSession: {
      findUnique: async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null,
    },

    reviewSubmission: {
      findMany: async ({ where }: any) =>
        sessions.find((s) => s.id === where.sessionId)?.reviews.map((r) => ({
          ...r,
          user: { id: r.userId, firstName: 'A', lastName: 'B' },
        })) ?? [],
      create: async ({ data }: any) => {
        sessions.find((s) => s.id === data.sessionId)!.reviews.push(data);
        return { ...data, user: { id: data.userId, firstName: 'A', lastName: 'B' } };
      },
    },

    intervention: {
      updateMany: async ({ where, data }: any) => {
        const matched = interventions.filter(
          (i) => i.id === where.id && i.sessionId === where.sessionId,
        );
        matched.forEach((i) => Object.assign(i, data));
        return { count: matched.length };
      },
      findMany: async ({ where }: any) =>
        interventions.filter((i) => i.sessionId === where.sessionId),
      findUnique: async ({ where }: any) => interventions.find((i) => i.id === where.id) ?? null,
    },
  } as any;
}

const MINE: Session = {
  id: 's1',
  status: 'COMPLETED',
  members: [{ userId: 'me' }, { userId: 'partner' }],
  reviews: [],
};

const THEIRS: Session = {
  id: 's2',
  status: 'COMPLETED',
  members: [{ userId: 'stranger' }],
  reviews: [{ userId: 'stranger', score: 9 }],
};

function reviews(sessions: Session[]) {
  return new ReviewsService(fakePrisma(sessions), { notifyReviewSubmitted: jest.fn() } as any);
}

describe('reading a review', () => {
  it.each([
    ['getReview', (s: ReviewsService) => s.getReview('s2', 'me')],
    ['getResult', (s: ReviewsService) => s.getResult('s2', 'me')],
  ])('%s refuses a session this student is not in', async (_name, call) => {
    await expect(call(reviews([MINE, THEIRS]))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows a member', async () => {
    await expect(reviews([MINE, THEIRS]).getReview('s1', 'partner')).resolves.toBeTruthy();
  });

  it('returns a partner name without the account behind it', async () => {
    const service = reviews([{ ...THEIRS, id: 's3', members: [{ userId: 'me' }] }]);
    const result = await service.getResult('s3', 'me');

    // getResult maps to a fixed shape, so this is really asserting that the
    // shape did not grow. The leak was upstream of it, in what the query
    // returned - which getReview passed through untouched.
    for (const row of result.reviews) {
      expect(Object.keys(row).sort()).toEqual(['firstName', 'lastName', 'score', 'userId']);
    }
  });
});

describe('submitting a review', () => {
  it('refuses a session this student is not in', async () => {
    await expect(
      reviews([MINE, THEIRS]).submitReview('s2', { answers: [true] } as any, 'me'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a second submission from the same student', async () => {
    const mine = { ...MINE, reviews: [{ userId: 'me', score: 3 }] };
    await expect(
      reviews([mine]).submitReview('s1', { answers: [true] } as any, 'me'),
    ).rejects.toThrow('Review already submitted');
  });

  it('refuses while the session is still running', async () => {
    const running = { ...MINE, status: 'ACTIVE', reviews: [] };
    await expect(
      reviews([running]).submitReview('s1', { answers: [true] } as any, 'me'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * The instrument itself.
 *
 * Three things were wrong at once, and together they meant every peer review
 * in the database is a score of 0 recorded against no answers:
 *
 *   - GET /reviews/:sessionId returned a PairSession, while the client reads
 *     `{ questions, alreadySubmitted }`. Neither exists on a session, so the
 *     page rendered an empty form.
 *   - the client sent free text from textareas; the API validates booleans. A
 *     filled-in review was rejected with a 400 and an empty one was accepted.
 *   - the score was the count of `true` answers against prompts all phrased so
 *     that yes was the good answer, which measures agreeableness.
 */
describe('the review instrument', () => {
  const PROMPTS = [
    { prompt: 'Did the loop stop before numbers.length?', expected: true },
    { prompt: 'Did we hit an out-of-bounds error?', expected: false },
    { prompt: 'Did we test the empty case?', expected: true },
  ];

  const withPrompts = (overrides: Partial<Session> = {}): Session => ({
    id: 's1',
    status: 'COMPLETED',
    members: [{ userId: 'me' }, { userId: 'partner' }],
    reviews: [],
    question: { title: 'Sum', description: 'Add them up', reviewQuestions: PROMPTS },
    ...overrides,
  });

  it('sends the prompts in the shape the client reads', async () => {
    const result: any = await reviews([withPrompts()]).getReview('s1', 'me');

    expect(result.questions).toEqual(PROMPTS.map((p) => p.prompt));
    expect(result.alreadySubmitted).toBe(false);
  });

  it('never sends the expected answers', async () => {
    const result: any = await reviews([withPrompts()]).getReview('s1', 'me');

    // Same reason the question is sent without referenceSolution: a form that
    // ships its own answer key is not an instrument.
    expect(JSON.stringify(result)).not.toContain('expected');
    expect(result.questions.every((q: unknown) => typeof q === 'string')).toBe(true);
  });

  it('reports that this student has already answered', async () => {
    const session = withPrompts({
      reviews: [{ userId: 'me', score: 2, answers: [true, false, true] }],
    });

    const result: any = await reviews([session]).getReview('s1', 'me');

    // Without this the page offers the form again and submitting is refused
    // with an error that reads like a fault rather than a fact.
    expect(result.alreadySubmitted).toBe(true);
    expect(result.partnerSubmitted).toBe(false);
  });

  it('scores agreement with what the exercise expected', async () => {
    const session = withPrompts();
    await reviews([session]).submitReview(
      's1',
      { answers: [true, false, true] } as any,
      'me',
    );

    expect(session.reviews[0].score).toBe(3);
  });

  it('does not reward answering yes to everything', async () => {
    const session = withPrompts();
    await reviews([session]).submitReview('s1', { answers: [true, true, true] } as any, 'me');

    // The middle prompt expects `no`. Under the old scoring this was 3/3.
    expect(session.reviews[0].score).toBe(2);
  });

  it('refuses a submission that does not answer every prompt', async () => {
    // A short array used to score as if the unanswered prompts were wrong,
    // which is what an empty one from the broken form did.
    await expect(
      reviews([withPrompts()]).submitReview('s1', { answers: [true] } as any, 'me'),
    ).rejects.toThrow('3 prompts; 1 answers were sent');
  });

  it('refuses an empty submission', async () => {
    await expect(
      reviews([withPrompts()]).submitReview('s1', { answers: [] } as any, 'me'),
    ).rejects.toThrow('3 prompts; 0 answers were sent');
  });

  it('still scores a question seeded before expected answers existed', async () => {
    // Older rows store reviewQuestions as a plain array of strings. Treating
    // those as expecting `true` is exactly the old behaviour, so an existing
    // row keeps the score it always had rather than silently changing.
    const legacy = withPrompts({
      question: { reviewQuestions: ['Did we test it?', 'Did we name things well?'] },
    });

    await reviews([legacy]).submitReview('s1', { answers: [true, false] } as any, 'me');

    expect(legacy.reviews[0].score).toBe(1);
  });

  it('reports how far the two partners agreed with each other', async () => {
    const session = withPrompts({
      reviews: [
        { userId: 'me', score: 3, answers: [true, false, true] },
        { userId: 'partner', score: 2, answers: [true, true, true] },
      ],
    });

    const result: any = await reviews([session]).getResult('s1', 'me');

    // Two partners who agree with the exercise equally often but disagree with
    // EACH OTHER on every prompt used to look identical to two who agreed on
    // everything - and the comparison is the point of answering separately.
    expect(result.agreement).toEqual({ matched: 2, outOf: 3 });
    expect(result.outOf).toBe(3);
  });

  it('has no agreement figure until both have answered', async () => {
    const session = withPrompts({
      reviews: [{ userId: 'me', score: 3, answers: [true, false, true] }],
    });

    const result: any = await reviews([session]).getResult('s1', 'me');

    // It is a property of the pair, not of a submission.
    expect(result.agreement).toBeNull();
  });

  it('advises proportionally rather than against an assumed ten prompts', async () => {
    const session = withPrompts({
      reviews: [{ userId: 'me', score: 3, answers: [true, false, true] }],
    });

    const result: any = await reviews([session]).getResult('s1', 'me');

    // 3 of 3 is a perfect score. The old thresholds were absolute numbers, so
    // a question with six prompts could not reach "excellent" however well the
    // pair did.
    expect(result.recommendations[0]).toMatch(/line up/i);
  });
});

describe('responding to an intervention', () => {
  const rows = () => [
    { id: 'i1', sessionId: 's1', accepted: null },
    { id: 'i2', sessionId: 's2', accepted: null },
  ];

  it('refuses to write into a session this student is not in', async () => {
    const interventions = rows();
    const service = new InterventionsService(fakePrisma([MINE, THEIRS], interventions));

    await expect(service.respond('s2', 'i2', true, 'me')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(interventions[1].accepted).toBeNull();
  });

  it('refuses an intervention id from another session', async () => {
    const interventions = rows();
    const service = new InterventionsService(fakePrisma([MINE, THEIRS], interventions));

    // The student IS in s1, and i2 is a real intervention - just not theirs.
    // Updating on `{ id }` alone made this succeed.
    await expect(service.respond('s1', 'i2', true, 'me')).rejects.toThrow(
      'Intervention not found in this session',
    );
    expect(interventions[1].accepted).toBeNull();
  });

  it('records a response on the student\'s own session', async () => {
    const interventions = rows();
    const service = new InterventionsService(fakePrisma([MINE, THEIRS], interventions));

    await service.respond('s1', 'i1', true, 'me');

    expect(interventions[0].accepted).toBe(true);
  });

  it('refuses to list another session\'s interventions', async () => {
    const service = new InterventionsService(fakePrisma([MINE, THEIRS], rows()));
    await expect(service.findBySession('s2', 'me')).rejects.toBeInstanceOf(NotFoundException);
  });
});
