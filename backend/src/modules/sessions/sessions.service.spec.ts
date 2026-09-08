/**
 * Who may read a session, and how a second student gets into one.
 *
 * Every test here covers something that returned a 200 before. A missing
 * membership check does not throw, does not log, and does not look wrong in a
 * code review - it just answers, to anybody who changes the id in the URL.
 */

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SessionsService } from './sessions.service';

interface Row {
  id: string;
  joinCode: string;
  status: string;
  members: Array<{ userId: string; role: string }>;
  // Only the idle sweep reads these; everything else predates them.
  startedAt?: Date;
  events?: Array<{ timestamp: Date }>;
  endedAt?: Date | null;
}

const MINUTES = 60 * 1000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTES);

/**
 * A Prisma stand-in over an in-memory table.
 *
 * Writes go through the same code paths the service uses, so a join that
 * should have been refused shows up as an extra member here rather than as a
 * passing assertion about a mock's call count.
 */
function fakePrisma(rows: Row[]) {
  const takenJoinCodes = new Set<string>();
  const state = { transactions: 0, isolationLevels: [] as unknown[] };

  const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  const client: any = {
    state,
    takenJoinCodes,

    pairSessionMember: {
      findFirst: async ({ where }: any) => {
        const row = rows.find((r) => r.id === where.sessionId);
        const member = row?.members.find((m) => m.userId === where.userId);
        return member ? { id: `${where.sessionId}:${where.userId}` } : null;
      },
    },

    pairSession: {
      create: async ({ data }: any) => {
        if (takenJoinCodes.has(data.joinCode)) throw uniqueViolation();
        takenJoinCodes.add(data.joinCode);
        const row: Row = {
          id: `s${rows.length + 1}`,
          joinCode: data.joinCode,
          status: 'ACTIVE',
          members: [{ userId: data.members.create.userId, role: data.members.create.role }],
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        rows.find((r) => (where.id ? r.id === where.id : r.joinCode === where.joinCode)) ?? null,
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id)!;
        if (data.members?.create) {
          row.members.push({
            userId: data.members.create.userId,
            role: data.members.create.role,
          });
        }
        if (data.status) row.status = data.status;
        return row;
      },
      // Honours only the two conditions the idle sweep sends. Anything else
      // gets every row, which is what the tests that assert on the `where`
      // argument itself expect.
      findMany: async ({ where }: any = {}) =>
        rows
          .filter((r) => (where?.status ? r.status === where.status : true))
          .filter((r) =>
            where?.startedAt?.lt ? (r.startedAt ?? new Date(0)) < where.startedAt.lt : true,
          )
          .map((r) => ({ ...r, events: r.events ?? [] })),

      updateMany: async ({ where, data }: any) => {
        const matched = rows.filter(
          (r) => where.id.in.includes(r.id) && (!where.status || r.status === where.status),
        );
        matched.forEach((r) => Object.assign(r, data));
        return { count: matched.length };
      },
    },

    $transaction: async (fn: any, options: any) => {
      state.transactions += 1;
      state.isolationLevels.push(options?.isolationLevel);
      return fn(client);
    },
  };

  return client;
}

function make(rows: Row[], live: string[] = []) {
  const prisma = fakePrisma(rows);
  const gateway = {
    notifySessionEnded: jest.fn(),
    // `live` is the set of sessions with somebody still connected.
    hasLiveMembers: jest.fn((id: string) => live.includes(id)),
  };
  return { service: new SessionsService(prisma, gateway as any), prisma, gateway, rows };
}

const OWNED: Row = {
  id: 's1',
  joinCode: 'ABC123',
  status: 'ACTIVE',
  members: [
    { userId: 'me', role: 'DRIVER' },
    { userId: 'partner', role: 'NAVIGATOR' },
  ],
};

const SOMEONE_ELSES: Row = {
  id: 's2',
  joinCode: 'XYZ789',
  status: 'ACTIVE',
  members: [{ userId: 'stranger', role: 'DRIVER' }],
};

