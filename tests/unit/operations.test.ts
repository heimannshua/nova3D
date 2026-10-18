import {describe, expect, it} from 'vitest';
import {en} from '@/lib/i18n/en';
import {he} from '@/lib/i18n/he';
import {conditionTitleKey, conditionTitleKeys, emailNoteKeyOf, emailStateKeys, emailStateOf, emailNoteKeys, hasReceipt, receiptOf, receiptOutcomeKey, receiptOutcomeKeys, type AlarmView} from '@/lib/operations';
import {alarmConditions} from '@/lib/alarm-conditions';

// Story 1.13: the pure half of the Operations page. What the page says about an alarm's email, its condition and its last receipt is decided here, with no
// clock, no database and no browser; the markup is tests/unit/operations-page.test.tsx and the page in a real browser is tests/e2e/operations.spec.ts.
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 17, 12, minutes, 0, 123)).toISOString();
const notices = (lastSentAt: string | null, lastNoticeOutcome: AlarmView['lastNoticeOutcome'], lastNoticeAt: string | null) => ({lastSentAt, lastNoticeOutcome, lastNoticeAt});

describe('the email state of an alarm', () => {
  it('is pending when no email was ever attempted', () => {
    expect(emailStateOf(notices(null, null, null))).toEqual({state: 'pending'});
  });

  it('is sent, with the time of the last sent notice, when the latest notice is a sent one', () => {
    expect(emailStateOf(notices(at(5), 'sent', at(5)))).toEqual({state: 'sent', at: at(5)});
  });

  it('is failing when the first attempts failed or are unknown and nothing was ever sent', () => {
    expect(emailStateOf(notices(null, 'failed', at(5)))).toEqual({state: 'failing'});
    expect(emailStateOf(notices(null, 'unknown', at(5)))).toEqual({state: 'failing'});
  });

  it('is failing when a reminder fails after an email that went out (the failed attempt is later than the sent one)', () => {
    expect(emailStateOf(notices(at(5), 'failed', at(30)))).toEqual({state: 'failing'});
    expect(emailStateOf(notices(at(5), 'unknown', at(30)))).toEqual({state: 'failing'});
  });

  it('is sent, not failing, when the failed attempt came before the email that went out', () => {
    expect(emailStateOf(notices(at(30), 'failed', at(5)))).toEqual({state: 'sent', at: at(30)});
    // At the same moment the sent one wins: a window was closed.
    expect(emailStateOf(notices(at(5), 'failed', at(5)))).toEqual({state: 'sent', at: at(5)});
  });

  it('says something for every state: a word, and a line for the two that need one', () => {
    expect(Object.keys(emailStateKeys).sort()).toEqual(['failing', 'pending', 'sent']);
    expect(Object.keys(emailNoteKeys).sort()).toEqual(['failing', 'pending']);
    for (const key of [...Object.values(emailStateKeys), ...Object.values(emailNoteKeys)]) {
      expect(en[key], key).toBeTruthy();
      expect(he[key], key).toBeTruthy();
    }
  });
});

