import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {messageFor, UsageList} from '@/components/admin/usage-list';
import {UsageContent} from '@/components/admin/usage-content';
import {UsageFailureNotice} from '@/components/admin/usage-failure-notice';
import {UsageMeter} from '@/components/admin/usage-meter';
import type {Confirmation} from '@/lib/administration';
import {createTranslator, isolateLtr, locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {figuresOf, formatDollars, limitBounds, limitProblemKeys, usageStateKeys, type UsageActionState, type UsageRow} from '@/lib/usage-view';

// Story 2.4: the Administrator's Usage and limits page, rendered to markup in both languages, in every state. What needs a browser (the dialog, focus, the
// live regions, the Server Actions, axe, 320 px at 200% text) is in tests/e2e/usage.spec.ts.
const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  accountId: '11111111-1111-4111-8111-111111111111',
  email: 'dana@example.com',
  role: 'member',
  status: 'active',
  seq: 1,
  monthStart: '2026-10-01',
  limit: 25_000_000,
  settled: 0,
  reserved: 0,
  cause: 'initial',
  ...over,
});
const UNDER = row();
const NEARLY = row({accountId: '22222222-2222-4222-8222-222222222222', email: 'noa+<ben>@example.com', settled: 15_000_000, reserved: 5_000_000, seq: 3, cause: 'change'});
const REACHED = row({accountId: '33333333-3333-4333-8333-333333333333', email: 'ron@example.com', settled: 25_000_000, cause: 'month'});
const OVER = row({accountId: '44444444-4444-4444-8444-444444444444', email: 'tal@example.com', limit: 10_000_000, settled: 20_000_000, reserved: 2_000_000, seq: 4, cause: 'reset'});
const ZERO = row({accountId: '55555555-5555-4555-8555-555555555555', email: 'lee@example.com', limit: 0});
const ADMINISTRATOR = row({accountId: '66666666-6666-4666-8666-666666666666', email: 'josh@example.com', role: 'administrator', limit: 50_000_000});
const DISABLED = row({accountId: '77777777-7777-4777-8777-777777777777', email: 'sam@example.com', status: 'disabled', settled: 1_000_000});
const NO_ADDRESS = row({accountId: '88888888-8888-4888-8888-888888888888', email: null});
const ODD_AMOUNT = row({accountId: '99999999-9999-4999-8999-999999999999', email: 'amit@example.com', settled: 19_999_999});

const render = (locale: Locale, rows: UsageRow[] | null, confirmation: Confirmation = 'confirmed') =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UsageContent rows={rows} confirmation={confirmation}/>
    </I18nProvider>,
  );
