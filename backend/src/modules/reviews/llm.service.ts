import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * The language model the session review is written with.
 *
 * ==================== WHY PAIRPATH CALLS IT ITSELF ====================
 * The review used to be written by Study Guider: PairPath posted the session to
 * it, server to server, and Study Guider asked its model. That made a pair's
 * review depend on a second service being up and holding the same shared key,
 * for a call that is nothing but a prompt. PairPath now holds its own
 * GEMINI_API_KEY and OPENAI_API_KEY and asks the model directly.
 * ======================================================================
 *
 * Plain REST rather than either SDK: one request each, and the response
 * parsing - which is where thinking models have caught this platform out
 * before (see Study Guider's services/llm.py) - is explicit here.
 *
 * LLM_PROVIDER picks who goes first ("gemini" unless set). When that one
 * cannot answer and the other has a key, the other is asked: both are real
 * models writing real content, so this is a second opinion, not a fallback to
 * anything invented. If neither answers the caller throws, and the review is
 * built from the exercise's own questions instead.
 */

export class LlmUnavailable extends Error {}

type Provider = 'gemini' | 'openai';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_URL = 'https://api.openai.com/v1/responses';

// The free Gemini tier answers 503 "high demand" in bursts. Worth a short
// wait; a 400 or 404 is not - it says the request itself is wrong.
const GEMINI_RETRY_DELAYS_MS = [2_000, 5_000];

// A thinking model writing a full review takes a while. The student is on a
// "writing your review" screen that polls, so nothing is held open meanwhile.
const TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  private readonly geminiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  private readonly openaiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  private readonly geminiModel = (process.env.GEMINI_MODEL ?? '').trim() || 'gemini-3.6-flash';
  private readonly openaiModel = (process.env.OPENAI_MODEL ?? '').trim() || 'gpt-6-luna';
  private readonly reasoningEffort = (process.env.OPENAI_REASONING_EFFORT ?? '').trim().toLowerCase();
  private readonly first: Provider =
    (process.env.LLM_PROVIDER ?? '').trim().toLowerCase() === 'openai' ? 'openai' : 'gemini';

  constructor(private readonly http: HttpService) {}

  /** The providers with a key, the preferred one first. */
  private get providers(): Provider[] {
    const order: Provider[] = this.first === 'openai' ? ['openai', 'gemini'] : ['gemini', 'openai'];
    return order.filter((p) => (p === 'gemini' ? this.geminiKey : this.openaiKey));
  }

  get configured(): boolean {
    return this.providers.length > 0;
  }

  /** The model's JSON answer as text, and which model wrote it. */
  async generate(prompt: string): Promise<{ text: string; model: string }> {
    const failures: string[] = [];
    for (const provider of this.providers) {
      try {
        return provider === 'gemini' ? await this.gemini(prompt) : await this.openai(prompt);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${provider}: ${reason}`);
        this.logger.warn(`The review model (${provider}) did not answer: ${reason}`);
      }
    }
    throw new LlmUnavailable(
      failures.length ? failures.join(' | ') : 'Neither GEMINI_API_KEY nor OPENAI_API_KEY is set.',
    );
  }

  private async gemini(prompt: string): Promise<{ text: string; model: string }> {
    const url = `${GEMINI_URL}/${encodeURIComponent(this.geminiModel)}:generateContent`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    };

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await firstValueFrom(
          this.http.post(url, body, {
            headers: { 'x-goog-api-key': this.geminiKey, 'Content-Type': 'application/json' },
            timeout: TIMEOUT_MS,
          }),
        );
        const text = geminiText(response.data);
        if (!text.trim()) {
          const reason = response.data?.candidates?.[0]?.finishReason ?? 'unknown';
          throw new Error(`empty response (finish reason: ${reason})`);
        }
        return { text, model: this.geminiModel };
      } catch (error: any) {
        const status = error?.response?.status;
        const busy = status === 500 || status === 503;
        if (busy && attempt < GEMINI_RETRY_DELAYS_MS.length) {
          await sleep(GEMINI_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(describe(error));
      }
    }
  }

  private async openai(prompt: string): Promise<{ text: string; model: string }> {
    const body: Record<string, unknown> = {
      model: this.openaiModel,
      input: prompt,
      text: { format: { type: 'json_object' } },
    };
    if (['low', 'medium', 'high'].includes(this.reasoningEffort)) {
      body.reasoning = { effort: this.reasoningEffort };
    }

    try {
      const response = await firstValueFrom(
        this.http.post(OPENAI_URL, body, {
          headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
          timeout: TIMEOUT_MS,
        }),
      );
      const text = openaiText(response.data);
      if (!text.trim()) {
        const reason = response.data?.incomplete_details?.reason ?? response.data?.status ?? 'unknown';
        throw new Error(`empty response (status: ${reason})`);
      }
      return { text, model: this.openaiModel };
    } catch (error) {
      throw new Error(describe(error));
    }
  }
}

/**
 * The answer out of a Gemini response, skipping reasoning.
 *
 * A part flagged `thought: true` is the model thinking, not answering. A part
 * that merely carries a thoughtSignature next to its text IS the answer - the
 * wrapper Study Guider used to call through dropped those and returned "".
 */
export function geminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part && !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

/** The answer out of an OpenAI Responses API body (the SDK's `output_text`). */
export function openaiText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text;
  const output = Array.isArray(data?.output) ? data.output : [];
  return output
    .filter((item: any) => item?.type === 'message' && Array.isArray(item.content))
    .flatMap((item: any) => item.content)
    .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('');
}

/** An HTTP failure in one line, without echoing a key back into the log. */
function describe(error: any): string {
  const status = error?.response?.status;
  const detail = error?.response?.data?.error?.message ?? error?.message ?? String(error);
  return status ? `HTTP ${status}: ${String(detail).slice(0, 300)}` : String(detail).slice(0, 300);
}
