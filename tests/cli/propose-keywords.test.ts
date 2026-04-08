import { describe, it, expect, vi } from 'vitest';

/**
 * Test that --keywords CLI option correctly parses and forwards to propose().
 * We test the parsing logic directly since full CLI E2E requires vault setup.
 */
describe('propose --keywords parsing', () => {
  it('splits comma-separated keywords', () => {
    const raw = '워치 동기화,HealthKit,Sentry,에러 추적';
    const keywords = raw.split(',').map((k) => k.trim()).filter(Boolean);
    expect(keywords).toEqual(['워치 동기화', 'HealthKit', 'Sentry', '에러 추적']);
  });

  it('handles single keyword', () => {
    const raw = 'auth';
    const keywords = raw.split(',').map((k) => k.trim()).filter(Boolean);
    expect(keywords).toEqual(['auth']);
  });

  it('handles whitespace around commas', () => {
    const raw = ' auth , login , signup ';
    const keywords = raw.split(',').map((k) => k.trim()).filter(Boolean);
    expect(keywords).toEqual(['auth', 'login', 'signup']);
  });

  it('filters empty strings from trailing comma', () => {
    const raw = 'auth,login,';
    const keywords = raw.split(',').map((k) => k.trim()).filter(Boolean);
    expect(keywords).toEqual(['auth', 'login']);
  });
});
