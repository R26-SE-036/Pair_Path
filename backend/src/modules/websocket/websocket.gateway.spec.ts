/**
 * The gateway rules that the behavioural record depends on.
 *
 * Every test here covers something that was silently wrong in production and
 * that no test would have caught, because the failures did not look like
 * failures: a chat message that logged an event but stored no words, a
 * navigator whose keystrokes became driver edits, a role swap that left a
 * single member unable to type, a session that ended for one student and not
 * their partner.
 *
 * What they have in common is that each one corrupts something downstream.
 * Three of the model's fifteen features come from CODE_EDIT attribution and
 * two more from DISCUSSION_NOTE counts, so a gateway that accepts the wrong
 * event does not merely misbehave - it writes rows that disagree with what the
 * model was trained on, and nothing reports it.
 */

import { WebsocketGateway } from './websocket.gateway';

/** A socket that records what it was told, without a network. */
function fakeSocket(id: string, userId: string) {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const toRoom: Array<{ room: string; event: string; payload: unknown }> = [];
  let joined: string | null = null;

  return {
    id,
    data: { userId },
    emitted,
    toRoom,
    get joinedRoom() {
      return joined;
    },
    join: (room: string) => {
      joined = room;
    },
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => toRoom.push({ room, event, payload }),
    }),
  };
}

/** The server side of the same recording. */
function fakeServer() {
  const sent: Array<{ room: string; event: string; payload: any }> = [];
  return {
    sent,
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => sent.push({ room, event, payload }),
    }),
  };
}

interface Harness {
  gateway: WebsocketGateway;
  server: ReturnType<typeof fakeServer>;
  events: Array<{ eventType: string; userId: string; role: string; metadata: string }>;
  memberRows: Array<{ id: string; userId: string; role: string }>;
  roleUpdates: Array<{ id: string; role: string }>;
  memberQueries: number;
}

/**
 * A gateway wired to fakes.
 *
 * `members` is the session's membership as the database holds it; the tests
 * mutate it through the gateway rather than by hand, so a swap that fails to
 * persist shows up as a failed assertion rather than a passing one.
 */
function harness(members: Array<{ userId: string; role: string }>): Harness {
  const memberRows = members.map((m, i) => ({ id: `m${i}`, ...m }));
  const events: Harness['events'] = [];
  const roleUpdates: Harness['roleUpdates'] = [];
  const state = { memberQueries: 0 };

  const prisma = {
    pairSessionMember: {
      findFirst: async ({ where }: any) =>
        memberRows.find((m) => m.userId === where.userId) ?? null,
      findMany: async () => {
        state.memberQueries += 1;
        return memberRows;
      },
      update: async ({ where, data }: any) => {
        const row = memberRows.find((m) => m.id === where.id)!;
        row.role = data.role;
        roleUpdates.push({ id: where.id, role: data.role });
        return row;
      },
    },
    sessionEvent: {
      create: async ({ data }: any) => {
        events.push(data);
        return data;
      },
      findMany: async () => [],
      findFirst: async () => null,
    },
    pairSession: { findUnique: async () => null },
    intervention: { create: async (a: any) => a.data, update: async () => ({}) },
    featureWindow: { create: () => ({}) },
    pairStatePrediction: { create: () => ({}) },
    $transaction: async () => [],
  };

  const gateway = new WebsocketGateway(
    { runJava: async () => ({ success: true, stdout: '', stderr: '', compileError: null }) } as any,
    prisma as any,
    { predictPairState: async () => null, recommendIntervention: async () => null } as any,
    { verify: () => ({ sub: 'u1' }) } as any,
    { canShowIntervention: async () => true, setInterventionCooldown: async () => {} } as any,
  );

  const server = fakeServer();
  gateway.server = server as any;

  return {
    gateway,
    server,
    events,
    memberRows,
    roleUpdates,
    get memberQueries() {
      return state.memberQueries;
    },
  };
}

/** Put a socket through the real join path, so room and role state are real. */
async function join(h: Harness, socket: any) {
  await h.gateway.handleJoinRoom({ sessionId: 's1' }, socket as any);
}

const DRIVER_NAV = [
  { userId: 'driver', role: 'DRIVER' },
  { userId: 'nav', role: 'NAVIGATOR' },
];

describe('joining', () => {
  it('publishes the roles with the room state', async () => {
    const h = harness(DRIVER_NAV);
    const socket = fakeSocket('sock-d', 'driver');
    await join(h, socket);

    const roomState = h.server.sent.find((s) => s.event === 'room_state');
    // Without this the client cannot know whether to make the editor
    // read-only, and a navigator would type into a server that discards it.
    expect(roomState?.payload.roles).toEqual({ driver: 'DRIVER', nav: 'NAVIGATOR' });
  });

  it('refuses a socket that is not a member of the session', async () => {
    const h = harness(DRIVER_NAV);
    const stranger = fakeSocket('sock-x', 'someone-else');
    await join(h, stranger);

    expect(stranger.joinedRoom).toBeNull();
    expect(stranger.emitted.map((e) => e.event)).toContain('auth_error');
  });
});

