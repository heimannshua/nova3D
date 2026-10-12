import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {redirect} from 'next/navigation';
import {describe, expect, it, vi} from 'vitest';
import {catalogs, locales, type MessageKey} from '@/lib/i18n';
import {en} from '@/lib/i18n/en';
import {he} from '@/lib/i18n/he';
import {
  attemptInvitationAction,
  failureKey,
  formatCreatedAt,
  invitationActionIdle,
  invitationIdOf,
  invitationMessageKeys,
  isoOf,
  labelErrorKeys,
  labelProblem,
  maxLabelLength,
  normalizeLabel,
  statusKeys,
  type InvitationActionState,
} from '@/lib/invitations';
import {unexpectedResponseMessage} from '@/lib/session-actions';

// Story 1.11: what the invitation page, its actions and its components agree on.
const root = join(import.meta.dirname, '../..');

describe('the label rules', () => {
  it('are the database\'s: 80 characters, in the accounts table and in the issuing function', () => {
    expect(maxLabelLength).toBe(80);
    expect(readFileSync(join(root, 'supabase/migrations/20261010120000_accounts.sql'), 'utf8')).toMatch(/label text check \(label is null or length\(label\) between 1 and 80\)/);
    expect(readFileSync(join(root, 'supabase/migrations/20261010120100_api.sql'), 'utf8')).toMatch(/length\(v_label\) > 80/);
    // The messages say the number the rule uses.
    for (const locale of locales) expect(String(catalogs[locale]['invitations.named.error.tooLong'])).toContain(String(maxLabelLength));
  });

  it('trim a name, and read anything that is not text as an empty name', () => {
    expect(normalizeLabel('  Daniel \n')).toBe('Daniel');
    expect(normalizeLabel('  \t')).toBe('');
    for (const value of [null, undefined, 7, {}, [], new Blob(['x'])]) expect(normalizeLabel(value)).toBe('');
  });

  it('call an empty name empty and a name over 80 characters too long, counting characters and not code units', () => {
    expect(labelProblem('')).toBe('empty');
    expect(labelProblem('a')).toBeNull();
    expect(labelProblem('x'.repeat(80))).toBeNull();
    expect(labelProblem('x'.repeat(81))).toBe('too_long');
    expect(labelProblem('😀'.repeat(80))).toBeNull();
    expect(labelProblem('😀'.repeat(81))).toBe('too_long');
    expect(labelProblem('דנה'.repeat(27))).toBe('too_long');
    expect(labelProblem(`${'דנה'.repeat(26)}אב`)).toBeNull();
  });

  it.each([
    ['a zero-width space', '\u200b'],
    ['zero-width and directional marks', '\u200b\u200c\u200d\u200e\u200f'],
    ['a word joiner', '\u2060'],
    ['a byte order mark', '\ufeff'],
    ['a Braille blank', '\u2800'],
    ['a Hangul filler', '\u3164'],
    ['a Hangul choseong filler', '\u115f'],
    ['a Hangul jungseong filler', '\u1160'],
    ['a line separator', '\u2028'],
    ['a paragraph separator', '\u2029'],
    ['an ideographic space', '\u3000'],
    ['a no-break space and tabs', '\u00a0\t\t'],
    ['a mix of all of them', ' \u200b\u3164\u2800\n\u00a0\ufeff\u115f\u1160\u202f'],
    ['a NUL', '\u0000'],
  ])('call a name of nothing but %s empty, once normalized', (_name, typed) => {
    expect(labelProblem(normalizeLabel(typed))).toBe('empty');
    // Whatever is left of it by trimming alone is empty too, so a caller that forgot to normalize is still safe.
    expect(labelProblem(typed)).toBe('empty');
  });

  it('turns each run of control characters into one space, a NUL and a pasted newline included, and trims', () => {
    expect(normalizeLabel('Dana\u0000Cohen')).toBe('Dana Cohen');
    expect(normalizeLabel('Dana\nCohen')).toBe('Dana Cohen');
    expect(normalizeLabel('Dana\r\n\r\nCohen')).toBe('Dana Cohen');
    expect(normalizeLabel('Dana\t\u0007\u001b[0m')).toBe('Dana [0m');
    expect(normalizeLabel('\nDana\u0000')).toBe('Dana');
    expect(normalizeLabel('a\u0085b')).toBe('a b');
    // Nothing a normalized name holds is a control character, so the database never sees a NUL.
    for (const typed of ['x\u0000y', '\u0000', 'a\u001fb\u007fc']) expect(normalizeLabel(typed)).not.toMatch(/\p{Cc}/u);
    expect(labelProblem(normalizeLabel('Dana\u0000Cohen'))).toBeNull();
  });

  it('keeps a format character that sits beside visible text: a Hebrew name with a right-to-left mark is a name, as it was typed', () => {
    const name = 'דנה\u200f כהן';
    expect(normalizeLabel(name)).toBe(name);
    expect(labelProblem(name)).toBeNull();
    expect(normalizeLabel('\u200fDana\u200b')).toBe('\u200fDana\u200b');
    expect(labelProblem('\u200fDana\u200b')).toBeNull();
    // A fill character beside a letter is not what makes the name blank.
    expect(labelProblem('\u3164a')).toBeNull();
  });

  it('counts the 80 characters after normalization, as the name that is sent', () => {
    const count = (typed: string) => [...normalizeLabel(typed)].length;
    // A run of controls in the middle is one space, so this is 40 + 1 + 39.
    expect(count(`${'x'.repeat(40)}\n\n\n${'y'.repeat(39)}`)).toBe(80);
    expect(labelProblem(normalizeLabel(`${'x'.repeat(40)}\n\n\n${'y'.repeat(39)}`))).toBeNull();
    // 40 + 1 + 40 is 81.
    expect(labelProblem(normalizeLabel(`${'x'.repeat(40)}\n${'y'.repeat(40)}`))).toBe('too_long');
    // Controls at the ends are trimmed and do not count: 80 letters in a newline wrapper is 80.
    expect(labelProblem(normalizeLabel(`\n${'x'.repeat(80)}\u0000`))).toBeNull();
    // Format characters are part of the name, so they count (as the database counts code points).
    expect(labelProblem(normalizeLabel(`${'x'.repeat(79)}\u200b\u200b`))).toBe('too_long');
  });

  it('have a message in both languages for each problem', () => {
    for (const locale of locales) for (const key of Object.values(labelErrorKeys)) expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
  });
});