describe('the title of a condition', () => {
  it('has words for every condition the registry knows, in both languages, so only a later story\'s condition shows its ID', () => {
    for (const condition of alarmConditions) {
      const key = conditionTitleKey(condition.id);
      expect(key, condition.id).not.toBeNull();
      expect(en[key!], condition.id).toBeTruthy();
      expect(he[key!], condition.id).toBeTruthy();
    }
    expect(Object.keys(conditionTitleKeys).sort()).toEqual(alarmConditions.map((condition) => condition.id).sort());
  });

  it('knows no other: an unknown condition, and a name that only an object would have, have no title', () => {
    for (const condition of ['payment-exception', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(conditionTitleKey(condition), condition).toBeNull();
  });
});

describe('the words for a receipt\'s outcome', () => {
  it('names the four ways a run ends and the task that has never finished one, and no other', () => {
    expect(Object.keys(receiptOutcomeKeys).sort()).toEqual(['failed', 'idle', 'never', 'no_store', 'ran']);
    for (const outcome of Object.keys(receiptOutcomeKeys)) {
      const key = receiptOutcomeKey(outcome)!;
      expect(en[key], outcome).toBeTruthy();
      expect(he[key], outcome).toBeTruthy();
    }
    for (const outcome of ['conflict', '', 'constructor', '__proto__']) expect(receiptOutcomeKey(outcome), outcome).toBeNull();
  });
});

describe('the last receipt of an alarm', () => {
  it('is read from the three receipt keys of the detail', () => {
    const receipt = receiptOf({receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: at(1), age_seconds: 700});
    expect(receipt).toEqual({task: 'ledger-relay', outcome: 'ran', at: at(1)});
    expect(hasReceipt(receipt)).toBe(true);
  });

  it('keeps `never` as it is, for the page to say once', () => {
    expect(receiptOf({receipt_task: 'staging-cleanup', receipt_outcome: 'never', receipt_at: 'never'})).toEqual({task: 'staging-cleanup', outcome: 'never', at: 'never'});
  });

  it('is empty for a detail with none, and ignores a value that is not text', () => {
    expect(hasReceipt(receiptOf({count: 26}))).toBe(false);
    expect(receiptOf({receipt_task: 7, receipt_outcome: true, receipt_at: ''})).toEqual({task: null, outcome: null, at: null});
    expect(hasReceipt(receiptOf({receipt_outcome: 'ran'}))).toBe(true);
  });
});


// Review patch P5: the line beside an email state is chosen from the alarm, not only from its state.
describe('emailNoteKeyOf', () => {
  const base = {subject: null, lastSentAt: null, lastNoticeOutcome: null, lastNoticeAt: null} as const;
  const SENT_AT = '2026-10-17T08:00:00.000Z';
  const LATER = '2026-10-17T09:00:00.000Z';

  it('has no line for a sent alarm, whatever its subject', () => {
    expect(emailNoteKeyOf({...base, lastSentAt: SENT_AT, lastNoticeOutcome: 'sent', lastNoticeAt: SENT_AT})).toBeNull();
    expect(emailNoteKeyOf({...base, subject: 'ledger-relay', lastSentAt: SENT_AT, lastNoticeOutcome: 'sent', lastNoticeAt: SENT_AT})).toBeNull();
    // A failed attempt that is older than the last sent email leaves it sent.
    expect(emailNoteKeyOf({...base, lastSentAt: LATER, lastNoticeOutcome: 'failed', lastNoticeAt: SENT_AT})).toBeNull();
  });

  it('keeps the original line for a mail that failed, and has a line of its own for one whose outcome is not known', () => {
    expect(emailNoteKeyOf({...base, lastNoticeOutcome: 'failed', lastNoticeAt: SENT_AT})).toBe('operations.email.failing.note');
    expect(emailNoteKeyOf({...base, subject: 'x', lastNoticeOutcome: 'failed', lastNoticeAt: SENT_AT})).toBe('operations.email.failing.note');
    expect(emailNoteKeyOf({...base, lastNoticeOutcome: 'unknown', lastNoticeAt: SENT_AT})).toBe('operations.email.unknown.note');
    expect(emailNoteKeyOf({...base, subject: 'x', lastSentAt: SENT_AT, lastNoticeOutcome: 'unknown', lastNoticeAt: LATER})).toBe('operations.email.unknown.note');
    expect(emailNoteKeyOf({...base, lastSentAt: SENT_AT, lastNoticeOutcome: 'failed', lastNoticeAt: LATER})).toBe('operations.email.failing.note');
  });

  it('has one line for a pending subject-keyed alarm, and another, true of both a wait for the next check and a hold for 24 hours, for a threshold alarm', () => {
    expect(emailNoteKeyOf({...base, subject: 'ledger-relay'})).toBe('operations.email.pending.note');
    expect(emailNoteKeyOf(base)).toBe('operations.email.pending.threshold.note');
  });

  it('keeps the three states the page already had: every line names a state of failing or pending, and the lines exist in both languages', () => {
    for (const key of ['operations.email.unknown.note', 'operations.email.pending.threshold.note'] as const) {
      expect(en[key]).not.toBe('');
      expect(he[key]).toMatch(/[֐-׿]/);
    }
    expect(emailStateOf({lastSentAt: null, lastNoticeOutcome: 'unknown', lastNoticeAt: SENT_AT})).toEqual({state: 'failing'});
    expect(emailStateOf(base)).toEqual({state: 'pending'});
  });
});