describe('only the driver types', () => {
  it('discards a code_change from the navigator and says why', async () => {
    const h = harness(DRIVER_NAV);
    const navigator = fakeSocket('sock-n', 'nav');
    await join(h, navigator);
    navigator.emitted.length = 0;
    navigator.toRoom.length = 0;

    await h.gateway.handleCodeChange(
      { sessionId: 's1', code: 'class A {}' },
      navigator as any,
    );

    // Not broadcast, not logged: a CODE_EDIT row attributed to the navigator
    // is exactly the row that makes navigator_edit_count non-zero, which the
    // model was trained to never see.
    expect(navigator.toRoom).toHaveLength(0);
    expect(h.events.filter((e) => e.eventType === 'CODE_EDIT')).toHaveLength(0);
    expect(navigator.emitted.map((e) => e.event)).toContain('edit_rejected');
  });

  it('accepts a code_change from the driver', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    await join(h, driver);

    await h.gateway.handleCodeChange(
      { sessionId: 's1', code: 'class A {}' },
      driver as any,
    );

    expect(driver.toRoom.map((m) => m.event)).toContain('code_update');
    expect(h.events.filter((e) => e.eventType === 'CODE_EDIT')).toHaveLength(1);
  });

  it('does not read the database on every keystroke', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    await join(h, driver);
    const afterJoin = h.memberQueries;

    for (let i = 0; i < 25; i += 1) {
      await h.gateway.handleCodeChange({ sessionId: 's1', code: `x${i}` }, driver as any);
    }

    // The role check runs on every edit. If it cost a query each time nobody
    // would keep it, and the constraint would go back to being advisory.
    expect(h.memberQueries).toBe(afterJoin);
  });

  it('follows the roles after a swap', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    const navigator = fakeSocket('sock-n', 'nav');
    await join(h, driver);
    await join(h, navigator);

    await h.gateway.handleRoleSwitch({ sessionId: 's1' }, driver as any);

    // The cache is the thing being tested: a swap that updates the database
    // but not the cache would keep enforcing the old roles indefinitely.
    driver.toRoom.length = 0;
    navigator.toRoom.length = 0;
    await h.gateway.handleCodeChange({ sessionId: 's1', code: 'a' }, navigator as any);
    await h.gateway.handleCodeChange({ sessionId: 's1', code: 'b' }, driver as any);

    expect(navigator.toRoom.map((m) => m.event)).toContain('code_update');
    expect(driver.toRoom).toHaveLength(0);
    expect(driver.emitted.map((e) => e.event)).toContain('edit_rejected');
  });
});

describe('swapping roles', () => {
  it('swaps both members and broadcasts the result', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    await join(h, driver);

    await h.gateway.handleRoleSwitch({ sessionId: 's1' }, driver as any);

    expect(h.memberRows.find((m) => m.userId === 'driver')!.role).toBe('NAVIGATOR');
    expect(h.memberRows.find((m) => m.userId === 'nav')!.role).toBe('DRIVER');

    const broadcast = h.server.sent.find((s) => s.event === 'role_switch');
    expect(broadcast?.payload.roles).toEqual({ driver: 'NAVIGATOR', nav: 'DRIVER' });
  });

  it('refuses to swap a session with only one member', async () => {
    const h = harness([{ userId: 'driver', role: 'DRIVER' }]);
    const driver = fakeSocket('sock-d', 'driver');
    await join(h, driver);
    driver.emitted.length = 0;

    await h.gateway.handleRoleSwitch({ sessionId: 's1' }, driver as any);

    // Flipping a lone member makes them the navigator of an empty pair, and
    // since the navigator cannot type, the session becomes unusable with no
    // way back.
    expect(h.roleUpdates).toHaveLength(0);
    expect(h.memberRows[0].role).toBe('DRIVER');
    expect(driver.emitted.map((e) => e.event)).toContain('role_switch_rejected');
  });
});

