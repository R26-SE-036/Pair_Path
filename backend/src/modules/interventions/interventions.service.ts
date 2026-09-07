import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { CreateInterventionDto } from './dto/create-intervention.dto';

@Injectable()
export class InterventionsService {
  constructor(private readonly prisma: PrismaService) {}

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
    // The MongoDB write that used to follow this update logged
    // {interventionId, action, accepted, timestamp} "for research analytics".
    // Every one of those fields is already on the row this line just wrote:
    // interventions holds action, accepted and shownAt. It was a second copy
    // of the same fact in a store nothing read back, and the two could only
    // ever agree or disagree.
    return this.prisma.intervention.update({
      where: { id },
      data: { accepted },
    });
  }
}
