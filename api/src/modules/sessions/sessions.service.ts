import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { JoinSessionDto } from './dto/join-session.dto';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSessionDto: CreateSessionDto, userId: string) {
    // Generate unique join code
    const joinCode = this.generateJoinCode();

    const session = await this.prisma.pairSession.create({
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
      include: {
        members: {
          include: {
            user: true,
          },
        },
        question: true,
      },
    });

    return session;
  }

  async join(joinSessionDto: JoinSessionDto, userId: string) {
    const session = await this.prisma.pairSession.findUnique({
      where: { joinCode: joinSessionDto.joinCode },
      include: {
        members: true,
      },
    });

    if (!session) {
      throw new BadRequestException('Invalid join code');
    }

    if (session.status !== 'ACTIVE') {
      throw new BadRequestException('Session is not active');
    }

    if (session.members.length >= 2) {
      throw new BadRequestException('Session is full');
    }

    // Check if user is already a member
    const existingMember = session.members.find(m => m.userId === userId);
    if (existingMember) {
      throw new BadRequestException('Already a member of this session');
    }

    // Add user as navigator
    const updatedSession = await this.prisma.pairSession.update({
      where: { id: session.id },
      data: {
        members: {
          create: {
            userId,
            role: 'NAVIGATOR', // Second user becomes navigator
          },
        },
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
        question: true,
      },
    });

    return updatedSession;
  }

  async findById(id: string) {
    return this.prisma.pairSession.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: true,
          },
        },
        question: true,
      },
    });
  }

  async end(sessionId: string, userId: string, finalCode?: string) {
    const session = await this.prisma.pairSession.findUnique({
      where: { id: sessionId },
      include: {
        members: true,
      },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    // Check if user is a member
    const isMember = session.members.some(m => m.userId === userId);
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
      include: {
        members: {
          include: {
            user: true,
          },
        },
        question: true,
      },
    });

    return updatedSession;
  }

  async findByUser(userId: string) {
    return this.prisma.pairSession.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      include: {
        question: true,
        members: {
          include: { user: true },
        },
        interventions: {
          orderBy: { shownAt: 'desc' },
        },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  private generateJoinCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async getAllAnalytics() {
    // Fetch sessions that have predictions (i.e. the seeded ML ones or completed ones)
    return this.prisma.pairSession.findMany({
      where: {
        predictions: {
          some: {}
        }
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        endedAt: true,
        predictions: {
          orderBy: { windowEnd: 'desc' },
          take: 1
        }
      },
      orderBy: {
        startedAt: 'desc'
      }
    });
  }

  async getOneAnalytics(id: string) {
    return this.prisma.pairSession.findUnique({
      where: { id },
      include: {
        question: true,
        events: {
          orderBy: { timestamp: 'asc' }
        },
        predictions: {
          orderBy: { windowStart: 'asc' }
        },
        interventions: {
          orderBy: { shownAt: 'asc' }
        },
        members: {
          include: {
            user: true
          }
        }
      }
    });
  }
}
