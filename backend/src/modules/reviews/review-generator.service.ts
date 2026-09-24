import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import { ReviewContent, readContent } from './session-review';

/** What Study Guider's /api/session-review/generate takes. */
export interface ReviewRequest {
  mode: 'solo' | 'pair';
  exercise: {
    title: string;
    description: string;
    difficulty: string | null;
    concept_tags: string[];
    expected_output: string | null;
    reference_solution: string;
  };
  code: string;
  outcome: 'solved' | 'unsolved' | 'ungraded';
  runs: { total: number; correct: number; failed: number };
  teamwork: Record<string, number> | null;
}

/**
 * Asks Study Guider to write a session's review.
 *
 * Study Guider holds the language model the lessons are written with, and its
 * syllabus notes, so the review is written the same way a lesson is. The call
 * is server to server with a shared key (INTERNAL_SERVICE_KEY, the same value
 * on both): the request carries the exercise's model solution, which a
 * student's token must never be able to fetch.
 *
 * Optional, like the ML service's token. Without STUDY_GUIDER_URL and the key,
 * `configured` is false and every review is built from the exercise's fixed
 * prompts - a working review, just not a written one.
 */
@Injectable()
export class ReviewGeneratorService {
  private readonly url = (process.env.STUDY_GUIDER_URL ?? '').trim().replace(/\/+$/, '');
  private readonly key = (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

  constructor(private readonly http: HttpService) {}

  get configured(): boolean {
    return Boolean(this.url && this.key);
  }

  /** A checked review, or throw. The caller falls back; it never shows the error. */
  async generate(request: ReviewRequest): Promise<{ content: ReviewContent; model: string | null }> {
    const response = await firstValueFrom(
      this.http.post(`${this.url}/api/session-review/generate`, request, {
        headers: { 'X-Internal-Key': this.key },
        // A thinking model writing four steps takes a while. The student is on
        // a "preparing" screen that polls, so nothing is held open meanwhile.
        timeout: 90_000,
      }),
    );

    const content = readContent(response.data);
    if (!content || content.steps.length === 0) {
      throw new Error('Study Guider returned a review that does not hold together.');
    }
    const model = typeof response.data?.model === 'string' ? response.data.model : null;
    return { content, model };
  }
}
