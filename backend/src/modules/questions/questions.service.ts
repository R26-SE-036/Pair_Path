import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { PUBLIC_QUESTION_WITH_TOPIC } from '../../common/public-select';

/**
 * Read-only, and the reference solution never leaves here.
 *
 * `include: { topic: true }` returned every scalar on the question row, which
 * includes `referenceSolution` - a complete working answer to the exercise.
 * Any signed-in student could fetch it for any question before starting, and
 * the pair received it in the browser anyway the moment the workspace loaded,
 * because GET /sessions/:id includes the question the same way.
 *
 * Nothing reads that column. It is written by the seed and was served purely
 * because it was there.
 *
 * `create()` is gone with POST /questions - see the controller.
 */
@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.question.findMany({ select: PUBLIC_QUESTION_WITH_TOPIC });
  }

  async findByTopic(topicId: string) {
    return this.prisma.question.findMany({
      where: { topicId },
      select: PUBLIC_QUESTION_WITH_TOPIC,
    });
  }

  async findById(id: string) {
    return this.prisma.question.findUnique({
      where: { id },
      select: PUBLIC_QUESTION_WITH_TOPIC,
    });
  }
}
