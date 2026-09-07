import { Module } from '@nestjs/common';
import { InterventionsController } from './interventions.controller';
import { InterventionsService } from './interventions.service';

@Module({
  controllers: [InterventionsController],
  providers: [InterventionsService],
  exports: [InterventionsService],
})
export class InterventionsModule {}
