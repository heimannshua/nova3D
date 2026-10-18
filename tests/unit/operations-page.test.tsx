import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {AdminContent} from '@/components/admin/admin-content';
import {OperationsContent} from '@/components/admin/operations-content';
import {createTranslator, locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import type {AlarmView} from '@/lib/operations';
import {parentRoute} from '@/components/shell/routes';
import {alarmConditions} from '@/lib/alarm-conditions';
import {detailLabelKey, detailValuesOf} from '@/lib/operations';
import {scheduleRegistry} from '@/lib/schedules';
import {everythingWrong} from '../support/alarm-observations';

// Story 1.13: the Administrator's Operations page, rendered to markup in both languages. What needs a browser (the layout at phone width, the accessibility
// run, the 404 for a member, the title) is in tests/e2e/operations.spec.ts.
const alarm = (overrides: Partial<AlarmView> & Pick<AlarmView, 'id' | 'condition'>): AlarmView => ({
  subject: null,
  firstAt: '2026-10-17T20:41:16.179Z',
  latestAt: '2026-10-17T21:05:02.500Z',
  resolvedAt: null,
  detail: {},
  lastSentAt: null,
  lastNoticeOutcome: null,
  lastNoticeAt: null,
  ...overrides,
});

const SENT = alarm({
  id: '11111111-1111-4111-8111-111111111111',
  condition: 'task-late',
  subject: 'ledger-relay',
  detail: {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:30:00.000Z', age_seconds: 700},
  lastSentAt: '2026-10-17T20:41:20.000Z',
  lastNoticeOutcome: 'sent',
  lastNoticeAt: '2026-10-17T20:41:20.000Z',
});
const PENDING = alarm({id: '22222222-2222-4222-8222-222222222222', condition: 'identities-unaccounted', detail: {count: 26}});
const FAILING = alarm({
  id: '33333333-3333-4333-8333-333333333333',
  condition: 'ledger-pending',
  detail: {pending: 3, oldest_seconds: 1200, receipt_task: 'ledger-relay', receipt_outcome: 'failed', receipt_at: '2026-10-17T20:00:00.000Z'},
  lastNoticeOutcome: 'unknown',
  lastNoticeAt: '2026-10-17T20:45:00.000Z',
});
const NEVER = alarm({
  id: '44444444-4444-4444-8444-444444444444',
  condition: 'task-late',
  subject: 'staging-cleanup',
  detail: {receipt_task: 'staging-cleanup', receipt_outcome: 'never', receipt_at: 'never', age_seconds: 9000},
});
const UNKNOWN = alarm({id: '55555555-5555-4555-8555-555555555555', condition: 'payment-exception', subject: 'pay_<b>1</b>', detail: {note: 'x'}});
const RESOLVED = alarm({
  id: '66666666-6666-4666-8666-666666666666',
  condition: 'qstash-stale',
  resolvedAt: '2026-10-17T22:00:00.000Z',
  lastSentAt: '2026-10-17T20:41:20.000Z',
  lastNoticeOutcome: 'sent',
  lastNoticeAt: '2026-10-17T20:41:20.000Z',
});
const RESOLVED_SUBJECT = alarm({id: '77777777-7777-4777-8777-777777777777', condition: 'task-late', subject: 'dormant-identity-purge', resolvedAt: '2026-10-16T22:00:00.000Z'});

const render = (locale: Locale, alarms: AlarmView[] | null) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <OperationsContent alarms={alarms}/>
    </I18nProvider>,
  );
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
const cards = (markup: string) => [...markup.matchAll(/<li class="invite-item alarm-item">([\s\S]*?)<\/li>/g)].map((match) => match[1]);

describe.each(locales)('the Operations page in %s', (locale) => {
  const all = [SENT, PENDING, FAILING, NEVER, UNKNOWN, RESOLVED, RESOLVED_SUBJECT];
  const markup = render(locale, all);
  const open = cards(markup).slice(0, 5);
  const resolved = cards(markup).slice(5);

  it('has one level-one heading and two sections, the open alarms and the resolved ones', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(text(markup)).toContain(t(locale, 'operations.title'));
    const headings = [...markup.matchAll(/<h2\b[^>]*>(.*?)<\/h2>/g)].map((match) => text(match[1]).trim());
    expect(headings).toEqual([t(locale, 'operations.open.title'), t(locale, 'operations.resolved.title')]);
  });

  it('lists the open alarms as cards in the order it was given them, each with its condition\'s title', () => {
    expect(open).toHaveLength(5);
    const titles = open.map((card) => text(/<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(card)![1]).trim());
    expect(titles).toEqual([
      t(locale, 'operations.condition.task-late'),
      t(locale, 'operations.condition.identities-unaccounted'),
      t(locale, 'operations.condition.ledger-pending'),
      t(locale, 'operations.condition.task-late'),
      'payment-exception',
    ]);
  });

  it('shows an unknown condition by its ID, left to right, and the subject as text, never as markup', () => {
    expect(open[4]).toMatch(/<bdi[^>]*class="ltr-token"[^>]*>payment-exception<\/bdi>|<bdi[^>]*dir="ltr"[^>]*class="ltr-token"[^>]*>payment-exception<\/bdi>/);
    expect(markup).not.toContain('<b>1</b>');
    expect(markup).toContain('pay_&lt;b&gt;1&lt;/b&gt;');
    expect(text(open[0])).toContain(t(locale, 'operations.row.subject'));
    expect(text(open[0])).toContain('ledger-relay');
    // An alarm with no subject shows no subject row.
    expect(text(open[1])).not.toContain(t(locale, 'operations.row.subject'));
  });

  it('shows the first and latest time in UTC, in the existing format, left to right', () => {
    expect(open[0]).toContain('<time dateTime="2026-10-17T20:41:16.179Z">2026-10-17 20:41 UTC</time>');
    expect(open[0]).toContain('<time dateTime="2026-10-17T21:05:02.500Z">2026-10-17 21:05 UTC</time>');
    expect(text(open[0])).toContain(t(locale, 'operations.row.first'));
    expect(text(open[0])).toContain(t(locale, 'operations.row.latest'));
    expect(open[0]).toMatch(/<bdi[^>]*class="ltr-token"[^>]*><time/);
  });

  it('shows the last receipt: its task, how that run ended and when', () => {
    const words = text(open[0]);
    expect(words).toContain(t(locale, 'operations.row.receiptTask'));
    expect(words).toContain('ledger-relay');
    expect(words).toContain(t(locale, 'operations.row.receiptOutcome'));
    expect(words).toContain(t(locale, 'operations.outcome.ran'));
    expect(words).toContain(t(locale, 'operations.row.receiptAt'));
    expect(open[0]).toContain('<time dateTime="2026-10-17T20:30:00.000Z">2026-10-17 20:30 UTC</time>');
    expect(text(open[2])).toContain(t(locale, 'operations.outcome.failed'));
  });

  it('says once that a task has never finished a run, and has no time for it', () => {
    const words = text(open[3]);
    expect(words).toContain('staging-cleanup');
    expect(words).toContain(t(locale, 'operations.outcome.never'));
    expect(words).not.toContain(t(locale, 'operations.row.receiptAt'));
    expect(words.match(new RegExp(t(locale, 'operations.outcome.never'), 'g'))).toHaveLength(1);
    expect(open[3]).not.toContain('<time dateTime="never"');
  });

  it('says so for an alarm that names no receipt, instead of leaving a gap', () => {
    expect(text(open[1])).toContain(t(locale, 'operations.row.receipt'));
    expect(text(open[1])).toContain(t(locale, 'operations.row.receipt.none'));
    expect(text(open[1])).not.toContain(t(locale, 'operations.row.receiptTask'));
  });

  it('gives each email state a word and a shape, never a colour alone: sent with its time, pending and failing with their line', () => {
    const sent = open[0];
    expect(sent).toMatch(new RegExp(`status-badge tone-success[^>]*><svg[\\s\\S]*?</svg><span>${t(locale, 'operations.email.sent')}</span>`));
    expect(sent).toContain('<time dateTime="2026-10-17T20:41:20.000Z">2026-10-17 20:41 UTC</time>');
    expect(text(sent)).not.toContain(t(locale, 'operations.email.pending.note'));
    expect(text(sent)).not.toContain(t(locale, 'operations.email.pending.threshold.note'));
    expect(open[1]).toMatch(new RegExp(`status-badge tone-info[^>]*><svg[\\s\\S]*?</svg><span>${t(locale, 'operations.email.pending')}</span>`));
    // CHANGED (review patch P5): this is a threshold alarm (no subject), whose line is now true whether it is waiting for the next check or held back for its condition's
    // 24 hours; the line for a subject-keyed alarm is the next describe's.
    expect(text(open[1])).toContain(t(locale, 'operations.email.pending.threshold.note'));
    expect(text(open[1])).not.toContain(t(locale, 'operations.email.pending.note'));
    // An `unknown` answer of the mailer is a failing email too: the mail may or may not have gone out, and it is tried again.
    expect(open[2]).toMatch(new RegExp(`status-badge tone-warning[^>]*><svg[\\s\\S]*?</svg><span>${t(locale, 'operations.email.failing')}</span>`));
    // CHANGED (review patch P5): this alarm's last outcome is `unknown`, and its line used to be the `failed` one ("did not go through"), which is not what is known. It
    // now says the mail may or may not have been delivered and will be tried again; the `failed` line is the next describe's.
    expect(text(open[2])).toContain(t(locale, 'operations.email.unknown.note'));
    expect(text(open[2])).not.toContain(t(locale, 'operations.email.failing.note'));
    expect(text(open[0])).toContain(t(locale, 'operations.row.email'));
  });

  it('lists the resolved alarms after them: title, subject, first time and resolved time, with a word and a shape, and no email state', () => {
    expect(resolved).toHaveLength(2);
    expect(text(resolved[0])).toContain(t(locale, 'operations.condition.qstash-stale'));
    expect(text(resolved[0])).toContain(t(locale, 'operations.resolved.badge'));
    expect(resolved[0]).toMatch(/status-badge tone-success/);
    expect(resolved[0]).toContain('<time dateTime="2026-10-17T22:00:00.000Z">2026-10-17 22:00 UTC</time>');
    expect(text(resolved[0])).toContain(t(locale, 'operations.row.resolved'));
    expect(text(resolved[1])).toContain('dormant-identity-purge');
    for (const card of resolved) {
      expect(text(card)).not.toContain(t(locale, 'operations.row.email'));
      expect(text(card)).not.toContain(t(locale, 'operations.row.latest'));
    }
  });

  it('is read only: no button, no form, no link and no control of any kind', () => {
    expect(markup).not.toMatch(/<(?:button|form|input|select|textarea|a)\b/);
  });

  it('puts the one level-one heading, the two sections and the cards in a page of the same width as the other Administrator pages', () => {
    expect(markup).toContain('class="page page-narrow"');
    expect(markup.match(/class="settings-section"/g)).toHaveLength(2);
  });
});

