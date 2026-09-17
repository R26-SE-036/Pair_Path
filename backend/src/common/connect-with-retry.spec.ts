/**
 * Booting against a database that is still waking up.
 *
 * The API exited on its first boot because Neon had not woken yet, and a
 * restart that only happened to succeed is not a startup that works. These
 * cover waiting that out - and, as much, NOT waiting for problems that waiting
 * cannot fix.
 */

import { connectWithRetry } from './connect-with-retry';

const unreachable = () => Object.assign(new Error("Can't reach database server"), { errorCode: 'P1001' });
const noWait = async () => {};

describe('connecting to a database that is still waking up', () => {
  it('waits out a cold start and connects', async () => {
    let calls = 0;
    const retried: number[] = [];

    await connectWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw unreachable();
      },
      { sleep: noWait, onRetry: (attempt) => retried.push(attempt) },
    );

    expect(calls).toBe(3);
    expect(retried).toEqual([1, 2]);
  });

  it('backs off, caps the wait, and gives up with the original error', async () => {
    const waits: number[] = [];

    await expect(
      connectWithRetry(
        async () => {
          throw unreachable();
        },
        {
          attempts: 6,
          initialDelayMs: 1_000,
          maxDelayMs: 5_000,
          sleep: async (ms) => {
            waits.push(ms);
          },
        },
      ),
    ).rejects.toThrow("Can't reach database server");

    // Five waits between six attempts, doubling until the cap.
    expect(waits).toEqual([1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('also waits out a connection that timed out', async () => {
    let calls = 0;

    await connectWithRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('timed out'), { errorCode: 'P1002' });
      },
      { sleep: noWait },
    );

    expect(calls).toBe(2);
  });

  it('does not wait for a problem that waiting will not fix', async () => {
    // A wrong password is as wrong in a minute as it is now, and a boot that
    // spends that minute retrying just delays the one message that matters.
    const wrongPassword = Object.assign(new Error('Authentication failed'), { errorCode: 'P1000' });
    let calls = 0;

    await expect(
      connectWithRetry(
        async () => {
          calls += 1;
          throw wrongPassword;
        },
        { sleep: noWait },
      ),
    ).rejects.toBe(wrongPassword);

    expect(calls).toBe(1);
  });
});
