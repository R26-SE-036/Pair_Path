import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { RetrieveHintDto } from './dto/retrieve-hint.dto';
import { mlServiceUrl } from '../../common/env';

/** Either path into the classifier - see PredictPairStateDto. */
export interface PredictPairStateRequest {
  sessionId: string;
  events?: Array<Record<string, any>>;
  roles?: Record<string, string>;
  lastRoleSwitchAt?: number;
  sessionStartAt?: number;
  features?: Record<string, number>;
}

@Injectable()
export class MlService {
  private readonly logger = new Logger(MlService.name);
  private readonly mlServiceUrl: string;

  /**
   * Shared secret for the ML service, when one is configured.
   *
   * Optional on both sides, and it has to be: requiring it would break every
   * existing local setup for a service that is only reachable from localhost
   * there anyway. Where the two run as containers on a shared network it is
   * the difference between "the API may ask for predictions" and "anything on
   * that network may".
   */
  private readonly serviceToken = (process.env.ML_SERVICE_TOKEN ?? '').trim();

  constructor(private readonly httpService: HttpService) {
    // No fallback. The old default was http://localhost:8000 - Code Coach's
    // port - so an unset variable sent feature vectors to the identity
    // provider and silently used the hardcoded PRODUCTIVE fallback below.
    this.mlServiceUrl = mlServiceUrl();
  }

  /** Sent on every request; the ML service ignores it when it has no secret. */
  private get headers() {
    return this.serviceToken ? { 'X-ML-Service-Token': this.serviceToken } : undefined;
  }

  /**
   * Predict the pair collaboration state (L5).
   *
   * Either raw `events` + `roles`, in which case feature extraction happens in
   * ml-service using the same canonical extractor that builds training data -
   * no second implementation here - or a pre-computed `features` vector, which
   * is what the model sandbox sends.
   */
  async predictPairState(request: PredictPairStateRequest) {
    try {
      const response = await this.httpService
        .post(`${this.mlServiceUrl}/predict-pair-state`, {
          sessionId: request.sessionId,
          events: request.events ?? null,
          roles: request.roles ?? null,
          lastRoleSwitchAt: request.lastRoleSwitchAt ?? null,
          sessionStartAt: request.sessionStartAt ?? null,
          features: request.features ?? null,
        }, { headers: this.headers })
        .toPromise();

      return response.data;
    } catch (error) {
      /*
       * The ML service is unreachable, and this is NOT a prediction.
       *
       * It used to say PRODUCTIVE with confidence 0.5, and the gateway wrote
       * that into pair_state_predictions beside an empty feature window - so
       * an outage produced a run of confident-looking PRODUCTIVE rows in the
       * research record, indistinguishable from real ones except by reading
       * modelVersion. `unavailable: true` lets the caller decline to record
       * it, which is what the gateway now does.
       *
       * PRODUCTIVE is still the state, because the caller may show something,
       * and of the five it is the one that leads to no intervention.
       */
      this.logger.warn(
        `Pair-state prediction unavailable for ${request.sessionId}: ` +
          `${(error as Error)?.message}`,
      );
      return {
        sessionId: request.sessionId,
        predictedState: 'PRODUCTIVE',
        confidence: 0.5,
        modelVersion: 'fallback_v1',
        unavailable: true,
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
        }, { headers: this.headers })
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
        }, { headers: this.headers })
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
