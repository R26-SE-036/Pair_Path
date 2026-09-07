import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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

  @Post()
  create(@Body() createQuestionDto: CreateQuestionDto) {
    return this.questionsService.create(createQuestionDto);
  }
}
