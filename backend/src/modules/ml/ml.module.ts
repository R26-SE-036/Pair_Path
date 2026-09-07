import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MlController } from './ml.controller';
import { MlService } from './ml.service';

@Module({
  imports: [HttpModule],
  controllers: [MlController],
  providers: [MlService],
  exports: [MlService],
})
export class MlModule {}
