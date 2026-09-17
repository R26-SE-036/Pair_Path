/**
 * Every reference solution, compiled and run, prints its expected output.
 *
 * ======================= WHY THIS HAS TO RUN JAVA =======================
 * The expected output is what tells a pair their program is right. It was
 * written once, from the reference solution, and the bank's own comment said
 * a test re-ran all of them and would fail on any mismatch. No such test
 * existed. A typo in an expected output - or a reference solution edited
 * without updating it - would have told every pair who solved that exercise
 * that they had not, with nothing anywhere to catch it.
 *
 * So this compiles each reference solution with a real JDK, runs it, and
 * compares byte for byte (line endings aside). It is stricter than the
 * runtime check, which forgives trailing whitespace; the bank should not
 * need forgiving.
 *
 * Skipped, loudly, on a machine with no `javac` on the PATH. That is a
 * machine where this guarantee does not hold, not one where it passed.
 * =========================================================================
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { QUESTIONS } from '../../content/question-bank';

function hasJdk(): boolean {
  try {
    execFileSync('javac', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const withJdk = hasJdk();
if (!withJdk) {
  // eslint-disable-next-line no-console
  console.warn('question-bank.run.spec: no javac on PATH - reference solutions NOT verified.');
}

(withJdk ? describe : describe.skip)('every reference solution, actually run', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pairpath-bank-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(QUESTIONS.map((q) => [q.id, q] as const))(
    '%s prints exactly its expected output',
    (_id, question) => {
      // The same extraction the code runner uses to name the file.
      const className = /(?:public\s+)?class\s+([A-Za-z0-9_]+)/.exec(question.referenceSolution)?.[1];
      expect(className).toBeTruthy();

      const work = fs.mkdtempSync(path.join(root, 'q-'));
      fs.writeFileSync(path.join(work, `${className}.java`), question.referenceSolution, 'utf-8');

      execFileSync('javac', [`${className}.java`], { cwd: work, stdio: 'pipe', timeout: 60_000 });
      const printed = execFileSync('java', ['-cp', '.', className!], {
        cwd: work,
        encoding: 'utf-8',
        timeout: 30_000,
      });

      expect(printed.replace(/\r\n/g, '\n')).toBe(question.expectedOutput);
    },
    120_000,
  );
});