describe('invitation IDs', () => {
  it('are read as the database spells them, or not at all', () => {
    expect(invitationIdOf('9D8C7B6A-5F4E-4D3C-8B2A-1F0E9D8C7B6A ')).toBe('9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a');
    for (const value of ['', 'abc', "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'; drop", '9d8c7b6a5f4e4d3c8b2a1f0e9d8c7b6a', null, undefined, 7, ['9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'], new Blob(['x'])]) {
      expect(invitationIdOf(value), String(value)).toBeNull();
    }
  });
});

describe('creation times', () => {
  it('read the same on the server and in the browser: UTC, to the minute, no locale', () => {
    expect(formatCreatedAt('2026-10-12T00:24:11.123456+00:00')).toBe('2026-10-12 00:24 UTC');
    expect(formatCreatedAt('2026-10-12T02:24:11+02:00')).toBe('2026-10-12 00:24 UTC');
    expect(isoOf('2026-10-12T02:24:11+02:00')).toBe('2026-10-12T00:24:11.000Z');
  });

  it('are an empty text, never an exception, when they cannot be read', () => {
    for (const value of ['', 'yesterday', 'NaN']) {
      expect(formatCreatedAt(value)).toBe('');
      expect(isoOf(value)).toBeUndefined();
    }
  });
});

describe('words for the states', () => {
  it('exist for every status and every answer that is a message, in both languages', () => {
    for (const locale of locales) {
      for (const key of [...Object.values(statusKeys), ...Object.values(invitationMessageKeys)]) expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
    }
    expect(Object.keys(statusKeys).sort()).toEqual(['redeemed', 'revoked', 'unused']);
  });

  it('say Unused, Used and Revoked', () => {
    expect([statusKeys.unused, statusKeys.redeemed, statusKeys.revoked].map((key) => catalogs.en[key])).toEqual(['Unused', 'Used', 'Revoked']);
  });

  it('pick a message for a refusal that offers the step-up, one that does not, and for a failure that may or may not have changed something', () => {
    expect(failureKey({outcome: 'refused', stepUp: true})).toBe('invitations.error.needsConfirm');
    expect(failureKey({outcome: 'refused', stepUp: false})).toBe('invitations.error.refused');
    expect(failureKey({outcome: 'unavailable', unknown: false})).toBe('invitations.error.unavailable');
    expect(failureKey({outcome: 'unavailable', unknown: true})).toBe('invitations.error.unknown');
    // The "may have changed something" message tells the person to look at the list first.
    expect(catalogs.en['invitations.error.unknown']).toMatch(/Check the list/);
  });
});

