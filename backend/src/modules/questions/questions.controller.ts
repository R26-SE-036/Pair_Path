import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Read-only.
 *
 * `POST /questions` was open to any signed-in student, because PairPath has no
 * roles: there is no difference between a student and an instructor in this
 * schema, so a write endpoint could only be open to everybody or nobody. A
 * student could author their own exercise with a trivial reference solution
 * and a review instrument of their choosing, then pair on it - which makes the
 * session record unusable as evidence of anything.
 *
 * Nothing called it. Content comes from prisma/seeds.ts. It comes back when
 * there is a role to gate it on.
 */
@Controller('questions')
@UseGuards(JwtAuthGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  findAll() {
    return this.questionsService.findAll();
  }

  @Get('topic/:topicId')
  findByTopic(@Param('topicId') topicId: string) {
    return this.questionsService.findByTopic(topicId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.questionsService.findById(id);
  }
}
