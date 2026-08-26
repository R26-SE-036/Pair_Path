import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RunJavaDto } from './dto/run-java.dto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

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

@Injectable()
export class CodeRunnerService implements OnModuleInit {
  private readonly logger = new Logger(CodeRunnerService.name);
  private dockerAvailable = false;

  // Host-JDK resolution for the unsandboxed dev path. A machine with several
  // Java installs can put `javac` and `java` on different major versions
  // (classic symptom: UnsupportedClassVersionError at run time), so pin both
  // to one JDK when we can and otherwise compile down to whatever the local
  // runtime accepts.
  private javacBin = 'javac';
  private javaBin = 'java';
  private releaseFlag = '';

  async onModuleInit() {
    try {
      await execAsync('docker version --format "{{.Server.Version}}"', { timeout: 10000 });
      this.dockerAvailable = true;
      this.logger.log(`Sandboxed execution enabled (image: ${SANDBOX_IMAGE})`);
      return;
    } catch {
      this.dockerAvailable = false;
      if (process.env.CODE_RUNNER_ALLOW_UNSANDBOXED === 'true') {
        this.logger.warn(
          'Docker unavailable — running UNSANDBOXED because CODE_RUNNER_ALLOW_UNSANDBOXED=true. ' +
            'Never use this mode with real participants (L10 ethical blocker).',
        );
      } else {
        this.logger.error(
          'Docker unavailable. Code execution is DISABLED. ' +
            'Install Docker, or set CODE_RUNNER_ALLOW_UNSANDBOXED=true for local dev only.',
        );
        return;
      }
    }
    await this.resolveHostJdk();
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

    if (!this.dockerAvailable && process.env.CODE_RUNNER_ALLOW_UNSANDBOXED !== 'true') {
      return {
        success: false,
        stdout: '',
        stderr: 'Code execution is temporarily unavailable (sandbox not running).',
        compileError: null,
      };
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
