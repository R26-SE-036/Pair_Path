/**
 * Presenter mode: the engine made visible, and nothing written while it is.
 *
 * What matters here is that showing the model to a panel cannot leak into
 * the research record - a presenter session predicts every ten seconds and
 * replays windows that are not this pair's behaviour at all - and that a
 * replay goes through the same engine and delivery as a live prediction.
 */

import * as fs from 'fs';
import * as path from 'path';

import { DEMO_WINDOWS } from '../../content/demo-windows';
import { WebsocketGateway } from './websocket.gateway';
import { PRESENTER_ID_PREFIX, cooling, presenterModeAllowed, replayRequest } from './presenter';

const STATES = ['PRODUCTIVE', 'DRIVER_DOMINANCE', 'PASSIVE_NAVIGATOR', 'LOGIC_STRUGGLE', 'DISENGAGED'];

describe('the replay windows', () => {
  const card = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../ml/models/model_card.json'), 'utf-8'),
  );

  it('has one for every state', () => {
    expect(DEMO_WINDOWS.windows.map((w) => w.state).sort()).toEqual([...STATES].sort());
  });

  it('comes only from sessions the model was never trained on', () => {
    for (const window of DEMO_WINDOWS.windows) {
      expect(card.split.test_sessions).toContain(window.sourceSession);
    }
  });

  it('was exported against the model being served', () => {
    expect(DEMO_WINDOWS.modelVersion).toBe(card.version);
  });

  it('fits inside the window the model reads', () => {
    for (const window of DEMO_WINDOWS.windows) {
      for (const event of window.events) {
        expect(event.offset).toBeLessThanOrEqual(0);
        expect(event.offset).toBeGreaterThan(-window.windowSeconds);
      }
    }
  });
});

describe('replaying a window', () => {
  const window = DEMO_WINDOWS.windows[0];

  it('ends it now and keeps every gap as recorded', () => {
    const now = Date.UTC(2026, 9, 20, 10, 0, 0);
    const request = replayRequest(window, 's1', now);

    expect(request.windowEnd).toBe(now / 1000);
    request.events.forEach((event, i) => {
      expect(event.timestamp.getTime() / 1000).toBeCloseTo(now / 1000 + window.events[i].offset, 3);
      expect(event.eventType).toBe(window.events[i].eventType);
    });
    expect(request.sessionStartAt).toBeCloseTo(now / 1000 + window.sessionStartOffset, 3);
    expect(request.roles).toEqual(window.roles);
  });

  it('leaves the last switch unset when there was none', () => {
    const request = replayRequest({ ...window, lastRoleSwitchOffset: null }, 's1', Date.now());
    expect(request.lastRoleSwitchAt).toBeUndefined();
  });
});

describe('the presenter cooldown', () => {
  it('is quiet until its time, then lets go', () => {
    const cooldowns = new Map([['s1:ROLE_SWITCH_SUPPORT', 1_000]]);
    expect(cooling(cooldowns, 's1:ROLE_SWITCH_SUPPORT', 999)).toBe(true);
    expect(cooling(cooldowns, 's1:ROLE_SWITCH_SUPPORT', 1_000)).toBe(false);
    expect(cooldowns.size).toBe(0);
    expect(cooling(cooldowns, 's1:other', 0)).toBe(false);
  });
});

describe('switching it off on a server', () => {
  const before = process.env.PAIRPATH_PRESENTER_MODE;
  afterEach(() => {
    if (before === undefined) delete process.env.PAIRPATH_PRESENTER_MODE;
    else process.env.PAIRPATH_PRESENTER_MODE = before;
  });

  it('is on unless set to off', () => {
    delete process.env.PAIRPATH_PRESENTER_MODE;
    expect(presenterModeAllowed()).toBe(true);
    process.env.PAIRPATH_PRESENTER_MODE = 'OFF';
    expect(presenterModeAllowed()).toBe(false);
  });
});

// ── The gateway ──────────────────────────────────────────────────────────────

