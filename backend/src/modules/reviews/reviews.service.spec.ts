/**
 * The review after a session: who may read it, how it is written, and how it
 * is answered and scored.
 *
 * The boundary first. `getReview` and `getResult` once had no membership
 * check, so any signed-in student could read another pair's answers and scores
 * by changing the id - with both students' password hashes attached, because
 * `include: { user: true }` returns every scalar on the row.
 *
 * Then the walkthrough: written once per session by Study Guider (faked here),
 * falling back to the exercise's fixed prompts, answered one question at a
 * time with each answer locked, and scored from those locked answers.
 */

import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

import { ReviewsService } from './reviews.service';
import { ReviewContent } from './session-review';

interface Session {
  id: string;
  status: string;
  startedAt?: Date;
  endedAt?: Date | null;
  finalCode?: string | null;
  members: Array<{ userId: string }>;
  reviews: Array<{ userId: string; score: number; answers?: unknown[] }>;
  question?: Record<string, unknown>;
  review?: { content: unknown; mode: string; source: string } | null;
  events?: Array<{ userId: string; role: string; eventType: string; metadata?: unknown }>;
}

interface Answer {
  sessionId: string;
  userId: string;
  step: number;
  choice: number;
  correct: boolean | null;
}

function fakePrisma(sessions: Session[], answers: Answer[] = []) {
  const find = (id: string) => sessions.find((s) => s.id === id);
  const sameKey = (a: Answer, key: any) =>
    a.sessionId === key.sessionId && a.userId === key.userId && a.step === key.step;

  return {
    pairSessionMember: {
      findFirst: async ({ where }: any) =>
        find(where.sessionId)?.members.some((m) => m.userId === where.userId) ? { id: 'membership' } : null,
    },

    pairSession: {
      findUnique: async ({ where }: any) => {
        const s = find(where.id);
        return s ? { review: null, startedAt: new Date(0), endedAt: null, ...s } : null;
      },
    },

    sessionReview: {
      findUnique: async ({ where }: any) => (find(where.sessionId)?.review ? { sessionId: where.sessionId } : null),
      create: async ({ data }: any) => {
        const s = find(data.sessionId)!;
        if (s.review) throw Object.assign(new Error('unique'), { code: 'P2002' });
        s.review = { content: data.content, mode: data.mode, source: data.source };
        return data;
      },
    },

    sessionEvent: {
      findMany: async ({ where }: any) =>
        (find(where.sessionId)?.events ?? []).filter((e) => e.eventType === where.eventType),
      groupBy: async ({ where }: any) => {
        const counts = new Map<string, any>();
        for (const e of find(where.sessionId)?.events ?? []) {
          const key = `${e.userId}|${e.role}|${e.eventType}`;
          const row = counts.get(key) ?? { userId: e.userId, role: e.role, eventType: e.eventType, _count: { _all: 0 } };
          row._count._all += 1;
          counts.set(key, row);
        }
        return [...counts.values()];
      },
    },

    reviewAnswer: {
      findUnique: async ({ where }: any) => answers.find((a) => sameKey(a, where.sessionId_userId_step)) ?? null,
      findMany: async ({ where }: any) =>
        answers.filter((a) => a.sessionId === where.sessionId && a.userId === where.userId),
      create: async ({ data }: any) => {
        answers.push(data);
        return data;
      },
    },

    reviewSubmission: {
      findMany: async ({ where }: any) =>
        find(where.sessionId)?.reviews.map((r) => ({
          ...r,
          user: { id: r.userId, firstName: 'A', lastName: 'B' },
        })) ?? [],
      create: async ({ data }: any) => {
        find(data.sessionId)!.reviews.push(data);
        return data;
      },
    },
  } as any;
}

