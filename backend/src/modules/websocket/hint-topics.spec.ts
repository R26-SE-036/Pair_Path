/**
 * What a struggling pair's hint is about.
 *
 * An exercise session has its exercise's concept tags. A free session has no
 * exercise, so Code Coach reads the pair's code instead - and when it finds
 * nothing, the hint is about working together rather than about Java.
 */

import { WebsocketGateway } from './websocket.gateway';

function gateway(found: string[]) {
  const codeConcepts = { conceptsIn: jest.fn(async () => found) };
  const ws = new WebsocketGateway({} as any, {} as any, {} as any, {} as any, {} as any, codeConcepts as any);
  (ws as any).lastCode.set('s1', 'int[] a = new int[3]; a[3] = 1;');
  return { ws, codeConcepts };
}

const topics = (ws: WebsocketGateway, session: unknown) => (ws as any).hintTopicsFor('s1', session);

describe('hint topics', () => {
  it("use the exercise's tags, without asking Code Coach", async () => {
    const { ws, codeConcepts } = gateway(['array_indexing']);
    await expect(
      topics(ws, { mode: 'EXERCISE', question: { conceptTags: ['loop_boundaries'] } }),
    ).resolves.toEqual({ tags: ['loop_boundaries'], interventionType: 'LOGIC_HINT' });
    expect(codeConcepts.conceptsIn).not.toHaveBeenCalled();
  });

  it("come from Code Coach's reading of the code in a free session", async () => {
    const { ws, codeConcepts } = gateway(['array_indexing']);
    await expect(topics(ws, { mode: 'FREE', question: null })).resolves.toEqual({
      tags: ['array_indexing'],
      interventionType: 'LOGIC_HINT',
    });
    expect(codeConcepts.conceptsIn).toHaveBeenCalledWith('int[] a = new int[3]; a[3] = 1;');
  });

  it('turn to teamwork when Code Coach finds nothing', async () => {
    const { ws } = gateway([]);
    await expect(topics(ws, { mode: 'FREE', question: null })).resolves.toEqual({
      tags: ['pair programming', 'collaboration', 'debugging'],
      interventionType: 'COLLABORATION_PROMPT',
    });
  });
});
