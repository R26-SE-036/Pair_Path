import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * Reading back what the engine decided to show, and whether it landed.
 *
 * ==================== WHAT WAS REMOVED ====================
 * `create()` and its POST /interventions endpoint. Any signed-in student could
 * write a row into the interventions table for any session - inventing a nudge
 * that was never shown, attributing it to a state the model never predicted,
 * and marking it accepted. Nothing distinguished those rows from real ones.
 *
 * The table is not a general-purpose log. Every row is supposed to be a
 * decision the engine made and delivered, and `accepted` is the only evidence
 * anyone has about whether these interventions help - which is the research
 * question. A client that can write to it can answer that question by itself.
 *
 * Interventions are created in exactly one place now: the gateway, after the
 * confidence gate and the cooldown, at the moment one is actually sent.
 * ==========================================================
 */
@Injectable()
export class InterventionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Refuse unless this student is in this session. */
  private async requireMembership(sessionId: string, userId: string) {
    const membership = await this.prisma.pairSessionMember.findFirst({
      where: { sessionId, userId },
      select: { id: true },
    });
    if (!membership) {
      throw new NotFoundException('Session not found');
    }
  }

  async findBySession(sessionId: string, userId: string) {
    await this.requireMembership(sessionId, userId);

    return this.prisma.intervention.findMany({
      where: { sessionId },
      orderBy: { shownAt: 'desc' },
    });
  }

  /**
   * Record whether the pair found an intervention useful.
   *
   * Scoped by session as well as id. It used to update on `{ id }` alone, so a
   * student in one session could mark an intervention in someone else's as
   * helpful or dismissed - writing into the only outcome measure this
   * component has, for a nudge they never saw.
   */
  async respond(sessionId: string, id: string, accepted: boolean, userId: string) {
    await this.requireMembership(sessionId, userId);

    const result = await this.prisma.intervention.updateMany({
      where: { id, sessionId },
      data: { accepted },
    });

    if (result.count === 0) {
      throw new NotFoundException('Intervention not found in this session');
    }

    return this.prisma.intervention.findUnique({ where: { id } });
  }
}
