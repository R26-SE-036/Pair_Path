import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
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

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

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

        if (!session) {
          throw new BadRequestException('Invalid join code');
        }
        if (session.status !== 'ACTIVE') {
          throw new BadRequestException('Session is not active');
        }
        if (session.members.some((m) => m.userId === userId)) {
          throw new BadRequestException('Already a member of this session');
        }
        if (session.members.length >= MAX_MEMBERS) {
          throw new BadRequestException('Session is full');
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

  async findByUser(userId: string) {
    return this.prisma.pairSession.findMany({
      where: { members: { some: { userId } } },
      include: {
        question: PUBLIC_QUESTION,
        members: PUBLIC_MEMBERS,
        interventions: { orderBy: { shownAt: 'desc' } },
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
