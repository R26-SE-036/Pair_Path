/**
 * The contracts between components, exercised against running services.
 *
 * ==================== WHY THIS SUITE HAD TO EXIST ====================
 * Every bug found in this repository this week was the same shape: two
 * components each behaving correctly on their own, disagreeing about what
 * passes between them.
 *
 *   chat            the client sent `message`; the gateway read `note`
 *   interventions   the client read `.message`; the server sent
 *                   `.delivery.message`
 *   the peer review the client read `{ questions }`; the endpoint returned a
 *                   PairSession
 *   review answers  the client sent strings; the API validated booleans
 *   the RAG hint    the server emitted `rag_hint`; nothing listened
 *
 * None produced an error. Requests succeeded, rows were written, pages
 * rendered. Two hundred unit tests were passing throughout, and not one of
 * them could have noticed - a unit test asserts a component against its own
 * idea of the contract, which is exactly the thing that was wrong.
 *
 * So these tests hold both ends at once and go over the wire.
 * =====================================================================
 */

import type { Socket } from 'socket.io-client';

import {
  Account,
  cleanUp,
  connect,
  expectNo,
  joinRoom,
  prisma,
  register,
  request,
  waitFor,
} from './helpers';

jest.setTimeout(60000);

let driver: Account;
let navigator: Account;
let stranger: Account;
let questionId: string;

beforeAll(async () => {
  [driver, navigator, stranger] = await Promise.all([
    register('driver'),
    register('navigator'),
    register('stranger'),
  ]);

  const { body: topics } = await request('/topics', { token: driver.accessToken });
  questionId = topics.flatMap((t: any) => t.questions)[0].id;
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

/** A live session with both students in the room. */
async function openSession() {
  const created = await request('/sessions', {
    token: driver.accessToken,
    body: { questionId },
  });
  expect(created.status).toBe(201);

  const joined = await request('/sessions/join', {
    token: navigator.accessToken,
    body: { joinCode: created.body.joinCode },
  });
  expect(joined.status).toBe(201);

  const sessionId: string = created.body.id;
  const driverSocket = await connect(driver.accessToken);
  const navigatorSocket = await connect(navigator.accessToken);

  await joinRoom(driverSocket, sessionId);
  await joinRoom(navigatorSocket, sessionId);

  return { sessionId, driverSocket, navigatorSocket };
}

function closeAll(...sockets: Socket[]) {
  for (const socket of sockets) socket.close();
}

describe('what a student is served', () => {
  it('never receives the reference solution', async () => {
    const { body: topics } = await request('/topics', { token: driver.accessToken });
    const questions = topics.flatMap((t: any) => t.questions);

    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question).not.toHaveProperty('referenceSolution');
    }

    // And not through the session either, which is where it actually reached
    // the browser: the workspace loads GET /sessions/:id on every open.
    const created = await request('/sessions', {
      token: driver.accessToken,
      body: { questionId },
    });
    expect(created.body.question).not.toHaveProperty('referenceSolution');
  });

  it('sees only the platform concept taxonomy', async () => {
    const { body: topics } = await request('/topics', { token: driver.accessToken });
    const tags = new Set<string>(
      topics.flatMap((t: any) => t.questions.flatMap((q: any) => q.conceptTags ?? [])),
    );

    // The old free-text tags - `arrays`, `modulo`, `bounds` - joined to no
    // lesson, no game and no detector. A stray one here means an exercise
    // nobody else in the platform can respond to.
    for (const tag of tags) {
      expect(tag).toMatch(/^[a-z]+(_[a-z]+)+$/);
    }
    expect(tags.size).toBeGreaterThanOrEqual(14);
  });

  it('refuses another pair\'s session, review and analytics', async () => {
    const created = await request('/sessions', {
      token: driver.accessToken,
      body: { questionId },
    });
    const id = created.body.id;

    for (const route of [
      `/sessions/${id}`,
      `/sessions/analytics/${id}`,
      `/reviews/${id}`,
      `/reviews/${id}/result`,
      `/interventions/session/${id}`,
    ]) {
      const { status } = await request(route, { token: stranger.accessToken });
      expect({ route, status }).toEqual({ route, status: 404 });
    }
  });

  it('will not accept a refresh token as a credential', async () => {
    // Both tokens were the same payload signed with the same secret, so the
    // seven-day one was a valid API key for seven days.
    const asBearer = await request('/topics', { token: driver.refreshToken });
    expect(asBearer.status).toBe(401);

    const refreshed = await request('/auth/refresh', {
      body: { refreshToken: driver.refreshToken },
    });
    expect(refreshed.status).toBe(201);

    // And the reverse: an access token cannot be traded for a new pair, which
    // is what let a leaked one be renewed forever.
    const wrongWay = await request('/auth/refresh', {
      body: { refreshToken: driver.accessToken },
    });
    expect(wrongWay.status).toBe(401);
  });
});