function fakeSocket(id: string, userId: string) {
  const emitted: Array<{ event: string; payload: any }> = [];
  return {
    id,
    data: { userId },
    emitted,
    join: () => {},
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    to: () => ({ emit: () => {} }),
  };
}

function harness(prediction: Record<string, any>, recommendation: Record<string, any>) {
  const writes: string[] = [];
  const sent: Array<{ room: string; event: string; payload: any }> = [];
  const members = [
    { id: 'm0', userId: 'driver', role: 'DRIVER' },
    { id: 'm1', userId: 'nav', role: 'NAVIGATOR' },
  ];
  // Enough events in the window for the live path to ask the model.
  const windowEvents = [0, 1, 2, 3].map((i) => ({
    timestamp: new Date(Date.now() - 1000 * (10 - i)),
    userId: 'driver',
    eventType: 'CODE_EDIT',
    metadata: '{}',
  }));

  const prisma = {
    pairSessionMember: {
      findFirst: async ({ where }: any) => members.find((m) => m.userId === where.userId) ?? null,
      findMany: async () => members,
    },
    sessionEvent: {
      create: async () => {
        writes.push('sessionEvent');
        return {};
      },
      findMany: async () => windowEvents,
      findFirst: async () => null,
    },
    pairSession: {
      findUnique: async () => ({ status: 'ACTIVE', mode: 'EXERCISE', question: { conceptTags: ['loop_control'] } }),
    },
    intervention: {
      create: async ({ data }: any) => {
        writes.push('intervention');
        return { id: 'stored-1', ...data };
      },
      updateMany: async () => {
        writes.push('intervention.update');
        return { count: 1 };
      },
    },
    featureWindow: { create: () => writes.push('featureWindow') },
    pairStatePrediction: { create: () => writes.push('pairStatePrediction') },
    $transaction: async (ops: unknown[]) => ops,
  };

  const asked: any[] = [];
  const ml = {
    predictPairState: async (request: any) => {
      asked.push(request);
      return prediction;
    },
    recommendIntervention: async () => recommendation,
    retrieveHint: async () => ({ conceptReminder: 'c', exampleIdea: 'e', reflectiveQuestion: 'q' }),
  };

  const gateway = new WebsocketGateway(
    { runJava: async () => ({ success: true }) } as any,
    prisma as any,
    ml as any,
    { verify: () => ({ sub: 'u1' }) } as any,
    { canShowIntervention: async () => true, setInterventionCooldown: async () => {} } as any,
  );
  gateway.server = {
    to: (room: string) => ({ emit: (event: string, payload: unknown) => sent.push({ room, event, payload }) }),
  } as any;

  return { gateway, writes, sent, asked };
}

const NAV_NUDGE = {
  action: 'NAVIGATOR_PARTICIPATION_SUPPORT',
  delivery: { uiTarget: 'chat_input', uiEffect: 'pulse', message: 'Talk it through.', audience: 'navigator' },
};

const PASSIVE = {
  predictedState: 'PASSIVE_NAVIGATOR',
  confidence: 0.91,
  modelVersion: 'test',
  features: { total_edit_count: 12 },
  probabilities: { PASSIVE_NAVIGATOR: 0.91, PRODUCTIVE: 0.09 },
};

async function inPresenterMode(h: ReturnType<typeof harness>, socket: any) {
  await h.gateway.handleJoinRoom({ sessionId: 's1' }, socket);
  await h.gateway.handlePresenterMode({ sessionId: 's1', on: true }, socket);
  // Let the prediction it starts finish.
  await new Promise((resolve) => setImmediate(resolve));
}

