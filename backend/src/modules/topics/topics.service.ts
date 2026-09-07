import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { PUBLIC_QUESTION } from '../../common/public-select';

/**
 * Read-only. `include: { questions: true }` carried `referenceSolution` on
 * every question of every topic, which is the answer to each exercise - see
 * common/public-select.ts. `create()` is gone with POST /topics.
 */
@Injectable()
export class TopicsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.topic.findMany({ include: { questions: PUBLIC_QUESTION } });
  }

  async findById(id: string) {
    return this.prisma.topic.findUnique({
      where: { id },
      include: { questions: PUBLIC_QUESTION },
    });
  }
}
