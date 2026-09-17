import { Controller, Get, UseGuards } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * One route: the list the topic picker fills itself from.
 *
 * `POST /topics` was open to any signed-in student, because PairPath has no
 * roles: there is no difference between a student and an instructor in this
 * schema, so a write endpoint could only be open to everybody or nobody. A
 * student could author their own exercise with a trivial reference solution
 * and a review instrument of their choosing, then pair on it - which makes the
 * session record unusable as evidence of anything.
 *
 * Nothing called it. Content comes from src/content/question-bank.ts. It comes
 * back when there is a role to gate it on.
 *
 * `GET /topics/:id` is gone because nothing called it either: the picker lists
 * topics and then asks for that topic's questions, and never needs one topic
 * on its own.
 */
@Controller('topics')
@UseGuards(JwtAuthGuard)
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  findAll() {
    return this.topicsService.findAll();
  }
}
