/**
 * The window a live prediction reads.
 *
 * The model was trained on windows cut by dev_tools/build_windows.py: every
 * event inside the 180 seconds ending at a moment, skipped below three events,
 * with session age measured from the session's first event. The gateway sent
 * the fifty newest events instead and let the window end wherever the last of
 * them fell - four differences from training at once, none of which any test
 * could see, because both halves worked.
 */

import { WebsocketGateway } from './websocket.gateway';
import { MIN_WINDOW_EVENTS, ML_WINDOW_SECONDS } from '../../common/ml-window';

const FIRST_EVENT_AT = new Date('2026-09-13T09:00:00.000Z');

function build(eventsInWindow: number) {
  const queries: any[] = [];
  const predictions: any[] = [];

  const now = Date.now();
  const window = Array.from({ length: eventsInWindow }, (_, index) => ({
    timestamp: new Date(now - (eventsInWindow - index) * 1000),
    userId: 'u1',
    eventType: 'CODE_EDIT',
    metadata: '{}',
  }));

  const prisma = {
    sessionEvent: {
      findMany: async (args: any) => {
        queries.push(args);
        return window;
      },
      findFirst: async (args: any) =>
        args?.where?.eventType === 'ROLE_SWITCH' ? null : { timestamp: FIRST_EVENT_AT },
    },
    pairSessionMember: { findMany: async () => [{ userId: 'u1', role: 'DRIVER' }] },
  };

  const ml = {
    predictPairState: async (payload: any) => {
      predictions.push(payload);
      // Unavailable stops the gateway before it records or nudges anything,
      // which is all these tests need: they are about what it asked.
      return { unavailable: true };
    },
    recommendIntervention: async () => null,
  };

  const gateway = new WebsocketGateway({} as any, prisma as any, ml as any, {} as any, {} as any);
  const predict = () => (gateway as any).triggerMlPrediction('s1');

  return { predict, queries, predictions };
}

describe('the window a live prediction reads', () => {
  it('asks for every event in the model window ending now, not the newest fifty', async () => {
    const { predict, queries } = build(MIN_WINDOW_EVENTS);

    const before = Date.now();
    await predict();
    const after = Date.now();

    const [query] = queries;
    const { gt, lte } = query.where.timestamp;
    expect(lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(lte.getTime()).toBeLessThanOrEqual(after);
    expect(lte.getTime() - gt.getTime()).toBe(ML_WINDOW_SECONDS * 1000);
    // Bounded by time. A cap of fifty cut a busy window down to its last few
    // seconds, and the model read the missing minutes as idle.
    expect(query.take === undefined || query.take >= 1000).toBe(true);
  });

  it('tells the model where the window ends', async () => {
    // Without it the window ends on the last event, so a pair that has gone
    // quiet is described by what they did before they stopped.
    const { predict, predictions } = build(MIN_WINDOW_EVENTS);

    const before = Date.now() / 1000;
    await predict();
    const after = Date.now() / 1000;

    expect(predictions[0].windowEnd).toBeGreaterThanOrEqual(before);
    expect(predictions[0].windowEnd).toBeLessThanOrEqual(after);
  });

  it('measures session age from the first event, as training did', async () => {
    const { predict, predictions } = build(MIN_WINDOW_EVENTS);

    await predict();

    expect(predictions[0].sessionStartAt).toBe(FIRST_EVENT_AT.getTime() / 1000);
  });

  it('sends the events inside the window, all of them', async () => {
    const { predict, predictions } = build(120);

    await predict();

    expect(predictions[0].events).toHaveLength(120);
  });

  it('does not predict on a window training would have skipped', async () => {
    const { predict, predictions } = build(MIN_WINDOW_EVENTS - 1);

    await predict();

    expect(predictions).toHaveLength(0);
  });
});
