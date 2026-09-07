import { Controller, Post, Get, Param, Body, UseGuards, Req } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { JoinSessionDto } from './dto/join-session.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  create(@Body() createSessionDto: CreateSessionDto, @Req() req: any) {
    return this.sessionsService.create(createSessionDto, req.user.userId);
  }

  @Post('join')
  join(@Body() joinSessionDto: JoinSessionDto, @Req() req: any) {
    return this.sessionsService.join(joinSessionDto, req.user.userId);
  }

  @Get('analytics/all')
  getAllAnalytics(@Req() req: any) {
    return this.sessionsService.getAllAnalytics(req.user.userId);
  }

  @Get('my')
  findMySessions(@Req() req: any) {
    return this.sessionsService.findByUser(req.user.userId);
  }

  @Get('analytics/:id')
  getOneAnalytics(@Param('id') id: string, @Req() req: any) {
    return this.sessionsService.getOneAnalytics(id, req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.sessionsService.findById(id, req.user.userId);
  }

  @Post(':id/end')
  end(@Param('id') id: string, @Body() body: { finalCode?: string }, @Req() req: any) {
    return this.sessionsService.end(id, req.user.userId, body.finalCode);
  }
}
