import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { RetrieveHintDto } from './dto/retrieve-hint.dto';

@Injectable()
export class MlService {
  private readonly mlServiceUrl: string;

  constructor(private readonly httpService: HttpService) {
    this.mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';
  }

  /**
   * Predict the pair collaboration state from raw session events (L5).
   * Feature extraction happens in ml-service, using the same canonical
   * extractor that builds training data — no second implementation here.
   */
  async predictPairState(
    sessionId: string,
    events: Array<Record<string, any>>,
    roles: Record<string, string>,
    lastRoleSwitchAt?: number,
  ) {
    try {
      const response = await this.httpService
        .post(`${this.mlServiceUrl}/predict-pair-state`, {
          sessionId,
          events,
          roles,
          lastRoleSwitchAt: lastRoleSwitchAt ?? null,
        })
        .toPromise();

      return response.data;
    } catch (error) {
      // Fallback if ML service unavailable
      return {
        sessionId,
        predictedState: 'PRODUCTIVE',
        confidence: 0.5,
        modelVersion: 'fallback_v1',
      };
    }
  }

  /**
   * Get an intervention recommendation based on predicted state.
   */
  async recommendIntervention(
    sessionId: string,
    predictedState: string,
    confidence: number,
  ) {
    try {
      const response = await this.httpService
        .post(`${this.mlServiceUrl}/recommend-intervention`, {
          sessionId,
          predictedState,
          confidence,
        })
        .toPromise();

      return response.data;
    } catch (error) {
      return {
        state: predictedState,
        action: 'NO_ACTION',
        delivery: {
          type: 'none',
          uiTarget: 'none',
          uiEffect: 'none',
          message: 'ML service unavailable',
        },
      };
    }
  }

  /**
   * Retrieve a RAG-based hint for logic struggle support.
   */
  async retrieveHint(dto: RetrieveHintDto) {
    try {
      const response = await this.httpService
        .post(`${this.mlServiceUrl}/retrieve-hint`, {
          sessionId: dto.sessionId,
          pairId: dto.pairId || '',
          predictedState: dto.predictedState || 'LOGIC_STRUGGLE',
          interventionType: dto.interventionType || 'LOGIC_HINT',
          questionConceptTags: dto.questionConceptTags || [],
          recentErrorContext: dto.recentErrorContext || '',
          recentCodeSnippet: dto.recentCodeSnippet || '',
        })
        .toPromise();

      return response.data;
    } catch (error) {
      return {
        interventionType: dto.interventionType || 'LOGIC_HINT',
        retrievedConcepts: [],
        conceptReminder: 'Try tracing the logic step by step before changing the code.',
        exampleIdea: 'Check the values of your variables at the start, middle, and end of the loop.',
        reflectiveQuestion: 'What do you expect each variable to contain after one iteration?',
        sourceChunks: [],
        fallbackUsed: true
      };
    }
  }
}