/** Isolation marks wrap a value put into a sentence; they carry no words. */
const bare = (value: string) => value.replace(/[\u2066\u2068\u2069]/g, '');
const text = (markup: string) => markup.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
const cards = (markup: string) => [...markup.matchAll(/<li class="invite-item usage-item"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[0]);
/** The labelled values of a card's description list. */
const facts = (card: string) =>
  Object.fromEntries([...card.matchAll(/<dt>(.*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((match) => [text(match[1]).trim(), text(match[2]).trim()]));
const dollars = (amount: string) => Number(amount.replace(/[$,]/g, ''));

describe.each(locales)('the Usage and limits page in %s', (locale) => {
  const all = [UNDER, NEARLY, REACHED, OVER, ZERO, ADMINISTRATOR, DISABLED];
  const markup = render(locale, all);

  it('has one level-one heading and one section, the list of Accounts', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(text(markup)).toContain(t(locale, 'usage.title'));
    expect([...markup.matchAll(/<h2\b[^>]*>(.*?)<\/h2>/g)].map((match) => text(match[1]).trim())).toEqual([t(locale, 'usage.list.title')]);
  });

  it('shows one card for each Account, in the order given, and no table', () => {
    expect(cards(markup)).toHaveLength(all.length);
    expect(markup).not.toContain('<table');
    const names = cards(markup).map((card) => text(card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)![1]).trim());
    expect(names).toEqual(all.map((entry) => entry.email));
  });

  it('shows, for each Account, its month, limit, settled, reserved and available amounts, from the one formatter', () => {
    for (const [index, entry] of all.entries()) {
      const shown = facts(cards(markup)[index]);
      const figures = figuresOf(entry);
      expect(shown[t(locale, 'usage.row.month')], entry.email ?? '').toBe('2026-10');
      expect(shown[t(locale, 'usage.row.limit')]).toBe(formatDollars(entry.limit));
      expect(shown[t(locale, 'usage.row.settled')]).toBe(formatDollars(entry.settled));
      expect(shown[t(locale, 'usage.row.reserved')]).toBe(formatDollars(entry.reserved));
      expect(shown[t(locale, 'usage.row.available')]).toBe(formatDollars(figures.available));
    }
    expect(facts(cards(markup)[0])[t(locale, 'usage.row.limit')]).toBe('$25.00');
    expect(facts(cards(markup)[5])[t(locale, 'usage.row.limit')]).toBe('$50.00');
  });

  it('shows amounts that always reconcile: settled + reserved + available is the limit, or the limit + the amount over is what is used', () => {
    for (const [index, entry] of all.entries()) {
      const shown = facts(cards(markup)[index]);
      const settled = dollars(shown[t(locale, 'usage.row.settled')]);
      const reserved = dollars(shown[t(locale, 'usage.row.reserved')]);
      const available = dollars(shown[t(locale, 'usage.row.available')]);
      const limit = dollars(shown[t(locale, 'usage.row.limit')]);
      const overKey = t(locale, 'usage.row.over');
      if (overKey in shown) {
        expect(Number((limit + dollars(shown[overKey])).toFixed(6)), entry.email ?? '').toBe(Number((settled + reserved).toFixed(6)));
        expect(available).toBe(0);
      } else {
        expect(Number((settled + reserved + available).toFixed(6)), entry.email ?? '').toBe(limit);
      }
    }
  });

  it('shows the amount over the limit only for an Account that is over it', () => {
    const over = facts(cards(markup)[3]);
    expect(over[t(locale, 'usage.row.over')]).toBe('$12.00');
    expect(over[t(locale, 'usage.row.available')]).toBe('$0.00');
    for (const index of [0, 1, 2, 4, 5, 6]) expect(t(locale, 'usage.row.over') in facts(cards(markup)[index]), `card ${index}`).toBe(false);
  });

  it('gives each state a word, a shape and a tone, and says what it means for new paid work', () => {
    const expectations = [
      [0, 'under', 'success'],
      [1, 'nearly', 'warning'],
      [2, 'reached', 'danger'],
      [3, 'reached', 'danger'],
      [4, 'reached', 'danger'],
    ] as const;
    for (const [index, state, tone] of expectations) {
      const card = cards(markup)[index];
      const badge = card.match(/<span class="status-badge (tone-[a-z-]+)">(<svg[\s\S]*?<\/svg>)<span>(.*?)<\/span><\/span>/);
      expect(badge, `card ${index}`).not.toBeNull();
      expect(badge![1]).toBe(`tone-${tone}`);
      expect(badge![2]).toContain('aria-hidden="true"');
      expect(badge![3]).toBe(t(locale, usageStateKeys[state].label));
      expect(text(card)).toContain(t(locale, usageStateKeys[state].note));
      expect(card).toContain(`data-state="${state}"`);
    }
    // The three states are three different shapes, not one colour in three shades.
    const shapes = [0, 1, 2].map((index) => cards(markup)[index].match(/<span class="status-badge tone-[a-z-]+">(<svg[\s\S]*?<\/svg>)/)![1]);
    expect(new Set(shapes).size).toBe(3);
  });

  it('says, for a limit that is reached, that new paid work is blocked, running work finishes and disabling still cancels it', () => {
    for (const index of [2, 3, 4]) {
      const words = text(cards(markup)[index]);
      expect(words).toContain(t(locale, 'usage.state.reached.note'));
    }
    if (locale === 'en') {
      expect(t('en', 'usage.state.reached.note')).toMatch(/blocked/);
      expect(t('en', 'usage.state.reached.note')).toMatch(/already running finishes/);
      expect(t('en', 'usage.state.reached.note')).toMatch(/Disabling the Account still cancels it/);
    }
    expect(text(cards(markup)[0])).not.toContain(t(locale, 'usage.state.reached.note'));
  });

  it('shows a meter with a text equivalent that says the same thing as the amounts', () => {
    const meters = [...markup.matchAll(/<div class="usage-meter-track" role="meter" aria-label="([^"]*)" aria-valuemin="0" aria-valuemax="100" aria-valuenow="(\d+)" aria-valuetext="([^"]*)">/g)];
    expect(meters).toHaveLength(all.length);
    const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    expect(Number(meters[0][2])).toBe(0);
    expect(Number(meters[1][2])).toBe(80);
    expect(Number(meters[2][2])).toBe(100);
    expect(Number(meters[3][2])).toBe(100);
    expect(Number(meters[4][2])).toBe(100);
    for (const [index, entry] of all.entries()) {
      const figures = figuresOf(entry);
      const valuetext = decode(meters[index][3]);
      expect(valuetext).toContain(formatDollars(figures.used));
      expect(valuetext).toContain(formatDollars(figures.limit));
      // The same sentence is printed under the bar, so a person who cannot see it is told, and one who can is told as well.
      expect(bare(text(cards(markup)[index]))).toContain(bare(valuetext));
    }
    expect(decode(meters[3][3])).toContain(formatDollars(12_000_000));
    // The bar's segments are decoration.
    expect(markup).toContain('<span class="usage-meter-settled" style="inline-size:');
  });

  it('keeps every amount and the month left to right, and an address as text, never as markup', () => {
    expect(markup).not.toContain('<ben>');
    expect(markup).toContain('noa+&lt;ben&gt;@example.com');
    expect(markup).toMatch(/<bdi[^>]*class="ltr-token"[^>]*>\$25\.00<\/bdi>|<bdi[^>]*dir="ltr"[^>]*>\$25\.00<\/bdi>/);
    expect(markup).toMatch(/<bdi[^>]*>(?:<time[^>]*>)?2026-10(?:<\/time>)?<\/bdi>/);
  });

  it('writes an amount that is not whole cents exactly, so the card still adds up', () => {
    const odd = render(locale, [ODD_AMOUNT]);
    const shown = facts(cards(odd)[0]);
    expect(shown[t(locale, 'usage.row.settled')]).toBe('$19.999999');
    expect(shown[t(locale, 'usage.row.available')]).toBe('$5.000001');
    // 19,999,999 of 25,000,000 is one microdollar short of 80%: still under.
    expect(text(cards(odd)[0])).toContain(t(locale, usageStateKeys.under.note));
    expect(cards(odd)[0]).toContain('data-state="under"');
  });

  it('says how each period began, in words', () => {
    const began = cards(markup).map((card) => facts(card)[t(locale, 'usage.row.began')]);
    expect(began[0]).toBe(t(locale, 'usage.cause.initial'));
    expect(began[1]).toBe(t(locale, 'usage.cause.change'));
    expect(began[2]).toBe(t(locale, 'usage.cause.month'));
    expect(began[3]).toBe(t(locale, 'usage.cause.reset'));
  });

  it('offers Change limit and Reset to an Account that is enabled, each naming which Account it changes, and nothing to a disabled one', () => {
    const enabled = [0, 1, 2, 3, 4, 5].map((index) => cards(markup)[index]);
    for (const [index, card] of enabled.entries()) {
      const name = all[index].email!;
      const labels = [...card.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>/g)].map((match) => match[1].replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
      // Isolation marks wrap a name put into a sentence; the accessible name keeps them, the visible word is inside it.
      expect(labels.map((label) => label.replace(/[⁦⁨⁩]/g, ''))).toEqual([t(locale, 'usage.change.submitLabel', {name}).replace(/[⁦⁨⁩]/g, ''), t(locale, 'usage.reset.label', {name}).replace(/[⁦⁨⁩]/g, '')]);
      expect(labels[0]).toContain(t(locale, 'usage.change.submit'));
      expect(text(card)).toContain(t(locale, 'usage.reset.button'));
      // One field for the limit, with a label and a hint that says what is allowed.
      expect(card.match(/<input[^>]*name="limit"/g)).toHaveLength(1);
      expect(card).toMatch(/<label[^>]*for="([^"]+)"[^>]*>/);
      expect(bare(text(card))).toContain(bare(t(locale, 'usage.change.hint', {current: formatDollars(all[index].limit), max: '$10,000.00'})));
    }
    const disabled = cards(markup)[6];
    expect(disabled).not.toContain('<button');
    expect(disabled).not.toContain('<input');
    expect(text(disabled)).toContain(t(locale, 'usage.row.disabledNote'));
    expect(text(disabled)).toContain(t(locale, 'usage.row.disabled'));
    // Its usage stays readable.
    expect(facts(disabled)[t(locale, 'usage.row.settled')]).toBe('$1.00');
  });

  it('carries, in each form, the Account, the period the person saw and a command ID that is made when the form is sent', () => {
    const card = cards(markup)[1];
    expect(card).toContain(`name="accountId" value="${NEARLY.accountId}"`);
    expect(card).toContain('name="expectedSeq" value="3"');
    expect((card.match(/name="commandId"/g) ?? []).length).toBe(2);
    // No command ID is invented on the server: the field is empty until the form is sent (a random ID would differ between server and browser).
    expect(card).toMatch(/name="commandId"[^>]*value=""/);
    // The typed limit is the field's only content and is not prefilled.
    expect(card).toMatch(/name="limit"[^>]*value=""/);
    expect(card.match(/<input type="hidden"/g)).toHaveLength(6);
  });

  it('accepts a dollar amount in a text field that reads left to right and offers a decimal keypad', () => {
    const card = cards(markup)[0];
    expect(card).toMatch(/<input[^>]*type="text"[^>]*name="limit"|<input[^>]*name="limit"[^>]*type="text"/);
    expect(card).toContain('inputMode="decimal"');
    expect(card).toContain('dir="ltr"');
    expect(card).toContain('autoComplete="off"');
    expect(card).toContain('aria-required="true"');
    expect(card).not.toContain('aria-invalid');
  });

  it('holds no confirmation dialog, no alert and no outcome message until something is done', () => {
    expect(markup).not.toContain('<dialog');
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('notice-warning');
  });

  it('says the usage could not be loaded, and shows no number, when it could not', () => {
    const failed = render(locale, null);
    expect(text(failed)).toContain(t(locale, 'usage.list.error.title'));
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('usage-item');
    expect(failed).not.toContain('<button');
    expect(failed).not.toMatch(/\$\d/);
  });

  it('says there are no Accounts when there are none', () => {
    expect(text(render(locale, []))).toContain(t(locale, 'usage.list.empty.title'));
  });

  it('stands in for an address that Auth no longer vouches for instead of breaking', () => {
    const odd = render(locale, [NO_ADDRESS]);
    expect(text(odd)).toContain(t(locale, 'usage.row.noAddress'));
  });

  it('offers the step-up beforehand only when it is needed, and says the person has confirmed it is them when they have', () => {
    const confirmed = render(locale, all, 'confirmed');
    expect(text(confirmed)).toContain(t(locale, 'usage.confirm.ok'));
    expect(confirmed).toContain('notice-success');
    expect(confirmed).not.toContain('/step-up');
    const needed = render(locale, all, 'needed');
    expect(text(needed)).toContain(t(locale, 'usage.confirm.needed'));
    expect(needed).toMatch(/<a [^>]*href="\/step-up\?for=administration"[^>]*>/);
    expect(needed).not.toContain('notice-success');
    for (const unknown of [render(locale, all, 'unknown')]) {
      expect(unknown).not.toContain('notice-success');
      expect(unknown).not.toContain('notice-warning');
      expect(unknown).not.toContain('/step-up');
    }
  });

  it('holds the Hebrew to Hebrew: no Latin word in the page apart from addresses, and no currency or time-zone code', () => {
    if (locale !== 'he') return;
    const words = text(markup).replace(/\S*@\S+/g, '');
    expect(words.match(/[A-Za-z]{2,}/g) ?? []).toEqual([]);
    expect(words).not.toMatch(/USD|UTC/);
    expect(markup).toContain('dir="ltr"');
  });
});

describe.each(locales)('the Usage meter in %s', (locale) => {
  const meter = (limit: number, settled: number, reserved: number) =>
    renderToStaticMarkup(
      <I18nProvider locale={locale}>
        <UsageMeter figures={figuresOf({limit, settled, reserved})} name="dana@example.com"/>
      </I18nProvider>,
    );

  it('splits the bar into a solid settled part and a striped reserved part, in percents of the limit', () => {
    const markup = meter(25_000_000, 10_000_000, 5_000_000);
    expect(markup).toContain('class="usage-meter-settled" style="inline-size:40%"');
    expect(markup).toContain('class="usage-meter-reserved" style="inline-size:20%"');
    expect(markup).toContain('aria-valuenow="60"');
  });

  it('is full and says by how much it is over when the limit is exceeded, and is full for a limit of 0', () => {
    const over = meter(10_000_000, 20_000_000, 2_000_000);
    expect(over).toContain('aria-valuenow="100"');
    expect(bare(text(over))).toContain(bare(t(locale, 'usage.meter.over', {used: formatDollars(22_000_000), limit: formatDollars(10_000_000), over: formatDollars(12_000_000)})));
    expect(meter(0, 0, 0)).toContain('aria-valuenow="100"');
  });
});

describe.each(locales)('the failure notice in %s', (locale) => {
  const render = (state: UsageActionState) =>
    renderToStaticMarkup(
      <I18nProvider locale={locale}>
        <UsageFailureNotice state={state}/>
      </I18nProvider>,
    );

  it('offers the step-up, as an alert, when there is no fresh sign-in or it ran out', () => {
    const markup = render({outcome: 'refused', stepUp: true});
    expect(text(markup)).toContain(t(locale, 'usage.error.needsConfirm'));
    expect(markup).toMatch(/<a [^>]*href="\/step-up\?for=administration"[^>]*>/);
    expect(markup).toContain('role="alert"');
  });

  it.each([
    [{outcome: 'refused', stepUp: false}, 'usage.error.refused'],
    [{outcome: 'denied'}, 'usage.error.denied'],
    [{outcome: 'unavailable', unknown: false}, 'usage.error.unavailable'],
    [{outcome: 'unavailable', unknown: true}, 'usage.error.unknown'],
  ] as [UsageActionState, MessageKey][])('says the message for %j, as an alert, without the step-up', (state, key) => {
    const markup = render(state);
    expect(text(markup)).toContain(t(locale, key));
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('/step-up');
  });

  it.each([{outcome: 'idle'}, {outcome: 'changed', limit: 40_000_000}, {outcome: 'reset'}, {outcome: 'invalid', problem: 'cents'}, {outcome: 'stale'}] as UsageActionState[])('says nothing for %j', (state) => {
    expect(render(state)).toBe('');
  });
});

describe.each(locales)('what an answer says above a card in %s', (locale) => {
  const translator = createTranslator(locale);
  const name = 'dana@example.com';
  const said = (state: UsageActionState) => messageFor(state, name, translator);

  it('says a change that was made with the new limit, in the language of the page, as a success', () => {
    const message = said({outcome: 'changed', limit: 40_500_000});
    expect(message?.tone).toBe('success');
    expect(message?.text).toContain(formatDollars(40_500_000));
    expect(message?.text).toContain(name);
    expect(message?.text).toBe(t(locale, 'usage.change.done', {name, limit: isolateLtr('$40.50')}));
  });

  it('says a reset, a replay and an unchanged limit', () => {
    expect(said({outcome: 'reset'})).toEqual({tone: 'success', text: t(locale, 'usage.reset.done', {name})});
    expect(said({outcome: 'replayed'})).toEqual({tone: 'info', text: t(locale, 'usage.done.replayed', {name})});
    expect(said({outcome: 'unchanged', limit: 25_000_000})?.tone).toBe('info');
    expect(said({outcome: 'unchanged', limit: 25_000_000})?.text).toContain('$25.00');
  });

  it.each([
    ['stale', 'usage.error.stale'],
    ['reused', 'usage.error.reused'],
    ['disabled', 'usage.error.disabled'],
    ['not_found', 'usage.error.notFound'],
  ] as const)('warns for %s, with a remedy', (outcome, key) => {
    expect(said({outcome})).toEqual({tone: 'warning', text: t(locale, key, {name})});
  });

  it('refuses a limit the database would not accept, as an error', () => {
    expect(said({outcome: 'invalid_limit'})).toEqual({tone: 'danger', text: t(locale, 'usage.error.invalidLimit', {name, ...limitBounds()})});
    // The bounds are written by the one formatter, and isolated so they read left to right whatever the language.
    expect(said({outcome: 'invalid_limit'})?.text).toContain('$0.00');
    expect(said({outcome: 'invalid_limit'})?.text).toContain('$10,000.00');
    expect(said({outcome: 'invalid_limit'})?.text).not.toMatch(/[{}]/);
  });

  it.each([{outcome: 'idle'}, {outcome: 'refused', stepUp: true}, {outcome: 'denied'}, {outcome: 'unavailable', unknown: true}, {outcome: 'invalid', problem: 'range'}] as UsageActionState[])('says nothing above the card for %j: the field or the failure notice says it', (state) => {
    expect(said(state)).toBeNull();
  });

  it('has a message with a remedy for every way a typed limit fails', () => {
    for (const key of Object.values(limitProblemKeys)) {
      const message = t(locale, key, limitBounds());
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toBe(key);
      // Every placeholder is filled by what the page passes.
      expect(message, key).not.toMatch(/[{}]/);
    }
    expect(t(locale, 'usage.error.range', limitBounds())).toContain('$10,000.00');
  });
});