describe('presenter mode in the gateway', () => {
  it('tells the room its settings and the windows it can replay', async () => {
    const h = harness(PASSIVE, NAV_NUDGE);
    const driver = fakeSocket('sock-d', 'driver');
    await inPresenterMode(h, driver);

    const announced = h.sent.find((s) => s.event === 'presenter_mode')!;
    expect(announced.payload).toMatchObject({ on: true, predictEverySeconds: 10, windowSeconds: 180 });
    expect(announced.payload.replays).toHaveLength(5);
  });

  it('shows every live prediction and stores none of them', async () => {
    const h = harness(PASSIVE, NAV_NUDGE);
    const driver = fakeSocket('sock-d', 'driver');
    await inPresenterMode(h, driver);

    const report = h.sent.find((s) => s.event === 'ml_prediction')!;
    expect(report.payload).toMatchObject({
      source: 'live',
      state: 'PASSIVE_NAVIGATOR',
      probabilities: PASSIVE.probabilities,
      // The navigator is not connected, so a live nudge to them has nowhere to go.
      decision: 'target_offline',
    });
    expect(h.writes.filter((w) => w !== 'sessionEvent')).toEqual([]);
  });

  it('replays a held-out window through the engine and delivers its nudge', async () => {
    const h = harness(PASSIVE, NAV_NUDGE);
    const driver = fakeSocket('sock-d', 'driver');
    await inPresenterMode(h, driver);
    h.sent.length = 0;

    await h.gateway.handleReplayWindow({ sessionId: 's1', state: 'PASSIVE_NAVIGATOR' }, driver as any);

    // The recorded events went to the model, not this session's.
    const window = DEMO_WINDOWS.windows.find((w) => w.state === 'PASSIVE_NAVIGATOR')!;
    expect(h.asked[h.asked.length - 1].events).toHaveLength(window.events.length);

    const nudge = h.sent.find((s) => s.event === 'intervention')!;
    expect(nudge.room).toBe('s1');
    expect(nudge.payload.id.startsWith(PRESENTER_ID_PREFIX)).toBe(true);
    expect(nudge.payload).toMatchObject({ state: 'PASSIVE_NAVIGATOR', replay: true });

    const report = h.sent.find((s) => s.event === 'ml_prediction')!;
    expect(report.payload).toMatchObject({
      source: 'replay',
      decision: 'sent',
      audience: 'navigator',
      replay: { sourceSession: window.sourceSession, label: 'PASSIVE_NAVIGATOR' },
    });
    expect(h.writes.filter((w) => w !== 'sessionEvent')).toEqual([]);
  });

  it('refuses a replay outside presenter mode', async () => {
    const h = harness(PASSIVE, NAV_NUDGE);
    const driver = fakeSocket('sock-d', 'driver');
    await h.gateway.handleJoinRoom({ sessionId: 's1' }, driver as any);

    await h.gateway.handleReplayWindow({ sessionId: 's1', state: 'PASSIVE_NAVIGATOR' }, driver as any);

    expect(h.asked).toEqual([]);
    expect(h.sent.some((s) => s.event === 'intervention')).toBe(false);
  });

  it('drops the answer to a presenter nudge', async () => {
    const h = harness(PASSIVE, NAV_NUDGE);
    const driver = fakeSocket('sock-d', 'driver');
    await h.gateway.handleJoinRoom({ sessionId: 's1' }, driver as any);
    const before = h.writes.length;

    await h.gateway.handleInterventionResponse(
      { sessionId: 's1', interventionId: `${PRESENTER_ID_PREFIX}x`, accepted: true },
      driver as any,
    );

    expect(h.writes.length).toBe(before);
  });

  it('keeps the normal path as it was: stored, and nothing shown', async () => {
    const h = harness(
      { ...PASSIVE, predictedState: 'DRIVER_DOMINANCE' },
      { action: 'ROLE_SWITCH_SUPPORT', delivery: { uiTarget: 'role_switch_button', uiEffect: 'glow', message: 'Swap.' } },
    );
    const driver = fakeSocket('sock-d', 'driver');
    await h.gateway.handleJoinRoom({ sessionId: 's1' }, driver as any);

    await (h.gateway as any).triggerMlPrediction('s1');

    expect(h.writes).toEqual(expect.arrayContaining(['featureWindow', 'pairStatePrediction', 'intervention']));
    expect(h.sent.find((s) => s.event === 'intervention')!.payload.id).toBe('stored-1');
    expect(h.sent.some((s) => s.event === 'ml_prediction')).toBe(false);
  });
});