// Review patch P5: the line beside an email state is true of what happened.
/** The label and value rows of a card (`<div><dt>…</dt><dd>…</dd></div>`), as text. */
const rowsOf = (card: string) => [...card.matchAll(/<div><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)].map((match) => [text(match[1]).trim(), text(match[2]).trim()] as const);

describe.each(locales)('the detail of an open alarm on the page in %s', (locale) => {
  const view = (condition: string, subject: string | null, detail: AlarmView['detail'], index: number) =>
    alarm({id: `${index}`.padStart(8, '0') + '-0000-4000-8000-000000000000', condition, subject, detail, lastSentAt: '2026-10-17T20:41:20.000Z', lastNoticeOutcome: 'sent', lastNoticeAt: '2026-10-17T20:41:20.000Z'});

  it('lists, on the card of every condition\'s own finding, each whole number and boolean of the detail with its translated label and its value, and no string of it', () => {
    // The real conditions, against observations in which each of them finds something: their details are what the page is asked to show.
    const views = alarmConditions.flatMap((condition) => {
      const findings = condition.evaluate(everythingWrong(), scheduleRegistry);
      if (findings === 'unobservable') throw new Error(`${condition.id} is unobservable`);
      return findings.map((finding) => ({condition: condition.id, view: view(condition.id, finding.subject, finding.detail, 0)}));
    });
    expect(new Set(views.map((one) => one.condition))).toEqual(new Set(alarmConditions.map((condition) => condition.id)));
    for (const {condition, view: one} of views) {
      const card = cards(render(locale, [one]))[0];
      const shown = rowsOf(card);
      for (const {key, value} of detailValuesOf(one.detail)) {
        const labelKey = detailLabelKey(key);
        expect(labelKey, `${condition}: ${key}`).not.toBeNull();
        expect(shown, `${condition}: ${key}`).toContainEqual([t(locale, labelKey!), String(value)]);
      }
      // A string of the detail is not a row of its own (the receipt has rows of its own, with words).
      const labels = shown.map(([label]) => label);
      for (const raw of ['heartbeat', 'receipts', 'receipt_task', 'receipt_outcome', 'receipt_at']) expect(labels, `${condition}: ${raw}`).not.toContain(raw);
    }
  });

  it('shows the numbers left to right in a token of their own, between the times and the receipt', () => {
    const markup = render(locale, [view('task-late', 'ledger-relay', {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:30:00.000Z', age_seconds: 700}, 1)]);
    const card = cards(markup)[0];
    expect(card).toMatch(new RegExp(`<dt>${t(locale, 'operations.detail.age_seconds')}</dt><dd><bdi[^>]*class="ltr-token"[^>]*>700</bdi></dd>`));
    expect(card.indexOf(t(locale, 'operations.row.latest'))).toBeLessThan(card.indexOf(t(locale, 'operations.detail.age_seconds')));
    expect(card.indexOf(t(locale, 'operations.detail.age_seconds'))).toBeLessThan(card.indexOf(t(locale, 'operations.row.receiptTask')));
  });

  it('shows a key the catalog does not know as the key itself, left to right, and a boolean as a word, never a colour; a string, a fraction and a name only an object has are not shown as values', () => {
    const odd = view('payment-exception', null, {queue_depth: 4, healthy: false, retrying: true, ratio: 1.5, note: 'x', constructor_x: 0}, 2);
    const card = cards(render(locale, [odd]))[0];
    expect(card).toMatch(/<dt><bdi[^>]*class="ltr-token"[^>]*>queue_depth<\/bdi><\/dt><dd><bdi[^>]*class="ltr-token"[^>]*>4<\/bdi><\/dd>/);
    expect(rowsOf(card)).toEqual(
      expect.arrayContaining([
        ['queue_depth', '4'],
        ['healthy', t(locale, 'operations.detail.no')],
        ['retrying', t(locale, 'operations.detail.yes')],
        ['constructor_x', '0'],
      ]),
    );
    const labels = rowsOf(card).map(([label]) => label);
    expect(labels).not.toContain('ratio');
    expect(labels).not.toContain('note');
    // The words yes and no, not a colour or a shape alone: the boolean is text in the card.
    expect(text(card)).toContain(t(locale, 'operations.detail.yes'));
    expect(text(card)).toContain(t(locale, 'operations.detail.no'));
  });

  it('shows no value row for an alarm whose detail has no whole number or boolean, and none on a resolved alarm', () => {
    const bare = view('task-late', 'ledger-relay', {receipt_task: 'ledger-relay', receipt_outcome: 'never', receipt_at: 'never'}, 3);
    const labels = (card: string) => rowsOf(card).map(([label]) => label);
    expect(labels(cards(render(locale, [bare]))[0])).not.toContain(t(locale, 'operations.detail.age_seconds'));
    const closed = {...view('task-late', 'ledger-relay', {age_seconds: 700, count: 3}, 4), resolvedAt: '2026-10-17T22:00:00.000Z'};
    const resolvedCard = cards(render(locale, [closed]))[0];
    expect(labels(resolvedCard)).not.toContain(t(locale, 'operations.detail.age_seconds'));
    expect(labels(resolvedCard)).not.toContain(t(locale, 'operations.detail.count'));
  });

  it('labels the monitor-late card with its own title, and its age', () => {
    const late = view('monitor-late', null, {receipt_task: 'alarm-monitor', receipt_outcome: 'never', receipt_at: 'never', age_seconds: 5000}, 5);
    const card = cards(render(locale, [late]))[0];
    expect(text(/<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(card)![1]).trim()).toBe(t(locale, 'operations.condition.monitor-late'));
    expect(rowsOf(card)).toContainEqual([t(locale, 'operations.detail.age_seconds'), '5000']);
  });
});

describe.each(locales)('the line beside each email state in %s', (locale) => {
  const FAILED_MAIL = alarm({id: '88888888-8888-4888-8888-888888888888', condition: 'ledger-pending', lastNoticeOutcome: 'failed', lastNoticeAt: '2026-10-17T20:45:00.000Z'});
  const UNKNOWN_MAIL = alarm({id: '99999999-9999-4999-8999-999999999999', condition: 'ledger-pending', lastNoticeOutcome: 'unknown', lastNoticeAt: '2026-10-17T20:45:00.000Z'});
  const PENDING_SUBJECT = alarm({id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', condition: 'task-late', subject: 'ledger-relay'});
  const PENDING_THRESHOLD = alarm({id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', condition: 'identities-unaccounted'});
  // Sent, and then a reminder that failed: it is failing, with the `failed` line; sent after an unknown one: sent.
  const REMINDER_FAILED = alarm({id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', condition: 'qstash-stale', lastSentAt: '2026-10-16T20:00:00.000Z', lastNoticeOutcome: 'failed', lastNoticeAt: '2026-10-17T20:00:00.000Z'});
  const SENT_AFTER_UNKNOWN = alarm({id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', condition: 'qstash-stale', lastSentAt: '2026-10-17T20:10:00.000Z', lastNoticeOutcome: 'sent', lastNoticeAt: '2026-10-17T20:10:00.000Z'});
  const open = cards(render(locale, [FAILED_MAIL, UNKNOWN_MAIL, PENDING_SUBJECT, PENDING_THRESHOLD, REMINDER_FAILED, SENT_AFTER_UNKNOWN]));
  const notes = ['operations.email.failing.note', 'operations.email.unknown.note', 'operations.email.pending.note', 'operations.email.pending.threshold.note'] as const;
  const only = (card: string, key: (typeof notes)[number]) => {
    for (const other of notes) {
      if (other === key) expect(text(card)).toContain(t(locale, other));
      else expect(text(card)).not.toContain(t(locale, other));
    }
  };

  it('keeps the three states: a failed mail, an unknown one and a failed reminder are failing, an alarm not yet mailed is pending, a sent one is sent', () => {
    expect(open).toHaveLength(6);
    for (const index of [0, 1, 4]) expect(open[index]).toContain(`<span>${t(locale, 'operations.email.failing')}</span>`);
    for (const index of [2, 3]) expect(open[index]).toContain(`<span>${t(locale, 'operations.email.pending')}</span>`);
    expect(open[5]).toContain(`<span>${t(locale, 'operations.email.sent')}</span>`);
  });

  it('keeps the `failed` wording for a mail that failed, and says an `unknown` one may or may not have been delivered and will be tried again', () => {
    only(open[0], 'operations.email.failing.note');
    only(open[4], 'operations.email.failing.note');
    only(open[1], 'operations.email.unknown.note');
    // The English words: never "did not go through" for what is not known.
    expect(t('en', 'operations.email.unknown.note')).not.toMatch(/did not go through|failed/i);
    expect(t('en', 'operations.email.unknown.note')).toMatch(/not known whether/);
    expect(t('en', 'operations.email.unknown.note')).toMatch(/tried again/);
    expect(t('en', 'operations.email.failing.note')).toMatch(/did not go through/);
  });

  it('says of a subject-keyed alarm that is not yet mailed that it is sent at the next check, and of a threshold alarm that there is at most one email for its kind every 24 hours', () => {
    only(open[2], 'operations.email.pending.note');
    only(open[3], 'operations.email.pending.threshold.note');
    expect(t('en', 'operations.email.pending.threshold.note')).toMatch(/at most one email for each kind of alarm every 24 hours/);
    expect(t('en', 'operations.email.pending.threshold.note')).toMatch(/next check/);
    expect(t(locale, 'operations.email.pending.threshold.note')).toMatch(/24/);
  });

  it('shows no line beside a sent alarm: its time instead', () => {
    for (const key of notes) expect(text(open[5])).not.toContain(t(locale, key));
    expect(open[5]).toContain('<time dateTime="2026-10-17T20:10:00.000Z">');
  });

  it('does not call a failing email "failed" in a badge (Hebrew: the badge no longer reads "נכשל")', () => {
    expect(t('he', 'operations.email.failing')).not.toBe('נכשל');
    expect(t('he', 'operations.email.failing')).toMatch(/[֐-׿]/);
    expect(t('he', 'operations.email.failing')).toBe('שליחה נכשלת');
  });
});

describe.each(locales)('the Operations page with nothing open in %s', (locale) => {
  it('does not claim the monitor is running: it says no alarm is open and that alarms are raised by a check that runs every 5 minutes once its schedule is applied', () => {
    const markup = render(locale, []);
    expect(text(markup)).toContain(t(locale, 'operations.open.empty.title'));
    expect(t('en', 'operations.open.empty.title')).toBe('No open alarms');
    expect(t('en', 'operations.open.empty.title')).not.toMatch(/nothing is wrong|all clear|healthy/i);
    expect(t('en', 'operations.open.empty.body')).toMatch(/check that runs every 5 minutes once its schedule is applied/);
    expect(t('he', 'operations.open.empty.title')).toBe('אין התראות פתוחות');
    expect(t('he', 'operations.open.empty.body')).toMatch(/כל 5 דקות/);
    expect(t('he', 'operations.open.empty.body')).toMatch(/התזמון שלה הופעל/);
    expect(text(markup)).not.toMatch(/Nothing is wrong|שום דבר לא תקול/);
  });

  it('shows the empty state in a state of its own, and says no alarm has closed yet', () => {
    const markup = render(locale, []);
    expect(cards(markup)).toEqual([]);
    expect(text(markup)).toContain(t(locale, 'operations.open.empty.title'));
    expect(text(markup)).toContain(t(locale, 'operations.open.empty.body'));
    expect(markup).toContain('state-empty');
    expect(markup).not.toContain('state-error');
    expect(text(markup)).toContain(t(locale, 'operations.resolved.empty'));
  });

  it('shows the resolved alarms under the empty state when only they exist', () => {
    const markup = render(locale, [RESOLVED]);
    expect(cards(markup)).toHaveLength(1);
    expect(text(markup)).toContain(t(locale, 'operations.open.empty.title'));
    expect(text(markup)).not.toContain(t(locale, 'operations.resolved.empty'));
  });
});

describe.each(locales)('the Operations page when the alarms cannot be read in %s', (locale) => {
  const markup = render(locale, null);

  it('says so in a live error state, and claims nothing: no card, no empty state, no resolved section', () => {
    expect(markup).toContain('state-error');
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain(t(locale, 'operations.error.title'));
    expect(text(markup)).toContain(t(locale, 'operations.error.body'));
    expect(cards(markup)).toEqual([]);
    expect(markup).not.toContain('state-empty');
    expect(text(markup)).not.toContain(t(locale, 'operations.open.empty.title'));
    expect(text(markup)).not.toContain(t(locale, 'operations.resolved.title'));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
  });
});

describe('the Operations page\'s words', () => {
  it('are English and Hebrew, and the Hebrew is not the English', () => {
    const english = createTranslator('en');
    const hebrew = createTranslator('he');
    for (const key of ['operations.title', 'operations.lede', 'operations.open.title', 'operations.email.sent', 'operations.condition.task-late', 'meta.operations', 'admin.operations.title', 'admin.operations.open'] as const) {
      expect(english(key), key).not.toEqual(hebrew(key));
    }
    expect(hebrew('operations.lede')).toMatch(/[֐-׿]/);
  });
});

describe.each(locales)('the Administration index in %s', (locale) => {
  it('links to the Operations page, and the page goes back up to the index', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale={locale}>
        <AdminContent confirmation="unknown"/>
      </I18nProvider>,
    );
    expect(markup).toContain('href="/admin/operations"');
    expect(text(markup)).toContain(t(locale, 'admin.operations.open'));
    expect(text(markup)).toContain(t(locale, 'admin.lede').slice(0, 20));
    expect(parentRoute('/admin/operations')).toBe('/admin');
  });
});
