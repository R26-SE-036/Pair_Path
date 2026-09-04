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
const os = require('os');
const path = require('path');

// Kept in step with the caller's constants in code-runner.service.ts.
const MAX_CODE_LENGTH = 10000;
const MAX_OUTPUT_LENGTH = 5000;
const RUN_TIMEOUT_MS = 10000;
const COMPILE_TIMEOUT_MS = 20000;

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
    execFile(command, args, options, (error, stdout, stderr) => {
      resolve({
        error,
        stdout: stdout || '',
        stderr: stderr || '',
        timedOut: Boolean(error && error.killed),
      });
    });
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

  // The class name reaches the filesystem and the java command line. The
  // caller derives it from a regex over the source, but this function is a
  // separate deployable and must not assume its caller validated anything.
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(className)) {
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
    // /tmp persists across invocations that reuse a warm execution
    // environment, and it is capped. Without this, a busy function eventually
    // fails with ENOSPC on a student's perfectly valid program.
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};
