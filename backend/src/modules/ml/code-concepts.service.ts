import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Which platform concepts a piece of code touches, and which mistakes in it,
 * according to Code Coach.
 *
 * An exercise session picks course notes for its hints by the exercise's
 * concept tags. A free-coding session has no exercise, so it asks Code Coach's
 * detector what the pair's code is actually about instead - the same
 * vocabulary a finding in the editor carries. Either kind of session asks
 * which mistakes the detector found, so a struggling pair's hint can be the
 * one written for that mistake.
 *
 * Server to server, with the shared INTERNAL_SERVICE_KEY: the call is made for
 * the pair, not as either student, and Code Coach records nothing from it.
 *
 * Optional, and never fatal. Unconfigured, unreachable or slow, the answer is
 * "nothing found": an exercise's hint is then chosen by its tags, and a free
 * session's falls back to general teamwork guidance.
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
    return (await this.findingsIn(code)).conceptTags;
  }

  /** Concepts and error types, each most confident finding first. */
  async findingsIn(code: string): Promise<CodeFindings> {
    if (!this.configured || !code.trim()) return noFindings();

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
      return {
        conceptTags: names(response.data?.concept_tags),
        errorTypes: names(response.data?.error_types),
      };
    } catch (error) {
      this.logger.warn(
        `Code Coach could not read a pair's code: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return noFindings();
    }
  }
}

export interface CodeFindings {
  conceptTags: string[];
  errorTypes: string[];
}

const noFindings = (): CodeFindings => ({ conceptTags: [], errorTypes: [] });

/** A list of names from the response, or none if it is not one. */
function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string' && name.trim() !== '').slice(0, 5)
    : [];
}
