import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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

  @Post()
  create(@Body() createTopicDto: CreateTopicDto) {
    return this.topicsService.create(createTopicDto);
  }
}
