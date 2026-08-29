import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `codeCoachUserId` is deliberately NOT part of CreateUserDto. It is an
   * internal field set by AuthService after an identity has actually been
   * verified against Code Coach — if it were on the DTO, a client could post
   * it to /auth/register and bind their account to someone else's identity.
   */
  async create(createUserDto: CreateUserDto & { codeCoachUserId?: string }) {
    return this.prisma.user.create({
      data: createUserDto,
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  /** Look up the local account linked to a Code Coach identity. */
  async findByCodeCoachId(codeCoachUserId: string) {
    return this.prisma.user.findUnique({
      where: { codeCoachUserId },
    });
  }

  /**
   * Attach a Code Coach identity to an existing local account, so a user who
   * already had a PairPath login keeps the same row — and therefore the same
   * session history — after the two systems are connected.
   */
  async linkCodeCoachId(id: string, codeCoachUserId: string) {
    return this.prisma.user.update({
      where: { id },
      data: { codeCoachUserId },
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
    });
  }
}
