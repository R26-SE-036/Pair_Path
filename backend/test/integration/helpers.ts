/**
 * Talking to the running services the way a client does.
 *
 * Everything here goes over HTTP and Socket.IO. Nothing reaches into the
 * application's own classes - that is the whole point: the bugs this suite
 * exists to catch were two components each behaving correctly in isolation and
 * disagreeing about the shape between them, which no in-process test can see.
 *
 * The one exception is cleanup, which uses Prisma directly. A test that leaves
 * sessions and accounts behind pollutes the same tables the research record
 * lives in, and doing that through the API would need endpoints that
 * deliberately do not exist.
 */

import * as path from 'path';
import { io, type Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

export const API = process.env.INTEGRATION_API_URL ?? 'http://127.0.0.1:3001';

/** Everything this suite creates is named so cleanup can find it. */
export const TEST_EMAIL_MARKER = 'pairpath-itest';

export const prisma = new PrismaClient();

export interface Account {
  userId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
}

interface RequestOptions {
  token?: string;
  body?: unknown;
  method?: string;
}

export interface Response<T = any> {
  status: number;
  body: T;
}

export async function request<T = any>(
  route: string,
  { token, body, method }: RequestOptions = {},
): Promise<Response<T>> {
  const response = await fetch(`${API}${route}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed };
}

/**
 * A real account, through the real registration path.
 *
 * Registering rather than inserting a row means the tokens come from the same
 * code a student's do, so a change to how they are signed shows up here.
 */
export async function register(label: string): Promise<Account> {
  const email = `${TEST_EMAIL_MARKER}-${label}-${Date.now()}@example.test`;

  const { status, body } = await request('/auth/register', {
    body: {
      email,
      password: 'integration-suite-password',
      firstName: 'Integration',
      lastName: label,
    },
  });

  if (status !== 201 && status !== 200) {
    throw new Error(`Could not register ${email}: ${status} ${JSON.stringify(body)}`);
  }

  return {
    userId: body.user.id,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    email,
  };
}

/** A connected, authenticated socket. Rejects rather than hanging. */
export function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(API, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 8000,
    });

    const fail = (reason: string) => {
      socket.close();
      reject(new Error(`socket did not connect: ${reason}`));
    };

    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => fail(error.message));
    socket.on('auth_error', (payload: { message?: string }) =>
      fail(payload?.message ?? 'auth_error'),
    );
    setTimeout(() => fail('timed out'), 9000);
  });
}

/** The next payload for one event, or a failure naming what did not arrive. */
export function waitFor<T = any>(socket: Socket, event: string, ms = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no '${event}' within ${ms}ms`)),
      ms,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/**
 * Assert an event does NOT arrive.
 *
 * Half these tests are about something correctly not happening - a discarded
 * edit, a note with no text - and "nothing happened" needs as much evidence as
 * "the right thing happened".
 */
export async function expectNo(socket: Socket, event: string, ms = 1200): Promise<void> {
  let seen: unknown;
  const handler = (payload: unknown) => {
    seen = payload;
  };
  socket.on(event, handler);
  await new Promise((r) => setTimeout(r, ms));
  socket.off(event, handler);

  if (seen !== undefined) {
    throw new Error(`unexpected '${event}': ${JSON.stringify(seen)}`);
  }
}

/** Join a room and wait until the server confirms it. */
export async function joinRoom(socket: Socket, sessionId: string) {
  const state = waitFor<{ members: string[]; roles: Record<string, string> }>(
    socket,
    'room_state',
  );
  socket.emit('join_room', { sessionId });
  return state;
}

/**
 * Remove everything this suite created.
 *
 * Sessions first: deleting a user cascades their membership rows but leaves
 * the session behind with nobody in it, which is worse than not cleaning up at
 * all - an empty session is indistinguishable from a real one that nobody
 * joined.
 */
export async function cleanUp() {
  const users = await prisma.user.findMany({
    where: { email: { contains: TEST_EMAIL_MARKER } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;

  await prisma.pairSession.deleteMany({
    where: { members: { some: { userId: { in: ids } } } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
