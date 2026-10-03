import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MlController } from './ml.controller';
import { MlService } from './ml.service';
import { CodeConceptsService } from './code-concepts.service';

@Module({
  imports: [HttpModule],
  controllers: [MlController],
  providers: [MlService, CodeConceptsService],
  exports: [MlService, CodeConceptsService],
})
export class MlModule {}
