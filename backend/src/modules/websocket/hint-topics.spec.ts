/**
 * What a struggling pair's hint is about.
 *
 * Code Coach reads the pair's code in either kind of session, and the mistakes
 * it names choose the hint. An exercise session keeps its exercise's concept
 * tags for retrieval to fall back on. A free session has no exercise, so the
 * tags are the concepts Code Coach found - and when it finds nothing, the hint
 * is about working together rather than about Java.
 */

import { WebsocketGateway } from './websocket.gateway';

const CODE = 'int[] a = new int[3]; a[3] = 1;';

function gateway(found: { conceptTags?: string[]; errorTypes?: string[] } = {}) {
  const codeConcepts = {
    findingsIn: jest.fn(async () => ({
      conceptTags: found.conceptTags ?? [],
      errorTypes: found.errorTypes ?? [],
    })),
  };
  const ws = new WebsocketGateway({} as any, {} as any, {} as any, {} as any, {} as any, codeConcepts as any);
  (ws as any).lastCode.set('s1', CODE);
  return { ws, codeConcepts };
}

const topics = (ws: WebsocketGateway, session: unknown) => (ws as any).hintTopicsFor('s1', session);

const EXERCISE = { mode: 'EXERCISE', question: { conceptTags: ['loop_boundaries'] } };
const FREE = { mode: 'FREE', question: null };
const FOUND = { conceptTags: ['array_indexing'], errorTypes: ['ARRAY_LENGTH_INDEX_MISUSE'] };

describe('hint topics', () => {
  it("name the mistake Code Coach found in an exercise, and keep the exercise's tags", async () => {
    const { ws, codeConcepts } = gateway(FOUND);
    await expect(topics(ws, EXERCISE)).resolves.toEqual({
      tags: ['loop_boundaries'],
      interventionType: 'LOGIC_HINT',
      errorTypes: ['ARRAY_LENGTH_INDEX_MISUSE'],
    });
    expect(codeConcepts.findingsIn).toHaveBeenCalledWith(CODE);
  });

  it("come from Code Coach's reading of the code in a free session", async () => {
    const { ws, codeConcepts } = gateway(FOUND);
    await expect(topics(ws, FREE)).resolves.toEqual({
      tags: ['array_indexing'],
      interventionType: 'LOGIC_HINT',
      errorTypes: ['ARRAY_LENGTH_INDEX_MISUSE'],
    });
    expect(codeConcepts.findingsIn).toHaveBeenCalledWith(CODE);
  });

  it("leave the detector's mistakes out after a run that did not compile", async () => {
    // The pair is stuck on the compiler's message; the hint is retrieved for that.
    const { ws } = gateway(FOUND);
    (ws as any).compileFailed.add('s1');
    await expect(topics(ws, EXERCISE)).resolves.toEqual({
      tags: ['loop_boundaries'],
      interventionType: 'LOGIC_HINT',
      errorTypes: [],
    });
    await expect(topics(ws, FREE)).resolves.toEqual({
      tags: ['array_indexing'],
      interventionType: 'LOGIC_HINT',
      errorTypes: [],
    });
  });

  it("fall back to the exercise's tags when Code Coach finds no mistake", async () => {
    const { ws } = gateway({ conceptTags: ['array_indexing'] });
    await expect(topics(ws, EXERCISE)).resolves.toEqual({
      tags: ['loop_boundaries'],
      interventionType: 'LOGIC_HINT',
      errorTypes: [],
    });
  });

  it('still work without Code Coach', async () => {
    const ws = new WebsocketGateway({} as any, {} as any, {} as any, {} as any, {} as any);
    (ws as any).lastCode.set('s1', CODE);
    await expect(topics(ws, EXERCISE)).resolves.toEqual({
      tags: ['loop_boundaries'],
      interventionType: 'LOGIC_HINT',
      errorTypes: [],
    });
  });

  it('turn to teamwork when Code Coach finds nothing in a free session', async () => {
    const { ws } = gateway();
    await expect(topics(ws, FREE)).resolves.toEqual({
      tags: ['pair programming', 'collaboration', 'debugging'],
      interventionType: 'COLLABORATION_PROMPT',
      errorTypes: [],
    });
  });
});
