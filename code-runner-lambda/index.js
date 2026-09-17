/**
 * Code Guru — Java code runner, as an AWS Lambda container image.
 *
 * Compiles and runs one student Java file and returns what it printed.
 *
 * ==================== WHY THIS IS A LAMBDA ====================
 * PairPath's API used to do this itself, by shelling out to `docker run`. That
 * works on a laptop and nowhere else worth deploying to: neither ECS Fargate
 * nor Cloud Run gives a container a Docker daemon, and the alternative -
 * mounting the host's /var/run/docker.sock into the API container - hands
 * anything that escapes the sandbox effective root on the host. PairPath's own
 * docs/deployment.md names the risk: student code would run "with the API's
 * permissions, including read access to .env and its database credentials".
 *
 * A Lambda is a stronger boundary than the container it replaces, not a weaker
 * one. Each invocation gets a Firecracker microVM with its own kernel, and it
 * is destroyed afterwards - so isolation no longer depends on the API process
 * getting its `docker run` flags right. It also removes the last reason to run
 * any EC2 instance in this architecture.
 *
 * The trade is a cold start of roughly 1-3 seconds on the first invocation
 * after a quiet period, against a container start of a similar order.
 * ==============================================================
 *
 * DEPLOYMENT NOTES
 *
 * - Give the function NO network. A Lambda outside a VPC has full internet
 *   egress by default. Attach it to a private subnet with no NAT gateway, so
 *   student code cannot call out. This replaces `docker run --network none`.
 * - Memory doubles as the CPU control: 1024 MB is roughly one vCPU.
 * - Set the function timeout above COMPILE + RUN below, or Lambda kills the
 *   invocation before this handler can return a readable error.
 * - Grant the API's task role lambda:InvokeFunction on this function and
 *   nothing else.
 */

'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

// Kept in step with the caller's constants in code-runner.service.ts.
const MAX_CODE_LENGTH = 10000;
const MAX_OUTPUT_LENGTH = 5000;
const RUN_TIMEOUT_MS = 10000;
const COMPILE_TIMEOUT_MS = 20000;

/**
 * How much a program may print before it is cut off.
 *
 * execFile defaults this to 1 MB and, on overflow, kills the child and sets
 * `error.killed` - the same flag a timeout sets. A program printing a lot of
 * output was therefore reported as "Execution timed out. An infinite loop?",
 * which is a confident and wrong answer to give a student whose program simply
 * printed a large array.
 *
 * Declared rather than inherited so the number is visible next to the 5000
 * characters that actually reach the browser: everything past MAX_OUTPUT_LENGTH
 * is truncated anyway, so this only has to be comfortably larger than that.
 */
const MAX_BUFFER_BYTES = 1024 * 1024;

// Lambda gives every invocation a writable /tmp and nothing else writable.
const WORK_ROOT = '/tmp';

function truncate(output) {
  if (!output) return '';
  return output.length > MAX_OUTPUT_LENGTH
    ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n...[truncated]'
    : output;
}

/**
 * execFile, not exec: exec runs the command through a shell, so a class name
 * carrying shell metacharacters would be interpreted rather than passed along.
 * The caller validates the class name too, but the safe call is free here.
 */
function run(command, args, options) {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      { ...options, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        // `killed` is set by BOTH a timeout and a maxBuffer overflow, so it
        // cannot tell them apart on its own. Node reports the overflow through
        // a string error code; a program that exits non-zero gets a number.
        const overflowed = error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

        resolve({
          error,
          stdout: stdout || '',
          stderr: stderr || '',
          timedOut: Boolean(error && error.killed) && !overflowed,
          overflowed: Boolean(overflowed),
        });
      },
    );

    /*
     * Close stdin immediately.
     *
     * execFile leaves the child's stdin pipe open with nobody ever writing to
     * it, so `new Scanner(System.in).nextLine()` blocked until the 10s timeout
     * and the student was told their program had an infinite loop. It has no
     * loop; it is waiting for input that this runner has no way to supply.
     *
     * Closed, the read hits EOF at once and Java raises NoSuchElementException
     * - which is a true statement about a program asking for input here, and
     * arrives in a second rather than in ten.
     */
    child.stdin?.end();
  });
}

exports.handler = async (event) => {
  const code = event && event.code;
  const className = event && event.className;

  if (typeof code !== 'string' || typeof className !== 'string') {
    return {
      success: false,
      stdout: '',
      stderr: 'Invalid request: className and code are required.',
      compileError: null,
    };
  }

  if (code.length > MAX_CODE_LENGTH) {
    return {
      success: false,
      stdout: '',
      stderr: `Code exceeds ${MAX_CODE_LENGTH} characters.`,
      compileError: null,
    };
  }

  /*
   * The class name reaches the filesystem and the java command line. The
   * caller derives it from a regex over the source, but this function is a
   * separate deployable and must not assume its caller validated anything.
   *
   * Deliberately the SAME character set as the caller's regex, which it did
   * not used to be: this accepted `$` and rejected a leading digit, the caller
   * did the opposite. Java allows `$` in an identifier and the caller's other
   * two execution modes build a shell command line, where `A$B` expands to
   * `A` - so `$` is excluded on both sides rather than accepted on one.
   */
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(className)) {
    return {
      success: false,
      stdout: '',
      stderr: 'Invalid class name.',
      compileError: null,
    };
  }

  const workDir = await fs.mkdtemp(path.join(WORK_ROOT, 'run-'));

  try {
    await fs.writeFile(path.join(workDir, `${className}.java`), code, 'utf-8');

    const compiled = await run('javac', [`${className}.java`], {
      cwd: workDir,
      timeout: COMPILE_TIMEOUT_MS,
    });

    if (compiled.error) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        compileError: truncate(
          compiled.timedOut
            ? 'Compilation timed out.'
            : compiled.overflowed
              ? 'The compiler produced more output than can be shown.'
              : compiled.stderr || compiled.error.message,
        ),
      };
    }

    const executed = await run('java', ['-Xmx128m', className], {
      cwd: workDir,
      timeout: RUN_TIMEOUT_MS,
    });

    if (executed.error) {
      return {
        success: false,
        stdout: truncate(executed.stdout),
        stderr: truncate(
          executed.timedOut
            ? `Execution timed out after ${RUN_TIMEOUT_MS / 1000}s. An infinite loop?`
            : executed.overflowed
              ? // Distinguished from the timeout because the remedy differs: a
                // program printing inside a loop is not the same bug as one
                // that never terminates, and "an infinite loop?" sends a
                // student looking for the wrong thing.
                'Your program printed more output than can be shown. Printing inside a loop?'
              : executed.stderr || executed.error.message,
        ),
        compileError: null,
      };
    }

    return {
      success: true,
      stdout: truncate(executed.stdout),
      stderr: truncate(executed.stderr),
      compileError: null,
    };
  } finally {
    /*
     * /tmp persists across invocations that reuse a warm execution
     * environment, and it is capped. Without this, a busy function eventually
     * fails with ENOSPC on a student's perfectly valid program.
     *
     * A failure here is logged rather than swallowed. It cannot be allowed to
     * replace the result the student is waiting for - hence the catch - but a
     * cleanup that starts failing every time is exactly the fault that
     * produces that ENOSPC weeks later, and it should not be invisible until
     * then. Observed while testing this handler on Windows, where a killed
     * process keeps a handle on its own working directory: on Linux the
     * unlink succeeds regardless, which is why nobody had seen it fail.
     */
    await fs
      .rm(workDir, { recursive: true, force: true })
      .catch((error) => console.error(`Could not remove ${workDir}: ${error.message}`));
  }
};
