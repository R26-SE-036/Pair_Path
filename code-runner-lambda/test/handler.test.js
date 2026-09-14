/**
 * The Lambda that compiles and runs student Java.
 *
 *     npm test
 *
 * Validation tests run anywhere. The execution tests need `javac` and `java`
 * on PATH - the Lambda image provides them - and skip by name without.
 *
 * The handler writes under /tmp, which is what Lambda gives it. The tests
 * redirect that into a private directory so they run on any OS and can check
 * the handler cleans up after itself: a warm Lambda keeps /tmp between
 * invocations, and a handler that leaks directories fails later with ENOSPC on
 * a perfectly valid program.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'code-runner-test-'));
const realMkdtemp = fsp.mkdtemp;
fsp.mkdtemp = (prefix, ...rest) => realMkdtemp(path.join(WORK, path.basename(prefix)), ...rest);

const { handler } = require('../index.js');

test.after(() => {
  fsp.mkdtemp = realMkdtemp;
  // On Windows a Java process killed for timing out keeps a handle on its
  // directory for a moment after it dies - the handler logs exactly that and
  // carries on, and Linux, where the Lambda runs, does not do it. The retries
  // cover the moment; a directory that still will not go is left for the OS
  // temp cleaner rather than failing a suite whose tests all passed.
  try {
    fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(`Left ${WORK} behind: ${error.message}`);
  }
});

function javaAvailable() {
  try {
    execFileSync('javac', ['-version'], { stdio: 'ignore' });
    execFileSync('java', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const needsJava = javaAvailable()
  ? {}
  : { skip: 'javac and java are not on PATH (the Lambda image provides them)' };

const program = (body, className = 'Main') =>
  `public class ${className} {\n  public static void main(String[] args) throws Exception {\n${body}\n  }\n}\n`;

/**
 * Java ends a println line with the platform separator: \n on the Lambda,
 * \r\n on a Windows machine running these tests. The handler passes output
 * through untouched, which is right, so the comparison is what adapts.
 */
const lines = (text) => text.replace(/\r\n/g, '\n');

const leftovers = () => fs.readdirSync(WORK);

// ── Refusals ────────────────────────────────────────────────────────────────

test('refuses a request without code and a class name', async () => {
  for (const event of [undefined, null, {}, { code: 'x' }, { className: 'Main' }, { code: 1, className: 'Main' }]) {
    const result = await handler(event);
    assert.strictEqual(result.success, false);
    assert.match(result.stderr, /className and code are required/);
  }
});

test('refuses code over the size limit without touching disk', async () => {
  const result = await handler({ className: 'Main', code: 'x'.repeat(10001) });

  assert.strictEqual(result.success, false);
  assert.match(result.stderr, /exceeds 10000 characters/);
  assert.deepStrictEqual(leftovers(), []);
});

test('refuses class names that could reach a shell or a path', async () => {
  for (const className of ['', '../Evil', 'A;rm -rf /', 'A$B', 'A B', '1Main', 'Main.java', 'A\nB', '$(id)']) {
    const result = await handler({ className, code: program('') });
    assert.strictEqual(result.stderr, 'Invalid class name.', `accepted ${JSON.stringify(className)}`);
  }
  assert.deepStrictEqual(leftovers(), []);
});

// ── Execution ───────────────────────────────────────────────────────────────

test('runs a program and returns what it printed, then cleans up', needsJava, async () => {
  const result = await handler({ className: 'Main', code: program('System.out.println("Hello, Code Guru");') });

  assert.deepStrictEqual({ ...result, stdout: lines(result.stdout) }, {
    success: true,
    stdout: 'Hello, Code Guru\n',
    stderr: '',
    compileError: null,
  });
  assert.deepStrictEqual(leftovers(), [], 'the work directory was not removed');
});

test('reports a compile error as a compile error', needsJava, async () => {
  const result = await handler({ className: 'Main', code: program('int x = "not a number";') });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.stdout, '');
  assert.match(result.compileError, /incompatible types/);
});

test('reports a runtime exception with what printed before it', needsJava, async () => {
  const result = await handler({
    className: 'Main',
    code: program('System.out.println("before"); int zero = 0; System.out.println(10 / zero);'),
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(lines(result.stdout), 'before\n');
  assert.match(result.stderr, /ArithmeticException/);
  assert.strictEqual(result.compileError, null);
});

test('a program reading input fails at once instead of waiting for the timeout', needsJava, async () => {
  const started = Date.now();
  const result = await handler({
    className: 'Main',
    code: 'import java.util.Scanner;\n' + program('System.out.println(new Scanner(System.in).nextLine());'),
  });

  assert.strictEqual(result.success, false);
  assert.match(result.stderr, /NoSuchElementException/);
  assert.ok(Date.now() - started < 8000, 'stdin was left open, so the read waited for the timeout');
});

test('long output is truncated for the browser', needsJava, async () => {
  const result = await handler({
    className: 'Main',
    code: program('for (int i = 0; i < 2000; i++) System.out.println("line " + i);'),
  });

  assert.strictEqual(result.success, true);
  assert.ok(result.stdout.endsWith('\n...[truncated]'));
  assert.strictEqual(result.stdout.length, 5000 + '\n...[truncated]'.length);
});

test('flooding output is reported as too much output, not as an infinite loop', needsJava, async () => {
  const result = await handler({
    className: 'Main',
    code: program('StringBuilder s = new StringBuilder(); for (int i = 0; i < 200; i++) s.append("x"); for (int i = 0; i < 20000; i++) System.out.println(s);'),
  });

  assert.strictEqual(result.success, false);
  assert.match(result.stderr, /printed more output than can be shown/);
  assert.doesNotMatch(result.stderr, /timed out/);
});

test('a program that never ends is stopped and told so', { ...needsJava, timeout: 40000 }, async () => {
  const result = await handler({ className: 'Main', code: program('while (true) { }') });

  assert.strictEqual(result.success, false);
  assert.match(result.stderr, /timed out after 10s/);
});