const WRITTEN: ReviewContent = {
  title: 'Why the countdown printed nothing',
  summary: 'You ran it three times and nothing printed.',
  steps: [
    {
      teach: 'The loop checks `i <= 0` first.',
      lines: [3, 3],
      question: { prompt: 'Is `10 <= 0` true?', options: ['true', 'false', 'error'], answer: 1, explanation: '10 is bigger.' },
    },
    {
      teach: 'So the body never runs.',
      lines: [3, 5],
      question: { prompt: 'How many passes?', options: ['0', '1', '10'], answer: 0, explanation: 'False at once.' },
    },
  ],
  reflection: [{ prompt: 'Who typed most?', options: ['One of us', 'Even', 'Not sure'] }],
  solutionNote: 'It counts down with `i--`.',
};

const PROMPTS = [
  { prompt: 'Did the loop stop before numbers.length?', expected: true },
  { prompt: 'Did we hit an out-of-bounds error?', expected: false },
];

const QUESTION = {
  title: 'Countdown',
  description: 'Print 10 down to 1.',
  difficulty: 'BEGINNER',
  conceptTags: ['loop_boundaries'],
  starterCode: 'class Main {}',
  referenceSolution: 'for (int i = 10; i >= 1; i--)',
  expectedOutput: '10\n9',
  reviewQuestions: PROMPTS,
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    status: 'COMPLETED',
    finalCode: 'for (int i = 10; i <= 0; i++)',
    members: [{ userId: 'me' }, { userId: 'partner' }],
    reviews: [],
    question: QUESTION,
    review: null,
    events: [],
    ...overrides,
  };
}

function generatorThat(behaviour: 'writes' | 'fails' | 'unconfigured') {
  return {
    configured: behaviour !== 'unconfigured',
    generate: jest.fn(async () => {
      if (behaviour === 'fails') throw new Error('Study Guider is down');
      return { content: WRITTEN, model: 'gemini-test' };
    }),
  };
}

function reviews(sessions: Session[], generator = generatorThat('writes'), answers: Answer[] = []) {
  const ws = { notifyReviewSubmitted: jest.fn() };
  const service = new ReviewsService(fakePrisma(sessions, answers), ws as any, generator as any);
  return { service, generator, ws, answers };
}

const written = (overrides: Partial<Session> = {}) =>
  session({ review: { content: WRITTEN, mode: 'pair', source: 'generated' }, ...overrides });