describe('the stored record', () => {
  it('records which role the author held', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    await join(h, driver);

    await h.gateway.handleCodeChange({ sessionId: 's1', code: 'x' }, driver as any);

    const edit = h.events.find((e) => e.eventType === 'CODE_EDIT');
    // Every event ever written had role: ''. Live prediction was unaffected -
    // it sends the role map separately - but nobody reading the corpus back
    // could tell a driver's edit from a navigator's, which is what the
    // annotation codebook is written against.
    expect(edit!.role).toBe('DRIVER');
  });

  it('records a role switch against the role its author was leaving', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    await join(h, driver);

    await h.gateway.handleRoleSwitch({ sessionId: 's1' }, driver as any);

    const swap = h.events.find((e) => e.eventType === 'ROLE_SWITCH');
    // Not 'NAVIGATOR', which is what they became. "Who gave up the keyboard"
    // is the question this row has to answer.
    expect(swap!.role).toBe('DRIVER');
  });
});

describe('discussion notes', () => {
  it('broadcasts and stores the text', async () => {
    const h = harness(DRIVER_NAV);
    const navigator = fakeSocket('sock-n', 'nav');
    await join(h, navigator);
    navigator.toRoom.length = 0;

    await h.gateway.handleDiscussionNote(
      { sessionId: 's1', note: '  that loop starts at 1  ' },
      navigator as any,
    );

    const sent = navigator.toRoom.find((m) => m.event === 'discussion_note');
    expect((sent?.payload as any).note).toBe('that loop starts at 1');
    expect((sent?.payload as any).userId).toBe('nav');

    const logged = h.events.find((e) => e.eventType === 'DISCUSSION_NOTE');
    // The codebook says to read what they wrote, not how much. That is only
    // possible if the words are actually in the row.
    expect(JSON.parse(logged!.metadata).note).toBe('that loop starts at 1');
  });

  it('records nothing for a note with no text', async () => {
    const h = harness(DRIVER_NAV);
    const navigator = fakeSocket('sock-n', 'nav');
    await join(h, navigator);
    navigator.toRoom.length = 0;

    // Exactly the shape the unified client used to send: the text under a key
    // this handler does not read. It logged a DISCUSSION_NOTE event whose
    // metadata was {} and broadcast note: undefined - so the pair's apparent
    // engagement rose while nothing was said or delivered.
    await h.gateway.handleDiscussionNote(
      { sessionId: 's1', message: 'hello' } as any,
      navigator as any,
    );
    await h.gateway.handleDiscussionNote({ sessionId: 's1', note: '   ' }, navigator as any);
    await h.gateway.handleDiscussionNote({ sessionId: 's1' } as any, navigator as any);

    expect(h.events.filter((e) => e.eventType === 'DISCUSSION_NOTE')).toHaveLength(0);
    expect(navigator.toRoom).toHaveLength(0);
  });

  it('takes the author from the handshake, not the message body', async () => {
    const h = harness(DRIVER_NAV);
    const navigator = fakeSocket('sock-n', 'nav');
    await join(h, navigator);
    navigator.toRoom.length = 0;

    await h.gateway.handleDiscussionNote(
      { sessionId: 's1', note: 'hi', userId: 'driver', userName: 'Someone Else' } as any,
      navigator as any,
    );

    const sent = navigator.toRoom.find((m) => m.event === 'discussion_note');
    expect((sent?.payload as any).userId).toBe('nav');
    expect((sent?.payload as any).userName).toBeUndefined();
  });
});

describe('ending a session', () => {
  it('tells the room and releases the session working state', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    await join(h, driver);

    h.gateway.notifySessionEnded('s1');

    const ended = h.server.sent.find((s) => s.event === 'session_ended');
    expect(ended?.room).toBe('s1');
    // Roles are dropped with everything else; a completed session must not
    // keep answering questions about who was driving.
    expect((h.gateway as any).sessionRoles.has('s1')).toBe(false);
  });

  it('is safe before the server has been attached', () => {
    const h = harness(DRIVER_NAV);
    (h.gateway as any).server = undefined;

    // SessionsService calls this on the REST path, which can run during
    // startup before the gateway has its server. Ending a session must not
    // fail because nobody is listening.
    expect(() => h.gateway.notifySessionEnded('s1')).not.toThrow();
  });
});

describe('leaving', () => {
  it('forgets a room once it is empty', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    await join(h, driver);

    h.gateway.handleDisconnect(driver as any);

    // The 60s sweep walks every room in this map and asks the ML service
    // about each one. Rooms that are never removed make that sweep grow for
    // the life of the process.
    expect((h.gateway as any).rooms.has('s1')).toBe(false);
    expect((h.gateway as any).sessionRoles.has('s1')).toBe(false);
  });

  it('keeps the room while the partner is still in it', async () => {
    const h = harness(DRIVER_NAV);
    const driver = fakeSocket('sock-d', 'driver');
    const navigator = fakeSocket('sock-n', 'nav');
    await join(h, driver);
    await join(h, navigator);

    h.gateway.handleDisconnect(driver as any);

    expect((h.gateway as any).rooms.get('s1').size).toBe(1);
  });
});