describe('reading a session', () => {
  it.each([
    ['findById', (s: SessionsService) => s.findById('s2', 'me')],
    ['getOneAnalytics', (s: SessionsService) => s.getOneAnalytics('s2', 'me')],
  ])('%s refuses a session this student is not in', async (_name, call) => {
    const { service } = make([OWNED, SOMEONE_ELSES]);

    // Previously a 200 carrying the other pair's full event log, every message
    // they typed, their final code, every prediction made about them - and
    // both members' bcrypt hashes.
    await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says "not found" rather than "not allowed"', async () => {
    const { service } = make([OWNED, SOMEONE_ELSES]);

    // Forbidden would confirm the session exists, which is the one thing a
    // stranger could otherwise learn from the response.
    await expect(service.findById('s2', 'me')).rejects.toThrow('Session not found');
  });

  it('allows a session this student is in', async () => {
    const { service } = make([OWNED]);
    await expect(service.findById('s1', 'me')).resolves.toBeTruthy();
    await expect(service.getOneAnalytics('s1', 'partner')).resolves.toBeTruthy();
  });

  it('lists only this student\'s sessions in the analytics index', async () => {
    const { service, prisma } = make([OWNED, SOMEONE_ELSES]);
    const spy = jest.spyOn(prisma.pairSession, 'findMany');

    await service.getAllAnalytics('me');

    // The index used to return every session in the database with a
    // prediction - on a shared deployment, every pair who had ever used the
    // system, with the ids needed to fetch each one.
    expect((spy.mock.calls[0][0] as any).where).toMatchObject({
      members: { some: { userId: 'me' } },
    });
  });
});

