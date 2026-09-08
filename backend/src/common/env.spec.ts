/// <reference types="jest" />
//
// The reference is explicit because tsconfig.json sets no `types` array and
// ts-jest was still not picking @types/jest up - `Cannot find name 'expect'`.
// Adding "types": ["node", "jest"] to tsconfig would fix it too, but an
// explicit list turns OFF automatic inclusion of every other @types package,
// which risks the production build to fix a test file.

import { assertRequiredEnv, mlServiceUrl } from './env';

/**
 * Regression tests for the ML_SERVICE_URL guard.
 *
 * The guard exists because ML_SERVICE_URL used to default to
 * http://localhost:8000 - Code Coach's port - so PairPath posted its feature
 * vectors at the identity provider and fell back to a hardcoded PRODUCTIVE
 * prediction when the reply did not parse. The classifier was silently not
 * running.
 *
 * It then over-corrected: rejecting :8000 on ANY host meant the API refused to
 * start in the compose stack, where `pairpath-ml` legitimately listens on 8000
 * inside its own container. These tests pin both halves so neither returns.
 */
describe('mlServiceUrl', () => {
  const original = process.env.ML_SERVICE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = original;
  });

  const set = (value?: string) => {
    if (value === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = value;
  };

  it('refuses to start when unset', () => {
    set(undefined);
    expect(() => mlServiceUrl()).toThrow(/ML_SERVICE_URL/);
  });

  // The original bug, in every spelling of "this machine".
  it.each([
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:8000/',
  ])('rejects %s, which is Code Coach on this machine', (url) => {
    set(url);
    expect(() => mlServiceUrl()).toThrow(/Code Coach/);
  });

  // The over-correction. A named host's 8000 is somebody else's 8000.
  it.each([
    'http://pairpath-ml:8000',
    'http://ml.internal:8000',
    'http://10.0.1.7:8000',
  ])('accepts %s, which is a different host entirely', (url) => {
    set(url);
    expect(mlServiceUrl()).toBe(url);
  });

  it('accepts the local ml-service on its own port', () => {
    set('http://127.0.0.1:8020');
    expect(mlServiceUrl()).toBe('http://127.0.0.1:8020');
  });

  it('rejects a value that is not a URL at all', () => {
    set('not a url');
    expect(() => mlServiceUrl()).toThrow(/valid URL/);
  });
});

describe('the unsandboxed code-runner flag', () => {
  /*
   * CODE_RUNNER_ALLOW_UNSANDBOXED=true runs student Java with the API's own
   * permissions, including read access to the credentials in .env. It is
   * correct on a development machine with no Docker and nowhere else.
   */
  const saved = { ...process.env };

  beforeEach(() => {
    // assertRequiredEnv checks everything, so the cases that expect it to pass
    // need the unrelated required variables to be valid. Set here rather than
    // in each test so a new check added to that function fails one obvious
    // place instead of three scattered ones.
    process.env.JWT_SECRET = 'a-secret-long-enough-to-be-plausible';
    process.env.ML_SERVICE_URL = 'http://pairpath-ml:8000';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('refuses to start in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CODE_RUNNER_ALLOW_UNSANDBOXED = 'true';

    expect(() => assertRequiredEnv()).toThrow(/CODE_RUNNER_ALLOW_UNSANDBOXED/);
  });

  it('names the variable and the remedy', () => {
    process.env.NODE_ENV = 'production';
    process.env.CODE_RUNNER_ALLOW_UNSANDBOXED = 'true';

    // A refusal that does not say what to remove costs whoever reads it a
    // trip through the source at the worst possible moment.
    expect(() => assertRequiredEnv()).toThrow(/CODE_RUNNER_LAMBDA_FUNCTION/);
  });

  it('is allowed outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.CODE_RUNNER_ALLOW_UNSANDBOXED = 'true';

    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it('does not object to production on its own', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CODE_RUNNER_ALLOW_UNSANDBOXED;

    expect(() => assertRequiredEnv()).not.toThrow();
  });
});
