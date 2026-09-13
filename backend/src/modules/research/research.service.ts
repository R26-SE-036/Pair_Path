import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';
import {
  CONSENT_DECISIONS,
  RESEARCH_CONSENT_STATEMENT,
  RESEARCH_CONSENT_VERSION,
} from '../../content/research-consent';

/**
 * Whether a student's pair sessions may be used as research data.
 *
 * ======================== WHY THIS DID NOT EXIST ========================
 * Every session writes a behavioural record - edits, runs, chat, the model's
 * readings, the nudges and the responses to them - and the model in models/ is
 * meant to be retrained on it. Nothing ever asked the students whose sessions
 * those are. The record was collected for research by default, with no way to
 * say no and no way to tell, later, whose data could be used.
 * =========================================================================
 *
 * Append-only. The current decision is the most recent row; a withdrawal is a
 * new row, never an edit that erases the agreement before it. An ethics audit
 * asks "what had this person agreed to, and when", and a single mutable flag
 * cannot answer it.
 */
@Injectable()
export class ResearchService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string) {
    const latest = await this.prisma.researchConsent.findFirst({
      where: { userId },
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      select: { decision: true, version: true, decidedAt: true },
    });

    return {
      version: RESEARCH_CONSENT_VERSION,
      statement: RESEARCH_CONSENT_STATEMENT,
      decision: latest?.decision ?? null,
      decidedAt: latest?.decidedAt ?? null,
      // A decision about an earlier statement is a decision about different
      // terms: the page asks again, and the export does not count it.
      current: latest?.version === RESEARCH_CONSENT_VERSION,
    };
  }

  async decide(userId: string, decision: string) {
    // Checked here as well as by the DTO: this is the one write that decides
    // whether someone's data may be used, and it should not depend on a pipe
    // being configured in front of it.
    if (!(CONSENT_DECISIONS as readonly string[]).includes(decision)) {
      throw new BadRequestException('Choose GRANTED or DECLINED.');
    }

    await this.prisma.researchConsent.create({
      data: { userId, decision, version: RESEARCH_CONSENT_VERSION },
    });

    return this.status(userId);
  }
}