describe('the peer review', () => {
  async function completedSession() {
    const created = await request('/sessions', {
      token: driver.accessToken,
      body: { questionId },
    });
    await request('/sessions/join', {
      token: navigator.accessToken,
      body: { joinCode: created.body.joinCode },
    });
    await request(`/sessions/${created.body.id}/end`, {
      token: driver.accessToken,
      body: { finalCode: 'class A {}' },
    });
    return created.body.id as string;
  }

  it('returns the shape the client actually reads', async () => {
    const sessionId = await completedSession();
    const { status, body } = await request(`/reviews/${sessionId}`, {
      token: driver.accessToken,
    });

    expect(status).toBe(200);
    // The endpoint returned a PairSession. The client reads `questions` and
    // `alreadySubmitted`, neither of which a session has - so the form
    // rendered nothing and submitting recorded a zero.
    expect(Array.isArray(body.questions)).toBe(true);
    expect(body.questions.length).toBeGreaterThan(0);
    expect(body.questions.every((q: unknown) => typeof q === 'string')).toBe(true);
    expect(body.alreadySubmitted).toBe(false);
  });

  it('does not ship its own answer key', async () => {
    const sessionId = await completedSession();
    const { body } = await request(`/reviews/${sessionId}`, { token: driver.accessToken });

    expect(JSON.stringify(body)).not.toContain('expected');
  });

  it('scores boolean answers against what the exercise expected', async () => {
    const sessionId = await completedSession();
    const { body: form } = await request(`/reviews/${sessionId}`, {
      token: driver.accessToken,
    });

    const allYes = form.questions.map(() => true);
    const { status, body } = await request(`/reviews/${sessionId}/submit`, {
      token: driver.accessToken,
      body: { answers: allYes },
    });

    expect(status).toBe(201);
    // Answering yes to everything is no longer a perfect score: some prompts
    // expect no. Under the old instrument this was full marks.
    expect(body.score).toBeLessThan(form.questions.length);
  });

  it('refuses free text, which is what the form used to send', async () => {
    const sessionId = await completedSession();
    const { body: form } = await request(`/reviews/${sessionId}`, {
      token: driver.accessToken,
    });

    const { status } = await request(`/reviews/${sessionId}/submit`, {
      token: driver.accessToken,
      body: { answers: form.questions.map(() => 'yes, we did') },
    });

    expect(status).toBe(400);
  });

  it('refuses a submission that skips prompts', async () => {
    const sessionId = await completedSession();
    // An empty array is what the broken form sent, and it was accepted and
    // scored zero.
    const { status } = await request(`/reviews/${sessionId}/submit`, {
      token: driver.accessToken,
      body: { answers: [] },
    });

    expect(status).toBe(400);
  });

  it('reports how far the two partners agreed with each other', async () => {
    const sessionId = await completedSession();
    const { body: form } = await request(`/reviews/${sessionId}`, {
      token: driver.accessToken,
    });

    await request(`/reviews/${sessionId}/submit`, {
      token: driver.accessToken,
      body: { answers: form.questions.map(() => true) },
    });
    await request(`/reviews/${sessionId}/submit`, {
      token: navigator.accessToken,
      body: { answers: form.questions.map((_: string, i: number) => i % 2 === 0) },
    });

    const { body } = await request(`/reviews/${sessionId}/result`, {
      token: driver.accessToken,
    });

    // The point of answering separately, and it was not reported at all.
    expect(body.agreement).toMatchObject({ outOf: form.questions.length });
    expect(body.agreement.matched).toBeLessThan(form.questions.length);
    expect(body.outOf).toBe(form.questions.length);
  });
});