describe('attemptInvitationAction', () => {
  const data = () => new FormData();

  it('passes the action\'s own answer through', async () => {
    const answer: InvitationActionState = {outcome: 'refused', stepUp: true};
    expect(await attemptInvitationAction(async () => answer, invitationActionIdle, data(), vi.fn())).toBe(answer);
  });

  it('hands the action the previous state and the form', async () => {
    const action = vi.fn(async () => invitationActionIdle);
    const form = data();
    await attemptInvitationAction(action, {outcome: 'exists'}, form, vi.fn());
    expect(action).toHaveBeenCalledWith({outcome: 'exists'}, form);
  });

  it('rethrows a redirect for Next.js to follow', async () => {
    const navigate = vi.fn();
    let thrown: unknown;
    try {
      redirect('/login');
    } catch (error) {
      thrown = error;
    }
    await expect(attemptInvitationAction(async () => { throw thrown; }, invitationActionIdle, data(), navigate)).rejects.toBe(thrown);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reloads the page, once, when the answer is the proxy\'s redirect (the session no longer has access), and keeps the state', async () => {
    const navigate = vi.fn();
    const state = await attemptInvitationAction(async () => { throw new Error(unexpectedResponseMessage); }, {outcome: 'exists'}, data(), navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(state).toEqual({outcome: 'exists'});
  });

  it('says the change may have been made, and reloads nothing, when the connection drops or the server fails', async () => {
    const navigate = vi.fn();
    expect(await attemptInvitationAction(async () => { throw new TypeError('Failed to fetch'); }, invitationActionIdle, data(), navigate)).toEqual({outcome: 'unavailable', unknown: true});
    expect(await attemptInvitationAction(async () => { throw new Error('Internal Server Error'); }, invitationActionIdle, data(), navigate)).toEqual({outcome: 'unavailable', unknown: true});
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('the Hebrew words for revoking a code and for cancelling', () => {
  // "ביטול" is Cancel, the button that backs out of a dialog. Revoking a code is a different act with a different word,
  // so a person who reads "ביטול" never has to ask which of the two a button means.
  const cancel = he['confirm.cancel'] as string;
  const revoking: MessageKey[] = [
    'invitations.row.revoke',
    'invitations.row.revokeLabel',
    'invitations.revoke.title',
    'invitations.revoke.body',
    'invitations.revoke.confirm',
    'invitations.revoke.pending',
    'invitations.revoke.done',
    'invitations.revoke.alreadyRevoked',
    'invitations.reveal.rotated',
    'invitations.status.revoked',
    'invitations.error.unknown',
    'settings.admin.help',
    'stepUp.reason.administration',
  ];

  it('keeps "ביטול" for Cancel alone: no message about revoking is it, or contains it, or says בוטל or לבטל', () => {
    expect(cancel).toBe('ביטול');
    for (const key of revoking) {
      const message = he[key] as string;
      expect(message, key).not.toBe(cancel);
      expect(message, key).not.toContain(cancel);
      expect(message, key).not.toMatch(/בטל|בוטל|ביטול/);
    }
  });

  it('uses one term for revoking, "הפסקת תוקף" (the validity stops), in every message that is about revoking a code', () => {
    for (const key of revoking.filter((candidate) => !['invitations.error.unknown', 'invitations.revoke.body', 'settings.admin.help', 'stepUp.reason.administration'].includes(candidate))) {
      expect(he[key] as string, key).toMatch(/תוקף/);
    }
    expect(he['invitations.row.revoke']).toBe('הפסקת תוקף');
    expect(he['invitations.revoke.confirm']).toBe('הפסקת תוקף הקוד');
  });

  it('says "cannot be undone" as "cannot be restored", not as "cannot be revoked"', () => {
    expect(he['invitations.revoke.body'] as string).toMatch(/אי אפשר לשחזר את הפעולה/);
    expect(en['invitations.revoke.body']).toMatch(/cannot be undone/);
  });

  it('never lets any invitation message say Cancel\'s word', () => {
    for (const key of Object.keys(he).filter((candidate) => candidate.startsWith('invitations.')) as MessageKey[]) {
      expect(he[key] as string, key).not.toContain(cancel);
    }
  });
});
