/**
 * A student's research-consent decision.
 *
 * The cases that matter are the ones an audit would ask about: what counts as
 * the current decision, that withdrawing never erases the agreement before it,
 * and that agreeing to one statement is not agreeing to the next.
 */

import { BadRequestException } from '@nestjs/common';

import { RESEARCH_CONSENT_VERSION } from '../../content/research-consent';
import { ResearchService } from './research.service';

interface Row {
  id: string;
  userId: string;
  decision: string;
  version: string;
  decidedAt: Date;
}

function fakePrisma(rows: Row[] = []) {
  let clock = Date.parse('2026-09-14T09:00:00.000Z');
  return {
    rows,
    researchConsent: {
      findFirst: async ({ where }: any) =>
        rows
          .filter((row) => row.userId === where.userId)
          .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime() || b.id.localeCompare(a.id))[0] ??
        null,
      create: async ({ data }: any) => {
        clock += 1000;
        const row = { id: `c${rows.length + 1}`, decidedAt: new Date(clock), ...data };
        rows.push(row);
        return row;
      },
    },
  };
}

describe('research consent', () => {
  it('starts undecided, not agreed', async () => {
    const service = new ResearchService(fakePrisma() as any);

    const status = await service.status('me');

    expect(status.decision).toBeNull();
    expect(status.current).toBe(false);
    expect(status.version).toBe(RESEARCH_CONSENT_VERSION);
  });

  it('records an agreement against the statement the student was shown', async () => {
    const prisma = fakePrisma();
    const service = new ResearchService(prisma as any);

    const status = await service.decide('me', 'GRANTED');

    expect(status).toMatchObject({ decision: 'GRANTED', current: true });
    expect(prisma.rows[0]).toMatchObject({ userId: 'me', version: RESEARCH_CONSENT_VERSION });
  });

  it('keeps the earlier agreement when a student withdraws', async () => {
    // A mutable flag would overwrite it, and then nobody could say what this
    // student had agreed to at the time an earlier export was made.
    const prisma = fakePrisma();
    const service = new ResearchService(prisma as any);

    await service.decide('me', 'GRANTED');
    const status = await service.decide('me', 'DECLINED');

    expect(status.decision).toBe('DECLINED');
    expect(prisma.rows.map((row) => row.decision)).toEqual(['GRANTED', 'DECLINED']);
  });

  it('does not treat agreement to an earlier statement as current', async () => {
    const prisma = fakePrisma([
      {
        id: 'c1',
        userId: 'me',
        decision: 'GRANTED',
        version: 'an-older-statement',
        decidedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const service = new ResearchService(prisma as any);

    const status = await service.status('me');

    expect(status.decision).toBe('GRANTED');
    expect(status.current).toBe(false);
  });

  it("never reads another student's decision", async () => {
    const prisma = fakePrisma();
    const service = new ResearchService(prisma as any);

    await service.decide('someone-else', 'GRANTED');

    expect((await service.status('me')).decision).toBeNull();
  });

  it('refuses anything but a clear yes or no, and writes nothing', async () => {
    const prisma = fakePrisma();
    const service = new ResearchService(prisma as any);

    await expect(service.decide('me', 'MAYBE')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.rows).toHaveLength(0);
  });
});