describe('the live session', () => {
  it('tells both students who holds which role', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    try {
      const state = await joinRoom(driverSocket, sessionId);

      expect(state.roles[driver.userId]).toBe('DRIVER');
      expect(state.roles[navigator.userId]).toBe('NAVIGATOR');
    } finally {
      closeAll(driverSocket, navigatorSocket);
    }
  });

  it('carries a discussion note to the partner, with its text', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    try {
      const arriving = waitFor<{ note: string; userId: string }>(
        driverSocket,
        'discussion_note',
      );
      navigatorSocket.emit('discussion_note', {
        sessionId,
        note: 'that loop starts at 1',
      });

      const received = await arriving;
      // Broadcast as `note: undefined` and stored as `{}`, because the client
      // sent the text under a key the gateway does not read.
      expect(received.note).toBe('that loop starts at 1');
      expect(received.userId).toBe(navigator.userId);

      const event = await prisma.sessionEvent.findFirst({
        where: { sessionId, eventType: 'DISCUSSION_NOTE' },
      });
      expect(JSON.parse(String(event!.metadata)).note).toBe('that loop starts at 1');
      // And the role, which was the empty string on every event ever written.
      expect(event!.role).toBe('NAVIGATOR');
    } finally {
      closeAll(driverSocket, navigatorSocket);
    }
  });

  it('records nothing for the shape the old client sent', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    try {
      navigatorSocket.emit('discussion_note', { sessionId, message: 'hello' });
      await expectNo(driverSocket, 'discussion_note');

      const events = await prisma.sessionEvent.count({
        where: { sessionId, eventType: 'DISCUSSION_NOTE' },
      });
      // The count fed the model while the words reached nobody, so a pair who
      // said nothing readable still looked engaged.
      expect(events).toBe(0);
    } finally {
      closeAll(driverSocket, navigatorSocket);
    }
  });

  it('discards an edit from the navigator and says why', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    try {
      const rejected = waitFor<{ message: string }>(navigatorSocket, 'edit_rejected');
      navigatorSocket.emit('code_change', { sessionId, code: 'class A {}' });

      expect((await rejected).message).toMatch(/read-only/i);
      await expectNo(driverSocket, 'code_update');

      const edits = await prisma.sessionEvent.count({
        where: { sessionId, eventType: 'CODE_EDIT' },
      });
      // Three of the model's fifteen features are computed from edit
      // attribution, so a navigator edit is not a UI slip - it is a row that
      // contradicts the training distribution.
      expect(edits).toBe(0);
    } finally {
      closeAll(driverSocket, navigatorSocket);
    }
  });

  it('broadcasts an edit from the driver', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    try {
      const update = waitFor<{ code: string }>(navigatorSocket, 'code_update');
      driverSocket.emit('code_change', { sessionId, code: 'class Ok {}' });

      expect((await update).code).toBe('class Ok {}');
    } finally {
      closeAll(driverSocket, navigatorSocket);
    }
  });

  it('swaps the roles for both students at once', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    try {
      const swapped = waitFor<{ roles: Record<string, string> }>(
        navigatorSocket,
        'role_switch',
      );
      driverSocket.emit('role_switch', { sessionId });

      const { roles } = await swapped;
      expect(roles[driver.userId]).toBe('NAVIGATOR');
      expect(roles[navigator.userId]).toBe('DRIVER');

      // And the constraint follows the swap rather than the original seating.
      const update = waitFor<{ code: string }>(driverSocket, 'code_update');
      navigatorSocket.emit('code_change', { sessionId, code: 'class Now {}' });
      expect((await update).code).toBe('class Now {}');
    } finally {
      closeAll(driverSocket, navigatorSocket);
    }
  });

  it('tells the partner when the other student ends the session', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    try {
      const ended = waitFor<{ sessionId: string }>(navigatorSocket, 'session_ended');

      // Over REST, which is how the client does it. The socket handler that
      // used to broadcast this never touched the database and was never called
      // - so the partner sat in a live workspace on a finished session.
      await request(`/sessions/${sessionId}/end`, {
        token: driver.accessToken,
        body: { finalCode: 'class Done {}' },
      });

      expect((await ended).sessionId).toBe(sessionId);

      const row = await prisma.pairSession.findUnique({ where: { id: sessionId } });
      // The row says COMPLETED before anyone is told that it is.
      expect(row!.status).toBe('COMPLETED');
    } finally {
      closeAll(driverSocket, navigatorSocket);
    }
  });

  it('refuses to reopen a session that has finished', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    closeAll(driverSocket, navigatorSocket);

    await request(`/sessions/${sessionId}/end`, {
      token: driver.accessToken,
      body: { finalCode: 'class Done {}' },
    });

    const reopened = await connect(driver.accessToken);
    try {
      const closed = waitFor<{ message: string }>(reopened, 'session_closed');
      reopened.emit('join_room', { sessionId });
      await closed;

      // join_room writes a JOIN event and opens the socket to code_change and
      // run_code, so reopening a finished session appended to the behavioural
      // record after endedAt.
      const after = await prisma.sessionEvent.count({
        where: { sessionId, eventType: 'JOIN' },
      });
      expect(after).toBe(2); // the two real joins, and nothing since
    } finally {
      reopened.close();
    }
  });

  it('refuses a socket that is not a member of the session', async () => {
    const { sessionId, driverSocket, navigatorSocket } = await openSession();
    const outsider = await connect(stranger.accessToken);
    try {
      const refused = waitFor<{ message: string }>(outsider, 'auth_error');
      outsider.emit('join_room', { sessionId });

      expect((await refused).message).toMatch(/not a member/i);
    } finally {
      closeAll(driverSocket, navigatorSocket, outsider);
    }
  });
});

