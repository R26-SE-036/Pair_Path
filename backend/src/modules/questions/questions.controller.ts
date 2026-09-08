import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * One route: the questions on a topic, which is what the picker needs.
 *
 * `POST /questions` was open to any signed-in student, because PairPath has no
 * roles: there is no difference between a student and an instructor in this
 * schema, so a write endpoint could only be open to everybody or nobody. A
 * student could author their own exercise with a trivial reference solution
 * and a review instrument of their choosing, then pair on it - which makes the
 * session record unusable as evidence of anything.
 *
 * Nothing called it. Content comes from src/content/question-bank.ts. It comes
 * back when there is a role to gate it on.
 *
 * `GET /questions` and `GET /questions/:id` are gone for a duller reason:
 * nothing on the platform ever called either. A question is chosen from a
 * topic, and a session carries its own question in the session payload, so
 * neither route had a caller in the frontend or anywhere else - and an
 * endpoint nobody calls is one nobody notices going wrong.
 */
@Controller('questions')
@UseGuards(JwtAuthGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get('topic/:topicId')
  findByTopic(@Param('topicId') topicId: string) {
    return this.questionsService.findByTopic(topicId);
  }
}
