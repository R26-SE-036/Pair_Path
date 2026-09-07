import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RunJavaDto } from './dto/run-java.dto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const execAsync = promisify(exec);

const MAX_CODE_LENGTH = 10000;
const MAX_OUTPUT_LENGTH = 5000;
const RUN_TIMEOUT_MS = 10000; // execution inside the container
const COMPILE_TIMEOUT_MS = 20000; // allows for container cold start

// L10: resource limits applied to every container
const SANDBOX_IMAGE = process.env.CODE_RUNNER_IMAGE || 'eclipse-temurin:17-jdk-alpine';
const SANDBOX_MEMORY = process.env.CODE_RUNNER_MEMORY || '256m';
const SANDBOX_CPUS = process.env.CODE_RUNNER_CPUS || '0.5';
const SANDBOX_PIDS = process.env.CODE_RUNNER_PIDS || '64';

/**
 * Where student code actually executes.
 *
 * ──────────────────────── WHY THERE ARE THREE ────────────────────────
 * `lambda`  Production. Each invocation is a Firecracker microVM with its own
 *           kernel, destroyed afterwards. Chosen because no serverless
 *           container platform - not ECS Fargate, not Cloud Run - gives a
 *           container a Docker daemon, so `docker run` cannot be the
 *           production path. The alternative was mounting the host's
 *           /var/run/docker.sock into the API container, which hands anything
 *           escaping the sandbox effective root on the host; docs/deployment.md
 *           already names that risk. The Lambda is a stronger boundary than the
 *           container it replaces, and it removes the last reason to run EC2.
 *
 * `docker`  Local development, unchanged. Keeps the existing flags and the
 *           existing behaviour so this refactor is not also a behaviour change.
 *
 * `host`    Development only, on a machine with no Docker, and only when
 *           CODE_RUNNER_ALLOW_UNSANDBOXED=true. Student code runs with the
 *           API's own permissions. Never with real participants.
 * ─────────────────────────────────────────────────────────────────────
 */
type ExecutionMode = 'lambda' | 'docker' | 'host' | 'disabled';

@Injectable()
export class CodeRunnerService implements OnModuleInit {
  private readonly logger = new Logger(CodeRunnerService.name);
  private dockerAvailable = false;
  private mode: ExecutionMode = 'disabled';
  private lambda?: LambdaClient;

  // Host-JDK resolution for the unsandboxed dev path. A machine with several
  // Java installs can put `javac` and `java` on different major versions
  // (classic symptom: UnsupportedClassVersionError at run time), so pin both
  // to one JDK when we can and otherwise compile down to whatever the local
  // runtime accepts.
  private javacBin = 'javac';
  private javaBin = 'java';
  private releaseFlag = '';

  async onModuleInit() {
    // Lambda wins when it is configured, whatever else is available. A
    // deployed environment that also happens to have a Docker socket must not
    // silently prefer it.
    const functionName = process.env.CODE_RUNNER_LAMBDA_FUNCTION;
    if (functionName) {
      this.lambda = new LambdaClient({});
      this.mode = 'lambda';
      this.logger.log(`Sandboxed execution via AWS Lambda (${functionName})`);
      return;
    }

    try {
      await execAsync('docker version --format "{{.Server.Version}}"', { timeout: 10000 });
      this.dockerAvailable = true;
      this.mode = 'docker';
      this.logger.log(`Sandboxed execution enabled (image: ${SANDBOX_IMAGE})`);
      return;
    } catch {
      this.dockerAvailable = false;
      if (process.env.CODE_RUNNER_ALLOW_UNSANDBOXED === 'true') {
        this.mode = 'host';
        this.logger.warn(
          'Docker unavailable — running UNSANDBOXED because CODE_RUNNER_ALLOW_UNSANDBOXED=true. ' +
            'Never use this mode with real participants (L10 ethical blocker).',
        );
      } else {
        this.mode = 'disabled';
        this.logger.error(
          'No execution backend. Code execution is DISABLED. Set ' +
            'CODE_RUNNER_LAMBDA_FUNCTION for a deployed environment, install ' +
            'Docker for local sandboxing, or set ' +
            'CODE_RUNNER_ALLOW_UNSANDBOXED=true for local dev only.',
        );
        return;
      }
    }
    await this.resolveHostJdk();
  }