describe('the ML service, through the API', () => {
  it('classifies a feature vector and says which model answered', async () => {
    const features = {
      total_edit_count: 3, driver_edit_count: 3, navigator_edit_count: 0,
      edit_balance_ratio: 1, run_attempt_count: 0, run_success_rate: 0.5,
      consecutive_failure_count: 0, error_recovery_seconds_avg: 0, idle_ratio: 0.78,
      discussion_note_count: 0, navigator_note_count: 0, role_switch_count: 0,
      seconds_since_role_switch: 450, session_elapsed_seconds: 450,
      active_user_dominance: 1,
    };

    const { status, body } = await request('/ml/predict-pair-state', {
      token: driver.accessToken,
      body: { sessionId: 'integration', features },
    });

    expect(status).toBe(201);
    expect(body.predictedState).toBe('DISENGAGED');
    // Provenance travels with the prediction, or nobody reading a confidence
    // can tell a real model from the rule-based fallback or an outage.
    expect(typeof body.modelVersion).toBe('string');
    expect(body.modelVersion.length).toBeGreaterThan(0);
    expect(Object.keys(body.features)).toHaveLength(15);
  });

  it('refuses a request that names neither events nor features', async () => {
    // Rather than predicting confidently on an all-zero vector.
    const { status } = await request('/ml/predict-pair-state', {
      token: driver.accessToken,
      body: { sessionId: 'integration' },
    });

    expect(status).toBe(400);
  });

  it('returns a three-part hint that contains no solution', async () => {
    const { status, body } = await request('/ml/retrieve-hint', {
      token: driver.accessToken,
      body: {
        sessionId: 'integration',
        predictedState: 'LOGIC_STRUGGLE',
        interventionType: 'LOGIC_HINT',
        questionConceptTags: ['loop_boundaries'],
        recentErrorContext: 'ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 5',
      },
    });

    expect(status).toBe(201);
    for (const part of ['conceptReminder', 'exampleIdea', 'reflectiveQuestion']) {
      expect(typeof body[part]).toBe('string');
      expect(body[part].length).toBeGreaterThan(0);
    }

    // A platform concept tag has to reach the corpus, which is indexed in a
    // different vocabulary - `loops`, `boundaries`, `off-by-one`. Without the
    // mapping this falls back to generic guidance and nothing says so.
    expect(body.fallbackUsed).toBe(false);

    const whole = [body.conceptReminder, body.exampleIdea, body.reflectiveQuestion].join(' ');
    for (const giveaway of ['public class', 'for (int', 'System.out.println']) {
      expect(whole).not.toContain(giveaway);
    }
  });

  it('maps a confident state to an intervention that says where to look', async () => {
    const { status, body } = await request('/ml/recommend-intervention', {
      token: driver.accessToken,
      body: { sessionId: 'integration', predictedState: 'DRIVER_DOMINANCE', confidence: 0.9 },
    });

    expect(status).toBe(201);
    expect(body.action).toBe('ROLE_SWITCH_SUPPORT');
    // uiTarget and uiEffect ARE the intervention - the engine says where to
    // draw attention and never sends solution content. The unified client
    // ignored both and rendered every nudge as one identical card.
    expect(body.delivery.uiTarget).toBe('role_switch_button');
    expect(body.delivery.uiEffect).toBe('glow');
    expect(typeof body.delivery.message).toBe('string');
  });

  it('stays silent below the confidence threshold', async () => {
    const { body } = await request('/ml/recommend-intervention', {
      token: driver.accessToken,
      body: { sessionId: 'integration', predictedState: 'DISENGAGED', confidence: 0.2 },
    });

    expect(body.action).toBe('NO_ACTION');
  });
});
