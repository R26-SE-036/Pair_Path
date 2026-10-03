import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewGeneratorService } from './review-generator.service';
import { LlmService } from './llm.service';
import { MlModule } from '../ml/ml.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [WebsocketModule, HttpModule, MlModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewGeneratorService, LlmService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
