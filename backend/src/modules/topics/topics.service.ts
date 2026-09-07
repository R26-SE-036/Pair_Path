import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { CreateTopicDto } from './dto/create-topic.dto';

@Injectable()
export class TopicsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createTopicDto: CreateTopicDto) {
    return this.prisma.topic.create({
      data: createTopicDto,
    });
  }

  async findAll() {
    return this.prisma.topic.findMany({
      include: {
        questions: true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.topic.findUnique({
      where: { id },
      include: {
        questions: true,
      },
    });
  }
}
