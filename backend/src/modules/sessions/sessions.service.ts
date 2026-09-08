import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { PUBLIC_MEMBERS, PUBLIC_QUESTION } from '../../common/public-select';
import { CreateSessionDto } from './dto/create-session.dto';
import { JoinSessionDto } from './dto/join-session.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';

/** Join codes are read aloud and typed in a hurry, so they stay short. */
const JOIN_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_ATTEMPTS = 5;

/** A pair is two people. */
const MAX_MEMBERS = 2;

/**
 * ==================== WHY SESSIONS EXPIRE ====================
 * A session became COMPLETED only when somebody pressed End. Closing the tab,
 * losing wifi, or simply walking away left the row ACTIVE forever - so the
 * pairing page filled up with sessions offering "Rejoin", every one of them a
 * dead workspace with nobody in it and no way to reach the review step, which
 * requires a completed session.
 *
 * They also poisoned the record: `/pair/analytics` reports duration from
 * startedAt, and an abandoned session accumulates it indefinitely. One in the
 * list had run for 64 hours and 31 minutes.
 *
 * EXPIRED, not COMPLETED, because the difference is the point. A pair that
 * finished and reviewed each other produced evidence; a pair that wandered off
 * produced an abandoned attempt, and a research record that cannot tell them
 * apart is one that quietly counts the second as the first.
 * =============================================================
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;
const EXPIRY_SWEEP_MS = 5 * 60 * 1000;

@Injectable()
export class SessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionsService.name);
  private expirySweep?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  onModuleInit() {
    // Once at startup as well as on the interval: the sessions most in need of
    // this are the ones abandoned before the last restart, and waiting five
    // minutes to notice them serves nobody.
    void this.expireIdleSessions();

    this.expirySweep = setInterval(() => {
      void this.expireIdleSessions();
    }, EXPIRY_SWEEP_MS);

    // Node keeps the process alive for a pending timer. Nothing here is worth
    // delaying a shutdown for.
    this.expirySweep.unref?.();
  }

  onModuleDestroy() {
    if (this.expirySweep) clearInterval(this.expirySweep);
  }

  /**
   * Close ACTIVE sessions that nobody has touched for SESSION_IDLE_MS.
   *
   * Idleness is measured from the last recorded event rather than from
   * startedAt, so a long session that is genuinely being worked on is never
   * closed underneath the pair - every keystroke, note and run writes an
   * event. A session with no events at all falls back to when it started,
   * which covers the common case here: a session created, never joined by a
   * partner, and abandoned at the workspace.
   *
   * Sessions with somebody still connected are skipped even if they have gone
   * quiet, so a pair reading code in silence keeps their workspace. That check
   * only sees this process's own sockets; behind more than one API instance a
   * session held open on another instance would have to fall back to its event
   * recency, which is why the timeout is generous rather than tight.
   */
  async expireIdleSessions(): Promise<number> {
    const cutoff = new Date(Date.now() - SESSION_IDLE_MS);

    const candidates = await this.prisma.pairSession.findMany({
      where: { status: 'ACTIVE', startedAt: { lt: cutoff } },
      select: {
        id: true,
        startedAt: true,
        events: {
          select: { timestamp: true },
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    const stale = candidates.filter((session) => {
      if (this.websocketGateway.hasLiveMembers(session.id)) return false;
      const lastSeen = session.events[0]?.timestamp ?? session.startedAt;
      return lastSeen < cutoff;
    });

    if (stale.length === 0) return 0;

    const ids = stale.map((s) => s.id);

    // updateMany filtered on ACTIVE, so a session that somebody ended in the
    // gap between the read and this write is left alone rather than having its
    // COMPLETED overwritten with EXPIRED.
    const { count } = await this.prisma.pairSession.updateMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      data: { status: 'EXPIRED', endedAt: new Date() },
    });

    if (count > 0) {
      this.logger.log(
        `Expired ${count} session${count === 1 ? '' : 's'} idle for over ` +
          `${SESSION_IDLE_MS / 60000} minutes.`,
      );
      // Anyone still holding a socket on one of these is told, so a forgotten
      // tab stops behaving as though it were live.
      for (const id of ids) this.websocketGateway.notifySessionEnded(id);
    }

    return count;
  }

  /**
   * Refuse unless this student is in this session.
   *
   * ================== WHAT THIS REPLACES ==================
   * Nothing. `GET /sessions/:id`, `/sessions/analytics/:id` and
   * `/sessions/analytics/all` were guarded by JwtAuthGuard and nothing else -
   * so any signed-in student could read any pair's full event log, every
   * message they typed, their final code and every prediction made about them,
   * by changing the id in the URL. Session ids are cuids and not guessable,
   * but `/sessions/analytics/all` listed them.
   *
   * NotFound rather than Forbidden for a session that exists but is not
   * theirs: "you may not see this one" confirms it exists, and there is
   * nothing a student can do with that except learn it.
   * ========================================================
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

  async create(createSessionDto: CreateSessionDto, userId: string) {
    return this.withUniqueJoinCode((joinCode) =>
      this.prisma.pairSession.create({
        data: {
          ...createSessionDto,
          joinCode,
          members: {
            create: {
              userId,
              role: 'DRIVER', // First user becomes driver
            },
          },
        },
        include: { members: PUBLIC_MEMBERS, question: PUBLIC_QUESTION },
      }),
    );
  }

  /**
   * Generate a join code, retrying on collision.
   *
   * `joinCode` is @unique and the code is six random characters, so a
   * collision is rare and was completely unhandled: Prisma raised P2002 and
   * the student saw a 500 with no explanation, on an action that would have
   * succeeded if they pressed the button again. Rare is not never - 36^6 is
   * only about two billion, and the birthday bound bites long before that.
   */
  private async withUniqueJoinCode<T>(attempt: (joinCode: string) => Promise<T>): Promise<T> {
    for (let tries = 1; tries <= JOIN_CODE_ATTEMPTS; tries += 1) {
      try {
        return await attempt(this.generateJoinCode());
      } catch (error) {
        const collided =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!collided || tries === JOIN_CODE_ATTEMPTS) throw error;
        this.logger.warn(`Join code collision, retrying (attempt ${tries})`);
      }
    }
    // Unreachable: the loop either returns or throws.
    throw new Error('Could not allocate a join code');
  }

  /**
   * Add the second student to a session.
   *
   * Serializable, and the count is re-checked inside the transaction. The
   * check-then-write version could seat a third person: two students entering
   * the same code at once both read `members.length === 1`, both passed the
   * check and both inserted. The @@unique([sessionId, userId]) constraint does
   * not help - it stops the same student joining twice, not a third student
   * joining at all - and the result was a "pair" of three with role
   * assignment that no longer means anything.
   */
  async join(joinSessionDto: JoinSessionDto, userId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const session = await tx.pairSession.findUnique({
          where: { joinCode: joinSessionDto.joinCode },
          include: { members: { select: { userId: true } } },
        });

        /*
         * These four strings are shown to a student, verbatim, on the pairing
         * page - so they say what happened and what to do about it. They read
         * as log lines before ("Invalid join code", "Session is full"), which
         * is fine for a log and not an explanation for someone holding a code
         * their partner just read out to them.
         *
         * The status stays 400 in every case: nothing here is a fault, and a
         * join that cannot proceed is not a server error.
         */
        if (!session) {
          throw new BadRequestException(
            'No session has that code. Check it with your partner - codes are six characters.',
          );
        }
        if (session.status !== 'ACTIVE') {
          throw new BadRequestException(
            'That session has already finished. Start a new one to work together again.',
          );
        }
        if (session.members.some((m) => m.userId === userId)) {
          throw new BadRequestException(
            'You are already in this session - reopen it from the list below rather than joining again.',
          );
        }
        if (session.members.length >= MAX_MEMBERS) {
          throw new BadRequestException(
            `That session already has ${MAX_MEMBERS} people in it. Pairing is for two - ask them to start another, or start one yourself.`,
          );
        }

        return tx.pairSession.update({
          where: { id: session.id },
          data: {
            members: {
              create: {
                userId,
                role: 'NAVIGATOR', // Second user becomes navigator
              },
            },
          },
          include: { members: PUBLIC_MEMBERS, question: PUBLIC_QUESTION },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findById(id: string, userId: string) {
    await this.requireMembership(id, userId);

    return this.prisma.pairSession.findUnique({
      where: { id },
      include: { members: PUBLIC_MEMBERS, question: PUBLIC_QUESTION },
    });
  }

  async end(sessionId: string, userId: string, finalCode?: string) {
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      include: { members: { select: { userId: true } } },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    const isMember = session.members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this session');
    }

    const updatedSession = await this.prisma.pairSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        endedAt: new Date(),
        finalCode: finalCode || null,
      },
      include: { members: PUBLIC_MEMBERS, question: PUBLIC_QUESTION },
    });

    // Tell the room, after the row says COMPLETED and not before. Only the
    // student who pressed the button reaches this endpoint; without this the
    // partner was left in a live workspace on a finished session, editing code
    // nobody would read and logging events onto a closed record.
    this.websocketGateway.notifySessionEnded(sessionId);

    return updatedSession;
  }

  /**
   * The sessions this student has been in, for the list on the pairing page.
   *
   * `members` is what lets that list say who each session was with; it was
   * already being returned and simply never rendered, so four attempts at the
   * same question showed as four identical rows.
   *
   * Interventions used to be included here, fully and ordered. Nothing on the
   * page read them - the history view fetches one session for that - so every
   * visit carried every nudge ever shown to this student across every session
   * they had ever been in, to render a list of titles and dates.
   */
  async findByUser(userId: string) {
    return this.prisma.pairSession.findMany({
      where: { members: { some: { userId } } },
      include: {
        question: PUBLIC_QUESTION,
        members: PUBLIC_MEMBERS,
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  private generateJoinCode(): string {
    let code = '';
    for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
      code += JOIN_CODE_ALPHABET.charAt(
        Math.floor(Math.random() * JOIN_CODE_ALPHABET.length),
      );
    }
    return code;
  }

  /**
   * Sessions this student was in that the model has said something about.
   *
   * Scoped to the caller. It used to return every session in the database with
   * a prediction, which on a shared deployment is a list of every pair who has
   * ever used the system - and the ids in it were the way to reach
   * /sessions/analytics/:id for any of them.
   */
  async getAllAnalytics(userId: string) {
    return this.prisma.pairSession.findMany({
      where: {
        predictions: { some: {} },
        members: { some: { userId } },
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        endedAt: true,
        predictions: { orderBy: { windowEnd: 'desc' }, take: 1 },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  async getOneAnalytics(id: string, userId: string) {
    await this.requireMembership(id, userId);

    return this.prisma.pairSession.findUnique({
      where: { id },
      include: {
        question: PUBLIC_QUESTION,
        events: { orderBy: { timestamp: 'asc' } },
        predictions: { orderBy: { windowStart: 'asc' } },
        interventions: { orderBy: { shownAt: 'asc' } },
        members: PUBLIC_MEMBERS,
      },
    });
  }
}
