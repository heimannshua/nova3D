import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {hiddenStates, isHiddenState, mergeStatus, parseStatusReply, type HiddenState, type StatusReply} from '@/lib/hidden-state';

// The merge rule of two status replies (Story 1.8, AC-2): deleted is terminal, the higher revision wins, at equal revisions the more
// restrictive state wins, and a lower revision never replaces a higher one. It is pure and has no imports, so a device, a worker and
// these tests all use the one rule.
const reply = (state: HiddenState, revision: number): StatusReply => ({state, revision});

describe('mergeStatus: the rule', () => {
  it('takes the first reply when nothing is known', () => {
    for (const state of hiddenStates) expect(mergeStatus(null, reply(state, 3))).toEqual(reply(state, 3));
  });

  it('never replaces a known deletion, whatever the reply says or carries (a tombstone is never downgraded)', () => {
    const known = reply('deleted', 3);
    for (const state of hiddenStates) {
      for (const revision of [1, 3, 4, 99]) expect(mergeStatus(known, reply(state, revision)), `${state}@${revision}`).toBe(known);
    }
  });

  it('lets a deletion replace anything known, at any revision: it is terminal', () => {
    for (const state of ['active', 'disabled'] as const) {
      for (const revision of [1, 5, 6, 99]) expect(mergeStatus(reply(state, 5), reply('deleted', revision)), `${state}@5 then deleted@${revision}`).toEqual(reply('deleted', revision));
    }
  });

  it('keeps a known disable at revision 5 against an older active reply at 4 (a stale reply)', () => {
    const known = reply('disabled', 5);
    expect(mergeStatus(known, reply('active', 4))).toBe(known);
  });

  it('lets a newer revision replace an older one, in either direction: an active reply at 6 replaces disabled at 5', () => {
    expect(mergeStatus(reply('disabled', 5), reply('active', 6))).toEqual(reply('active', 6));
    expect(mergeStatus(reply('active', 5), reply('disabled', 6))).toEqual(reply('disabled', 6));
    expect(mergeStatus(reply('active', 5), reply('active', 6))).toEqual(reply('active', 6));
  });

  it('never lets a lower revision replace a higher one, whatever the states', () => {
    for (const known of hiddenStates.filter((state) => state !== 'deleted')) {
      for (const incoming of hiddenStates.filter((state) => state !== 'deleted')) {
        const kept = reply(known, 8);
        expect(mergeStatus(kept, reply(incoming, 7)), `${incoming}@7 after ${known}@8`).toBe(kept);
      }
    }
  });

  it('keeps the more restrictive state at equal revisions: deleted over disabled over active', () => {
    expect(mergeStatus(reply('active', 5), reply('disabled', 5))).toEqual(reply('disabled', 5));
    expect(mergeStatus(reply('disabled', 5), reply('active', 5))).toEqual(reply('disabled', 5));
    expect(mergeStatus(reply('active', 5), reply('deleted', 5))).toEqual(reply('deleted', 5));
    expect(mergeStatus(reply('disabled', 5), reply('deleted', 5))).toEqual(reply('deleted', 5));
    expect(mergeStatus(reply('deleted', 5), reply('disabled', 5))).toEqual(reply('deleted', 5));
  });

  it('keeps what it knew when the same thing is said again', () => {
    for (const state of hiddenStates) {
      const known = reply(state, 5);
      expect(mergeStatus(known, reply(state, 5))).toBe(known);
    }
  });

  // A Project's reply revision is its own revision plus its Account's authorization epoch (the amended spec), so each of the Account's
  // disable and re-enable raises it. These are the numbers a Project of revision 1 sends as its Account goes through epochs 1, 2 and 3.
  it('lifts a Project that is disabled because its Account is, when the Account is enabled again: its reply after the re-enable carries a higher number', () => {
    const opened = reply('active', 1 + 1);
    const disabledWithItsAccount = reply('disabled', 1 + 2);
    const enabledAgain = reply('active', 1 + 3);
    expect(mergeStatus(mergeStatus(null, opened), disabledWithItsAccount)).toEqual(disabledWithItsAccount);
    expect(mergeStatus(disabledWithItsAccount, enabledAgain)).toEqual(enabledAgain);
    // ... and an `active` reply that merely repeats the disabled number still does not lift it (the rule for equal revisions is unchanged).
    expect(mergeStatus(disabledWithItsAccount, reply('active', 3))).toBe(disabledWithItsAccount);
    // A rename raises the number too, so the lifted Project stays above what it was.
    expect(mergeStatus(enabledAgain, reply('active', 2 + 3))).toEqual(reply('active', 5));
  });

  it('is pure: it changes neither argument and returns one of them', () => {
    const known = Object.freeze(reply('disabled', 5));
    const incoming = Object.freeze(reply('active', 6));
    const merged = mergeStatus(known, incoming);
    expect(merged).toBe(incoming);
    expect(known).toEqual(reply('disabled', 5));
  });

  it('gives the same final answer whatever the order the replies arrive in (a deletion wins, otherwise the highest revision, ties to the more restrictive)', () => {
    const replies = [reply('active', 1), reply('disabled', 2), reply('active', 3), reply('disabled', 3), reply('active', 2)];
    const orders = [replies, [...replies].reverse(), [replies[3], replies[0], replies[4], replies[2], replies[1]], [replies[2], replies[4], replies[1], replies[3], replies[0]]];
    for (const order of orders) expect(order.reduce<StatusReply | null>((known, next) => mergeStatus(known, next), null)).toEqual(reply('disabled', 3));
    const withDeletion = [...replies, reply('deleted', 2)];
    for (const order of [withDeletion, [...withDeletion].reverse()]) expect(order.reduce<StatusReply | null>((known, next) => mergeStatus(known, next), null)).toEqual(reply('deleted', 2));
  });
});

describe('parseStatusReply', () => {
  it('reads a reply the status route sends, and nothing else', () => {
    expect(parseStatusReply({state: 'active', revision: 1})).toEqual(reply('active', 1));
    expect(parseStatusReply({state: 'deleted', revision: 12, extra: 'ignored'})).toEqual(reply('deleted', 12));
    for (const bad of [null, undefined, 'active', [], {}, {state: 'unknown'}, {state: 'unknown', revision: 1}, {state: 'active'}, {state: 'active', revision: 0}, {state: 'active', revision: -1}, {state: 'active', revision: 1.5}, {state: 'active', revision: '1'}, {state: 'ACTIVE', revision: 1}, {state: 'active', revision: Number.MAX_SAFE_INTEGER + 1}]) {
      expect(parseStatusReply(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('names the three states', () => {
    expect([...hiddenStates]).toEqual(['active', 'disabled', 'deleted']);
    expect(isHiddenState('disabled')).toBe(true);
    expect(isHiddenState('unknown')).toBe(false);
  });
});

describe('the module', () => {
  it('has no imports and touches no server or browser global, so any client can use it', () => {
    const source = readFileSync(join(import.meta.dirname, '../../lib/hidden-state.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/^import\s|\brequire\(|\bprocess\b|\bwindow\b|\bdocument\b|\bBuffer\b|\bfetch\(/m);
  });
});
