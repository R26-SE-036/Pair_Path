import { withTimeLimits } from './database-url';

describe('withTimeLimits', () => {
  const neon =
    'postgresql://user:p%40ss@ep-x-pooler.neon.tech/pair_path?sslmode=require&pgbouncer=true';

  it('adds a query and a connect time limit, keeping everything else', () => {
    const url = new URL(withTimeLimits(neon)!);

    expect(url.searchParams.get('socket_timeout')).toBe('15');
    expect(url.searchParams.get('connect_timeout')).toBe('10');
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('pgbouncer')).toBe('true');
    expect(url.username).toBe('user');
    expect(url.password).toBe('p%40ss');
    expect(url.hostname).toBe('ep-x-pooler.neon.tech');
    expect(url.pathname).toBe('/pair_path');
  });

  it('leaves a limit the operator already set', () => {
    const url = new URL(withTimeLimits(`${neon}&socket_timeout=60`)!);
    expect(url.searchParams.getAll('socket_timeout')).toEqual(['60']);
  });

  it('passes a missing URL through as missing', () => {
    expect(withTimeLimits(undefined)).toBeUndefined();
    expect(withTimeLimits('  ')).toBeUndefined();
  });
});