  /**
   * Send the source to the code-runner Lambda and return its verdict.
   *
   * The response shape is identical to the local paths' - {success, stdout,
   * stderr, compileError} - so nothing downstream knows which backend ran.
   */
  private async runOnLambda(className: string, code: string) {
    const functionName = process.env.CODE_RUNNER_LAMBDA_FUNCTION!;

    try {
      const response = await this.lambda!.send(
        new InvokeCommand({
          FunctionName: functionName,
          // RequestResponse, not Event: the student is waiting for output.
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(JSON.stringify({ className, code })),
        }),
      );

      // A Lambda that throws still returns HTTP 200 with FunctionError set.
      // Without this check a crashed function reads as a successful run whose
      // output happens to be a stack trace.
      if (response.FunctionError) {
        this.logger.error(
          `Code runner Lambda failed (${response.FunctionError}): ` +
            `${Buffer.from(response.Payload ?? []).toString('utf-8').slice(0, 500)}`,
        );
        return {
          success: false,
          stdout: '',
          stderr: 'Code execution is temporarily unavailable.',
          compileError: null,
        };
      }

      const payload = JSON.parse(Buffer.from(response.Payload ?? []).toString('utf-8'));
      return {
        success: Boolean(payload.success),
        stdout: this.truncateOutput(payload.stdout || ''),
        stderr: this.truncateOutput(payload.stderr || ''),
        compileError: payload.compileError ? this.truncateOutput(payload.compileError) : null,
      };
    } catch (error: any) {
      // Throttling, a missing function, a denied invoke. None of these are the
      // student's fault and none should read as a compile error.
      this.logger.error(`Could not invoke the code runner Lambda: ${error?.message}`);
      return {
        success: false,
        stdout: '',
        stderr: 'Code execution is temporarily unavailable.',
        compileError: null,
      };
    }
  }

  private async resolveHostJdk() {
    const home = process.env.JAVA_HOME;
    if (home) {
      this.javacBin = `"${home}/bin/javac"`;
      this.javaBin = `"${home}/bin/java"`;
      this.logger.log(`Using JDK from JAVA_HOME: ${home}`);
      return;
    }

    const [javacMajor, javaMajor] = await Promise.all([
      this.majorVersion('javac -version'),
      this.majorVersion('java -version'),
    ]);

    if (javacMajor && javaMajor && javacMajor !== javaMajor) {
      this.releaseFlag = `--release ${javaMajor} `;
      this.logger.warn(
        `Java toolchain mismatch: javac is ${javacMajor} but java is ${javaMajor}. ` +
          `Compiling with --release ${javaMajor} so classes run on the local runtime. ` +
          `Set JAVA_HOME to a single JDK (or start Docker) to remove this workaround.`,
      );
    }
  }

