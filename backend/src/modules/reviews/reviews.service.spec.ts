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
  reviews: Array<{ userId: string; score: number }>;
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
