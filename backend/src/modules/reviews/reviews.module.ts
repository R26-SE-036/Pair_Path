import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewGeneratorService } from './review-generator.service';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [WebsocketModule, HttpModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewGeneratorService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
