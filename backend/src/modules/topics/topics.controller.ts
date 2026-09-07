import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Read-only.
 *
 * `POST /topics` was open to any signed-in student, because PairPath has no
 * roles: there is no difference between a student and an instructor in this
 * schema, so a write endpoint could only be open to everybody or nobody. A
 * student could author their own exercise with a trivial reference solution
 * and a review instrument of their choosing, then pair on it - which makes the
 * session record unusable as evidence of anything.
 *
 * Nothing called it. Content comes from prisma/seeds.ts. It comes back when
 * there is a role to gate it on.
 */
@Controller('topics')
@UseGuards(JwtAuthGuard)
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  findAll() {
    return this.topicsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.topicsService.findById(id);
  }
}