  /** `javac 25.0.1` -> 25;  `java version "1.8.0_251"` -> 8. */
  private async majorVersion(cmd: string): Promise<number | null> {
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
      const m = `${stdout} ${stderr}`.match(/(\d+)(?:\.(\d+))?[.\d_]*/);
      if (!m) return null;
      return m[1] === '1' ? parseInt(m[2], 10) : parseInt(m[1], 10);
    } catch {
      return null;
    }
  }

  async runJava(runJavaDto: RunJavaDto) {
    const { code } = runJavaDto;

    // ── Validation ──
    if (!code || code.trim().length === 0) {
      return { success: false, stdout: '', stderr: 'No code provided', compileError: null };
    }

    if (code.length > MAX_CODE_LENGTH) {
      return {
        success: false,
        stdout: '',
        stderr: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters`,
        compileError: null,
      };
    }

    // Extract class name (also constrains it to a shell-safe token)
    const classMatch = code.match(/(?:public\s+)?class\s+([A-Za-z0-9_]+)/);
    if (!classMatch) {
      return {
        success: false,
        stdout: '',
        stderr: 'Could not find a valid class declaration in your code.',
        compileError: 'Expected: public class ClassName { ... }',
      };
    }
    const className = classMatch[1];

    // Defense-in-depth only — real isolation comes from the container (L10).
    const blockedPatterns = [
      /Runtime\.getRuntime/,
      /ProcessBuilder/,
      /System\.exit/,
      /java\.io\.File(?!NotFoundException)/,
      /java\.net\./,
      /java\.lang\.reflect/,
    ];
    for (const pattern of blockedPatterns) {
      if (pattern.test(code)) {
        return { success: false, stdout: '', stderr: 'Your code uses restricted APIs', compileError: null };
      }
    }

    if (this.mode === 'disabled') {
      return {
        success: false,
        stdout: '',
        stderr: 'Code execution is temporarily unavailable (sandbox not running).',
        compileError: null,
      };
    }

    // Everything above - length limits, the class-name regex, the blocked-API
    // scan - applies to every backend. Only the execution differs, so a change
    // to the rules cannot apply to one mode and not another.
    if (this.mode === 'lambda') {
      return this.runOnLambda(className, code);
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pairpath-'));

    try {
      const mainFile = path.join(tempDir, `${className}.java`);
      await fs.writeFile(mainFile, code, 'utf-8');

      const compile = this.dockerAvailable
        ? this.sandboxCmd(tempDir, 'rw', `javac ${className}.java`)
        : `${this.javacBin} ${this.releaseFlag}${className}.java`;
      const run = this.dockerAvailable
        ? this.sandboxCmd(tempDir, 'ro', `java -Xmx128m ${className}`)
        : `${this.javaBin} ${className}`;

      // Compile
      try {
        await execAsync(compile, { cwd: tempDir, timeout: COMPILE_TIMEOUT_MS });
      } catch (compileErr: any) {
        return {
          success: false,
          stdout: '',
          stderr: '',
          compileError: this.truncateOutput(
            this.stripToolchainNoise(compileErr.stderr || compileErr.message),
          ),
        };
      }

      // Run
      try {
        const result = await execAsync(run, { cwd: tempDir, timeout: RUN_TIMEOUT_MS });
        return {
          success: true,
          stdout: this.truncateOutput(result.stdout),
          stderr: this.truncateOutput(result.stderr),
          compileError: null,
        };
      } catch (runErr: any) {
        return {
          success: false,
          stdout: this.truncateOutput(runErr.stdout || ''),
          stderr: this.truncateOutput(runErr.stderr || runErr.message),
          compileError: null,
        };
      }
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }

  /**
   * L10: wrap a command in an isolated container — no network, capped memory/CPU/pids,
   * no privilege escalation, workspace mounted read-only at run time.
   */
  private sandboxCmd(tempDir: string, mount: 'rw' | 'ro', cmd: string): string {
    return [
      'docker run --rm',
      '--network none',
      `--memory ${SANDBOX_MEMORY}`,
      `--cpus ${SANDBOX_CPUS}`,
      `--pids-limit ${SANDBOX_PIDS}`,
      '--security-opt no-new-privileges',
      `-v "${tempDir}:/work:${mount}"`,
      '-w /work',
      SANDBOX_IMAGE,
      cmd,
    ].join(' ');
  }

  /**
   * Drop the `--release` compatibility warnings emitted by our own toolchain
   * workaround. A student debugging a syntax error should not have to read
   * past "source value 8 is obsolete" to find their actual mistake.
   */
  private stripToolchainNoise(output: string): string {
    if (!output) return '';
    return output
      .split('\n')
      .filter(
        (line) =>
          !/^warning: \[options\]/.test(line.trim()) &&
          !/^\d+ warnings?$/.test(line.trim()),
      )
      .join('\n')
      .trim();
  }

  private truncateOutput(output: string): string {
    if (!output) return '';
    return output.length > MAX_OUTPUT_LENGTH
      ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [output truncated]'
      : output;
  }
}
