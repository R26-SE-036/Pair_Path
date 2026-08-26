import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { MongoDbService } from '../../common/mongodb.service';
import { CreateInterventionDto } from './dto/create-intervention.dto';

@Injectable()
export class InterventionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mongodb: MongoDbService,
  ) {}

  async create(createInterventionDto: CreateInterventionDto) {
    return this.prisma.intervention.create({
      data: createInterventionDto,
    });
  }

  async findBySession(sessionId: string) {
    return this.prisma.intervention.findMany({
      where: { sessionId },
      orderBy: { shownAt: 'desc' },
    });
  }

  async respond(id: string, accepted: boolean) {
    const updated = await this.prisma.intervention.update({
      where: { id },
      data: { accepted },
    });

    // Log to MongoDB for research analytics
    await this.mongodb.logIntervention(updated.sessionId, {
      interventionId: id,
      action: updated.action,
      accepted,
      timestamp: new Date()
    });

    return updated;
  }
}