describe('who may read a review', () => {
  const theirs = session({ id: 's2', members: [{ userId: 'stranger' }], reviews: [{ userId: 'stranger', score: 1 }] });

  it.each([
    ['getReview', (s: ReviewsService) => s.getReview('s2', 'me')],
    ['getResult', (s: ReviewsService) => s.getResult('s2', 'me')],
  ])('%s refuses a session this student is not in', async (_name, call) => {
    await expect(call(reviews([theirs]).service)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a partner name without the account behind it', async () => {
    const result = await reviews([{ ...theirs, members: [{ userId: 'me' }] }]).service.getResult('s2', 'me');
    for (const row of result.reviews) {
      expect(Object.keys(row).sort()).toEqual(['firstName', 'lastName', 'score', 'userId']);
    }
  });
});

describe('writing the review', () => {
  it('is written once and stored, however many times the page asks', async () => {
    const s = session();
    const { service, generator } = reviews([s]);

    await Promise.all([service.prepare('s1'), service.prepare('s1'), service.prepare('s1')]);
    await service.prepare('s1');

    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(s.review).toMatchObject({ source: 'generated', mode: 'pair' });
  });

  it('tells Study Guider about the session in counts, not chat or names', async () => {
    const s = session({
      events: [
        { userId: 'me', role: 'DRIVER', eventType: 'CODE_EDIT' },
        { userId: 'me', role: 'DRIVER', eventType: 'CODE_EDIT' },
        { userId: 'me', role: 'DRIVER', eventType: 'CODE_EDIT' },
        { userId: 'partner', role: 'NAVIGATOR', eventType: 'CODE_EDIT' },
        { userId: 'partner', role: 'NAVIGATOR', eventType: 'DISCUSSION_NOTE', metadata: '{"text":"private words"}' },
        { userId: 'me', role: 'DRIVER', eventType: 'CODE_RUN_RESULT', metadata: '{"success":true,"correct":false}' },
      ],
    });
    const { service, generator } = reviews([s]);

    await service.prepare('s1');
    const request = (generator.generate.mock.calls[0] as any[])[0];

    expect(request.mode).toBe('pair');
    expect(request.outcome).toBe('unsolved');
    expect(request.code).toBe('for (int i = 10; i <= 0; i++)');
    expect(request.teamwork).toMatchObject({ chat_messages: 1, edits_by_driver: 3, busiest_partner_edit_percent: 75 });
    expect(JSON.stringify(request)).not.toContain('private words');
    expect(JSON.stringify(request)).not.toMatch(/"(me|partner)"/);
  });

  it('is a solo review with no teamwork when nobody joined', async () => {
    const s = session({ members: [{ userId: 'me' }] });
    const { service, generator } = reviews([s]);

    await service.prepare('s1');

    const request = (generator.generate.mock.calls[0] as any[])[0];
    expect(request.mode).toBe('solo');
    expect(request.teamwork).toBeNull();
  });

  it.each(['fails', 'unconfigured'] as const)(
    'falls back to the exercise prompts when Study Guider %s',
    async (behaviour) => {
      const s = session();
      await reviews([s], generatorThat(behaviour)).service.prepare('s1');

      const content = s.review!.content as ReviewContent;
      expect(s.review!.source).toBe('question_bank');
      expect(content.steps.map((step) => step.question.options)).toEqual([['Yes', 'No'], ['Yes', 'No']]);
      // The second prompt expects "no".
      expect(content.steps.map((step) => step.question.answer)).toEqual([0, 1]);
    },
  );
});

describe('reading the review', () => {
  it('is not ready until written, and starts writing it', async () => {
    const s = session();
    const { service } = reviews([s]);

    const first: any = await service.getReview('s1', 'me');
    expect(first.ready).toBe(false);

    await service.prepare('s1');
    const second: any = await service.getReview('s1', 'me');
    expect(second.ready).toBe(true);
    expect(second.steps).toHaveLength(2);
  });

  it('never sends an answer, an explanation or the solution before they are earned', async () => {
    const result: any = await reviews([written()]).service.getReview('s1', 'me');
    const sent = JSON.stringify(result);

    expect(sent).not.toContain('10 is bigger.');
    expect(sent).not.toContain('i >= 1; i--');
    expect(result.steps[0]).toEqual({
      teach: 'The loop checks `i <= 0` first.',
      lines: [3, 3],
      prompt: 'Is `10 <= 0` true?',
      options: ['true', 'false', 'error'],
    });
    expect(result.solution).toBeNull();
  });

  it('is not offered for a session still running', async () => {
    const result: any = await reviews([session({ status: 'ACTIVE' })]).service.getReview('s1', 'me');
    expect(result.ready).toBe(false);
  });
});

describe('answering', () => {
  it('marks an answer at once and explains it', async () => {
    const { service } = reviews([written()]);

    await expect(service.answer('s1', 'me', 0, 0)).resolves.toEqual({
      step: 0,
      choice: 0,
      correct: false,
      answer: 1,
      explanation: '10 is bigger.',
    });
  });

  it('locks an answer: a second try returns the first', async () => {
    const { service } = reviews([written()]);

    await service.answer('s1', 'me', 0, 0);
    const again = await service.answer('s1', 'me', 0, 1);

    expect(again.choice).toBe(0);
    expect(again.correct).toBe(false);
  });

  it('leaves the teamwork questions unmarked', async () => {
    const result = await reviews([written()]).service.answer('s1', 'me', 2, 1);
    expect(result).toMatchObject({ step: 2, choice: 1, correct: null, answer: null });
  });

  it.each([
    ['a question that does not exist', 3, 0],
    ['an option that does not exist', 0, 3],
  ])('refuses %s', async (_name, step, choice) => {
    await expect(reviews([written()]).service.answer('s1', 'me', step, choice)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses before the review exists', async () => {
    await expect(reviews([session()]).service.answer('s1', 'me', 0, 0)).rejects.toThrow('still being prepared');
  });
});

describe('submitting', () => {
  it('refuses a session this student is not in', async () => {
    await expect(reviews([written({ members: [{ userId: 'partner' }] })]).service.submitReview('s1', 'me')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a second submission', async () => {
    await expect(
      reviews([written({ reviews: [{ userId: 'me', score: 1 }] })]).service.submitReview('s1', 'me'),
    ).rejects.toThrow('Review already submitted');
  });

  it('refuses while the session is still running', async () => {
    await expect(reviews([written({ status: 'ACTIVE' })]).service.submitReview('s1', 'me')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses until every scored question is answered', async () => {
    const { service } = reviews([written()]);
    await service.answer('s1', 'me', 0, 1);

    await expect(service.submitReview('s1', 'me')).rejects.toThrow('1 of 2 still to go');
  });

  it('scores the locked answers and then reveals the solution', async () => {
    const s = written();
    const { service, ws } = reviews([s]);
    await service.answer('s1', 'me', 0, 1); // right
    await service.answer('s1', 'me', 1, 2); // wrong

    const result = await service.submitReview('s1', 'me');

    expect(result).toEqual({
      score: 1,
      outOf: 2,
      solution: { code: 'for (int i = 10; i >= 1; i--)', note: 'It counts down with `i--`.' },
    });
    expect(s.reviews[0]).toMatchObject({ userId: 'me', answers: [1, 2], score: 1 });
    expect(ws.notifyReviewSubmitted).toHaveBeenCalledWith('s1', { userId: 'me' });

    const after: any = await service.getReview('s1', 'me');
    expect(after.alreadySubmitted).toBe(true);
    expect(after.solution.code).toContain('i--');
  });

  it('does not reward answering yes to everything on the fixed prompts', async () => {
    const s = session();
    const { service } = reviews([s], generatorThat('unconfigured'));
    await service.prepare('s1');
    await service.answer('s1', 'me', 0, 0);
    await service.answer('s1', 'me', 1, 0);

    // The second prompt expects "no". Under the old scoring this was 2/2.
    expect((await service.submitReview('s1', 'me')).score).toBe(1);
  });

  it('still scores a question seeded before expected answers existed', async () => {
    const s = session({ question: { ...QUESTION, reviewQuestions: ['Did we test it?', 'Did we name things well?'] } });
    const { service } = reviews([s], generatorThat('unconfigured'));
    await service.prepare('s1');
    await service.answer('s1', 'me', 0, 0);
    await service.answer('s1', 'me', 1, 1);

    expect((await service.submitReview('s1', 'me')).score).toBe(1);
  });
});

describe('results', () => {
  it('reports how far the two partners agreed with each other, out of the written questions', async () => {
    const s = written({
      reviews: [
        { userId: 'me', score: 2, answers: [1, 0] },
        { userId: 'partner', score: 1, answers: [1, 2] },
      ],
    });

    const result: any = await reviews([s]).service.getResult('s1', 'me');

    expect(result.agreement).toEqual({ matched: 1, outOf: 2 });
    expect(result.outOf).toBe(2);
  });

  it('has no agreement figure until both have answered', async () => {
    const s = written({ reviews: [{ userId: 'me', score: 2, answers: [1, 0] }] });
    expect(((await reviews([s]).service.getResult('s1', 'me')) as any).agreement).toBeNull();
  });

  it('advises proportionally rather than against an assumed ten prompts', async () => {
    const s = written({ reviews: [{ userId: 'me', score: 2, answers: [1, 0] }] });
    const result: any = await reviews([s]).service.getResult('s1', 'me');
    expect(result.recommendations[0]).toMatch(/line up/i);
  });
});