describe('joining', () => {
  it('seats the second student as navigator', async () => {
    const rows = [{ ...SOMEONE_ELSES, members: [{ userId: 'stranger', role: 'DRIVER' }] }];
    const { service } = make(rows);

    await service.join({ joinCode: 'XYZ789' }, 'me');

    expect(rows[0].members).toHaveLength(2);
    expect(rows[0].members[1]).toEqual({ userId: 'me', role: 'NAVIGATOR' });
  });

  it('runs inside a serializable transaction', async () => {
    const rows = [{ ...SOMEONE_ELSES, members: [{ userId: 'stranger', role: 'DRIVER' }] }];
    const { service, prisma } = make(rows);

    await service.join({ joinCode: 'XYZ789' }, 'me');

    // The check-then-write version could seat a third person: two students
    // entering the same code at once both read one member, both passed the
    // check and both inserted. @@unique([sessionId, userId]) does not help -
    // it stops the same student joining twice, not a third student joining.
    expect(prisma.state.transactions).toBe(1);
    expect(prisma.state.isolationLevels).toEqual([
      Prisma.TransactionIsolationLevel.Serializable,
    ]);
  });

  it('refuses a third member', async () => {
    const rows = [{ ...OWNED, members: [...OWNED.members] }];
    const { service } = make(rows);

    await expect(service.join({ joinCode: 'ABC123' }, 'third')).rejects.toThrow('Session is full');
    expect(rows[0].members).toHaveLength(2);
  });

  it('refuses a session that has finished', async () => {
    const rows = [{ ...OWNED, status: 'COMPLETED', members: [{ userId: 'me', role: 'DRIVER' }] }];
    const { service } = make(rows);

    await expect(service.join({ joinCode: 'ABC123' }, 'other')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses an unknown code', async () => {
    const { service } = make([OWNED]);
    await expect(service.join({ joinCode: 'NOPE00' }, 'me')).rejects.toThrow('Invalid join code');
  });
});

describe('creating a session', () => {
  it('retries when the generated join code is already taken', async () => {
    const rows: Row[] = [];
    const { service, prisma } = make(rows);

    // Every code the generator can produce, claimed once - so the first
    // attempt always collides and only the retry can succeed.
    const original = prisma.pairSession.create;
    let attempts = 0;
    prisma.pairSession.create = async (args: any) => {
      attempts += 1;
      if (attempts === 1) {
        prisma.takenJoinCodes.add(args.data.joinCode);
      }
      return original(args);
    };

    const session = await service.create({ questionId: 'q1' } as any, 'me');

    // Unhandled, Prisma raised P2002 and the student saw a 500 on an action
    // that would have worked if they pressed the button again.
    expect(attempts).toBe(2);
    expect(session).toBeTruthy();
  });

  it('gives up rather than looping forever', async () => {
    const { service, prisma } = make([]);
    prisma.pairSession.create = async () => {
      throw new Prisma.PrismaClientKnownRequestError('dupe', {
        code: 'P2002',
        clientVersion: 'test',
      });
    };

    await expect(service.create({ questionId: 'q1' } as any, 'me')).rejects.toBeTruthy();
  });

  it('does not retry an error that is not a collision', async () => {
    const { service, prisma } = make([]);
    let calls = 0;
    prisma.pairSession.create = async () => {
      calls += 1;
      throw new Error('database is on fire');
    };

    await expect(service.create({ questionId: 'q1' } as any, 'me')).rejects.toThrow(
      'database is on fire',
    );
    // Retrying a real failure five times turns one error into five, and
    // delays the message the student needs to see.
    expect(calls).toBe(1);
  });
});

describe('ending a session', () => {
  it('tells the room once the row says COMPLETED', async () => {
    const rows = [{ ...OWNED, members: [...OWNED.members] }];
    const { service, gateway } = make(rows);

    await service.end('s1', 'me', 'class A {}');

    expect(rows[0].status).toBe('COMPLETED');
    // Only the student who pressed the button reaches this endpoint. Without
    // the notification the partner sat in a live workspace on a finished
    // session, logging events onto a closed record.
    expect(gateway.notifySessionEnded).toHaveBeenCalledWith('s1');
  });

  it('refuses a student who is not in the session', async () => {
    const rows = [{ ...SOMEONE_ELSES, members: [{ userId: 'stranger', role: 'DRIVER' }] }];
    const { service, gateway } = make(rows);

    await expect(service.end('s2', 'me')).rejects.toThrow('Not a member of this session');
    expect(rows[0].status).toBe('ACTIVE');
    expect(gateway.notifySessionEnded).not.toHaveBeenCalled();
  });
});

describe('expiring abandoned sessions', () => {
  /*
   * A session became COMPLETED only when somebody pressed End, so a closed tab
   * left the row ACTIVE forever: the pairing page offered "Rejoin" into dead
   * workspaces, and `/pair/analytics` kept counting duration from startedAt -
   * one abandoned session had been "running" for 64 hours.
   */
  const abandoned = (id: string, overrides: Partial<Row> = {}): Row => ({
    id,
    joinCode: id.toUpperCase(),
    status: 'ACTIVE',
    members: [{ userId: 'me', role: 'DRIVER' }],
    startedAt: ago(120),
    events: [{ timestamp: ago(90) }],
    ...overrides,
  });

  it('expires a session nobody has touched for over thirty minutes', async () => {
    const rows = [abandoned('s1')];
    const { service, gateway } = make(rows);

    expect(await service.expireIdleSessions()).toBe(1);
    expect(rows[0].status).toBe('EXPIRED');
    expect(rows[0].endedAt).toBeInstanceOf(Date);

    // Anyone still holding a socket is told, so a forgotten tab stops
    // behaving as though the session were live.
    expect(gateway.notifySessionEnded).toHaveBeenCalledWith('s1');
  });

  it('marks it EXPIRED rather than COMPLETED', async () => {
    // The review step requires COMPLETED. Calling an abandoned attempt
    // "completed" would offer a peer-review form for a session that never
    // happened, and would count it as evidence alongside real ones.
    const rows = [abandoned('s1')];
    const { service } = make(rows);

    await service.expireIdleSessions();

    expect(rows[0].status).not.toBe('COMPLETED');
  });

  it('leaves a session alone while somebody is still connected', async () => {
    // A pair reading code in silence produces no events. Closing their
    // workspace underneath them because they stopped typing for half an hour
    // would be worse than the problem being fixed.
    const rows = [abandoned('s1')];
    const { service, gateway } = make(rows, ['s1']);

    expect(await service.expireIdleSessions()).toBe(0);
    expect(rows[0].status).toBe('ACTIVE');
    expect(gateway.notifySessionEnded).not.toHaveBeenCalled();
  });

  it('measures idleness from the last event, not from when it started', async () => {
    // Otherwise a genuinely long session is closed while the pair is working
    // in it - the record then ends in the middle of the collaboration it is
    // supposed to describe.
    const rows = [abandoned('s1', { startedAt: ago(600), events: [{ timestamp: ago(2) }] })];
    const { service } = make(rows);

    expect(await service.expireIdleSessions()).toBe(0);
    expect(rows[0].status).toBe('ACTIVE');
  });

  it('falls back to startedAt for a session with no events at all', async () => {
    // The common case: a session created, never joined by a partner, and
    // abandoned at the workspace before anything was typed.
    const rows = [abandoned('s1', { events: [] })];
    const { service } = make(rows);

    expect(await service.expireIdleSessions()).toBe(1);
    expect(rows[0].status).toBe('EXPIRED');
  });

  it('does not touch a session that has already finished', async () => {
    const rows = [abandoned('s1', { status: 'COMPLETED' })];
    const { service } = make(rows);

    expect(await service.expireIdleSessions()).toBe(0);
    expect(rows[0].status).toBe('COMPLETED');
  });

  it('is quiet when there is nothing to expire', async () => {
    const { service, gateway } = make([OWNED]);

    expect(await service.expireIdleSessions()).toBe(0);
    expect(gateway.notifySessionEnded).not.toHaveBeenCalled();
  });
});
