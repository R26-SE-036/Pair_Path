import { Injectable, Logger } from '@nestjs/common';

import { LlmService } from './llm.service';
import { ReviewError, ReviewRequest, buildPrompt, parseJson, validateReview } from './review-writer';
import { ReviewContent } from './session-review';

export type { ReviewRequest } from './review-writer';

/**
 * Writes a session's review with the language model.
 *
 * This used to post the session to Study Guider and have it ask its model. It
 * now asks the model itself, with PairPath's own GEMINI_API_KEY and
 * OPENAI_API_KEY - see llm.service.ts - and the prompt and the checks live in
 * review-writer.ts.
 *
 * Optional. With neither key set, `configured` is false and every review is
 * built from the exercise's fixed prompts - a working review, just not a
 * written one.
 */
@Injectable()
export class ReviewGeneratorService {
  private readonly logger = new Logger(ReviewGeneratorService.name);

  constructor(private readonly llm: LlmService) {}

  get configured(): boolean {
    return this.llm.configured;
  }

  /**
   * A checked review, or throw. The caller falls back; it never shows the error.
   *
   * Tried twice: a model occasionally returns a response that parses but does
   * not hold together, and a second attempt usually does. A provider that did
   * not answer at all is not retried here - LlmService has already tried every
   * provider it has a key for.
   */
  async generate(request: ReviewRequest): Promise<{ content: ReviewContent; model: string | null }> {
    const prompt = buildPrompt(request);

    let last: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { text, model } = await this.llm.generate(prompt);
      try {
        return { content: validateReview(parseJson(text), request), model };
      } catch (error) {
        if (!(error instanceof ReviewError)) throw error;
        last = error;
        this.logger.warn(`Session review did not hold together: ${error.message}`);
      }
    }
    throw last ?? new ReviewError('The review could not be written.');
  }
}
