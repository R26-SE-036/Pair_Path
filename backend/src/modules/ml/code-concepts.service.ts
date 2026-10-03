import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Which platform concepts a piece of code touches, according to Code Coach.
 *
 * An exercise session picks course notes for its hints by the exercise's
 * concept tags. A free-coding session has no exercise, so it asks Code Coach's
 * detector what the pair's code is actually about instead - the same
 * vocabulary a finding in the editor carries.
 *
 * Server to server, with the shared INTERNAL_SERVICE_KEY: the call is made for
 * the pair, not as either student, and Code Coach records nothing from it.
 *
 * Optional, and never fatal. Unconfigured, unreachable or slow, the answer is
 * "no concepts", and the hint falls back to general teamwork guidance.
 */
@Injectable()
export class CodeConceptsService {
  private readonly logger = new Logger(CodeConceptsService.name);
  private readonly url = (process.env.CODE_COACH_URL ?? '').trim().replace(/\/+$/, '');
  private readonly key = (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

  constructor(private readonly http: HttpService) {}

  get configured(): boolean {
    return Boolean(this.url && this.key);
  }

  async conceptsIn(code: string): Promise<string[]> {
    if (!this.configured || !code.trim()) return [];

    try {
      const response = await firstValueFrom(
        this.http.post(
          `${this.url}/api/v1/internal/concepts`,
          { code: code.slice(0, 50_000) },
          // A hint is on its way to a pair who are stuck; it is not worth
          // holding for a slow answer.
          { headers: { 'X-Internal-Key': this.key }, timeout: 4_000 },
        ),
      );
      const tags = response.data?.concept_tags;
      return Array.isArray(tags)
        ? tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').slice(0, 5)
        : [];
    } catch (error) {
      this.logger.warn(
        `Code Coach could not read the concepts in a free session's code: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }
}
