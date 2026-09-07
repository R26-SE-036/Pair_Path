import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { CreateQuestionDto } from './dto/create-question.dto';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createQuestionDto: CreateQuestionDto) {
    return this.prisma.question.create({
      data: {
        title: createQuestionDto.title,
        description: createQuestionDto.description,
        difficulty: createQuestionDto.difficulty,
        topicId: createQuestionDto.topicId,
        starterCode: createQuestionDto.starterCode || '',
        referenceSolution: createQuestionDto.referenceSolution,
        conceptTags: createQuestionDto.conceptTags || [],
        reviewQuestions: createQuestionDto.reviewQuestions || [],
      },
    });
  }

  async findAll() {
    return this.prisma.question.findMany({
      include: {
        topic: true,
      },
    });
  }

  async findByTopic(topicId: string) {
    return this.prisma.question.findMany({
      where: { topicId },
      include: {
        topic: true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.question.findUnique({
      where: { id },
      include: {
        topic: true,
      },
    });
  }
}
