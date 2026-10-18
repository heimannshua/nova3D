import {describe, expect, it, vi} from 'vitest';
import {attemptConfirm, attemptUnderstand, commandIdFor, commandWindowMs, confirmIdle, forgetCommandId, limitOf, problemKey, problemOf, requestKey, understandIdle} from '@/lib/request-view';
import {en} from '@/lib/i18n/en';
import {he} from '@/lib/i18n/he';

// What the two request Server Actions and the screens agree on (Story 2.1): how a call that did not answer is read, the message of each field
// problem, and the one command ID a confirmation keeps across tabs (so the same request confirmed twice is one Project).
const A = '11111111-2222-4333-8444-555555555555';
const B = '66666666-7777-4888-8999-aaaaaaaaaaaa';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe('attemptUnderstand and attemptConfirm', () => {
  it('return what the action answered', async () => {
    expect(await attemptUnderstand(async () => ({outcome: 'no_match', subjects: []}), understandIdle, new FormData())).toEqual({outcome: 'no_match', subjects: []});
    expect(await attemptConfirm(async () => ({outcome: 'reused'}), confirmIdle, new FormData())).toEqual({outcome: 'reused'});
  });

  it('read a call that did not answer as unavailable, and a confirmation that may have been saved as unknown', async () => {
    const dropped = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await attemptUnderstand(dropped, understandIdle, new FormData())).toEqual({outcome: 'unavailable'});
    expect(await attemptConfirm(dropped, confirmIdle, new FormData())).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('let a redirect through for Next.js to follow', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {digest: 'NEXT_REDIRECT;push;/projects/x;307;'});
    await expect(attemptConfirm(async () => Promise.reject(redirect), confirmIdle, new FormData())).rejects.toBe(redirect);
  });
});

describe('the message of a field problem', () => {
  it('exists in both languages for every field and kind that can occur, with the limit it names', () => {
    const cases = [
      {field: 'description', problem: 'empty'}, {field: 'description', problem: 'too_long'}, {field: 'description', problem: 'control'},
      {field: 'personalization', problem: 'too_long'}, {field: 'personalization', problem: 'control'},
      {field: 'scope', problem: 'empty'}, {field: 'scope', problem: 'too_long'}, {field: 'scope', problem: 'control'},
      {field: 'outcome', problem: 'empty'}, {field: 'outcome', problem: 'too_long'}, {field: 'outcome', problem: 'control'},
      {field: 'subject', problem: 'not_a_match'},
    ] as const;
    const keys = cases.map((problem) => problemKey(problem));
    expect(new Set(keys).size).toBe(cases.length);
    for (const key of keys) {
      expect(en[key], key).toBeTruthy();
      expect(he[key], key).toBeTruthy();
    }
    expect([limitOf('description'), limitOf('personalization'), limitOf('scope'), limitOf('outcome')]).toEqual([2000, 300, 300, 300]);
  });

  it('finds the problem of a field among several', () => {
    const problems = [{field: 'scope', problem: 'empty'}, {field: 'outcome', problem: 'too_long'}] as const;
    expect(problemOf(problems, 'outcome')).toBe('too_long');
    expect(problemOf(problems, 'description')).toBeNull();
  });
});

describe('requestKey', () => {
  it('is the same for the same request and differs when any part differs, and holds none of the text', () => {
    const request = ['Build the altar', 'Add "David"', 'middot-altar-ramp', 'The outer altar', 'A model'];
    expect(requestKey(request)).toBe(requestKey([...request]));
    for (let index = 0; index < request.length; index += 1) expect(requestKey(request.map((part, at) => (at === index ? `${part}!` : part)))).not.toBe(requestKey(request));
    expect(requestKey(['a', 'bc'])).not.toBe(requestKey(['ab', 'c']));
    expect(requestKey(request)).toMatch(/^[0-9a-f]{1,14}$/);
    expect(requestKey(request)).not.toContain('altar');
    expect(requestKey(['ש', 'דוד'])).toMatch(/^[0-9a-f]+$/);
  });
});

describe('commandIdFor: the same request confirmed in another tab is the same command', () => {
  const key = requestKey(['request']);

  it('keeps the proposed ID the first time, and gives it again to the same request', () => {
    const storage = new MemoryStorage();
    expect(commandIdFor(key, A, storage, 1_000)).toBe(A);
    expect(commandIdFor(key, B, storage, 2_000)).toBe(A);
  });

  it('gives another request its own ID', () => {
    const storage = new MemoryStorage();
    commandIdFor(key, A, storage, 1_000);
    expect(commandIdFor(requestKey(['another']), B, storage, 2_000)).toBe(B);
    expect(commandIdFor(key, B, storage, 3_000)).toBe(A);
  });

  it('forgets an attempt when the window has passed: the same words are then a new request', () => {
    const storage = new MemoryStorage();
    commandIdFor(key, A, storage, 1_000);
    expect(commandIdFor(key, B, storage, 1_000 + commandWindowMs - 1)).toBe(A);
    expect(commandIdFor(key, B, storage, 1_000 + commandWindowMs)).toBe(B);
  });

  it('stores nothing until a confirmation is attempted, and never the text of a request', () => {
    const storage = new MemoryStorage();
    expect(storage.items.size).toBe(0);
    commandIdFor(requestKey(['Build the altar and ramp']), A, storage, 1_000);
    expect(storage.items.size).toBe(1);
    expect([...storage.items.values()].join()).not.toContain('altar');
  });

  it('keeps only the twenty most recent attempts', () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 25; index += 1) commandIdFor(requestKey([`request ${index}`]), `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, storage, 1_000 + index);
    const kept = JSON.parse(storage.getItem('nova3d-request-commands') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(kept)).toHaveLength(20);
    expect(Object.keys(kept)).toContain(requestKey(['request 24']));
    expect(Object.keys(kept)).not.toContain(requestKey(['request 0']));
  });

  it('forgets an ID the database refused, so the request is sent again under a new one', () => {
    const storage = new MemoryStorage();
    commandIdFor(key, A, storage, 1_000);
    forgetCommandId(A, storage, 2_000);
    expect(commandIdFor(key, B, storage, 3_000)).toBe(B);
  });

  it('works without storage, with storage that throws, and with storage that holds nonsense', () => {
    expect(commandIdFor(key, A, null)).toBe(A);
    forgetCommandId(A, null);
    const broken = {getItem: vi.fn(() => { throw new Error('blocked'); }), setItem: vi.fn(() => { throw new Error('blocked'); })};
    expect(commandIdFor(key, A, broken, 1_000)).toBe(A);
    forgetCommandId(A, broken, 1_000);
    for (const nonsense of ['not json', '[]', 'null', '{"x":1}', JSON.stringify({[key]: {id: 3, at: 'now'}}), JSON.stringify({[key]: {id: A, at: 5_000_000}})]) {
      const storage = new MemoryStorage();
      storage.setItem('nova3d-request-commands', nonsense);
      expect(commandIdFor(key, B, storage, 1_000), nonsense).toBe(B);
    }
  });
});
