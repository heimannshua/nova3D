import {redirect} from 'next/navigation';
import {describe, expect, it, vi} from 'vitest';
import {catalogs, isolateLtr, locales, placeholdersOf} from '@/lib/i18n';
import {unexpectedResponseMessage} from '@/lib/session-actions';
import {
  attemptUsageAction,
  classify,
  figuresOf,
  formatDollars,
  formatMonth,
  isLimit,
  isMicrodollars,
  limitBounds,
  limitProblemKeys,
  maxLimitMicrodollars,
  meterOf,
  microdollarsPerCent,
  parseDollars,
  reconciles,
  usageActionIdle,
  usageCauseKeys,
  usageFailureKey,
  usageMessageKeys,
  usageNameOf,
  usageStateKeys,
  usageStateTones,
  type UsageActionState,
  type UsageState,
} from '@/lib/usage-view';

// What the Usage and limits page and its two Server Actions agree on (lib/usage-view.ts), without a browser or a server: the money (one parser
// and one formatter), the state of a limit by integer arithmetic at its edges, the figures that must reconcile, the meter, and how a call that
// did not answer is read.

describe('formatDollars: the one place dollars are written', () => {
  it.each([
    [0, '$0.00'],
    [25_000_000, '$25.00'],
    [50_000_000, '$50.00'],
    [10_000, '$0.01'],
    [990_000, '$0.99'],
    [1_000_000, '$1.00'],
    [999_990_000, '$999.99'],
    [1_000_000_000, '$1,000.00'],
    [10_000_000_000, '$10,000.00'],
    [1_234_560_000, '$1,234.56'],
  ])('writes the whole cents %i as %s', (microdollars, text) => {
    expect(formatDollars(microdollars)).toBe(text);
  });

  it.each([
    [19_999_999, '$19.999999'],
    [1_500, '$0.0015'],
    [1, '$0.000001'],
    [12_340_001, '$12.340001'],
    [2_000_500, '$2.0005'],
  ])('writes an amount that is not whole cents exactly, so the amounts on a card always add up: %i is %s', (microdollars, text) => {
    expect(formatDollars(microdollars)).toBe(text);
  });

  it('writes a negative amount with its sign, and the largest safe integer without losing a digit', () => {
    expect(formatDollars(-25_000_000)).toBe('-$25.00');
    expect(formatDollars(1_000_000_000_000_000)).toBe('$1,000,000,000.00');
  });

  it.each([0.5, 1.000001, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -(2 ** 53)])('refuses %s, an amount that is not a whole number of microdollars, instead of rounding it', (value) => {
    expect(() => formatDollars(value)).toThrow(RangeError);
  });

  it('is deterministic: no locale and no Intl, so the server and the browser write the same text', () => {
    const source = String(formatDollars);
    expect(source).not.toMatch(/Intl|toLocale/);
    const original = Intl.NumberFormat;
    // Even if the runtime's number formatting were replaced, the text would not change.
    Object.defineProperty(Intl, 'NumberFormat', {value: () => {
      throw new Error('formatDollars must not use Intl');
    }, configurable: true});
    try {
      expect(formatDollars(25_000_000)).toBe('$25.00');
    } finally {
      Object.defineProperty(Intl, 'NumberFormat', {value: original, configurable: true});
    }
  });
});

describe('parseDollars: a typed limit', () => {
  it.each([
    ['25', 25_000_000],
    ['25.00', 25_000_000],
    ['40.5', 40_500_000],
    ['40.50', 40_500_000],
    ['$40.50', 40_500_000],
    ['$ 40.50', 40_500_000],
    ['  40  ', 40_000_000],
    ['0', 0],
    ['0.00', 0],
    ['0.01', 10_000],
    ['.5', 500_000],
    ['40.', 40_000_000],
    ['1,000', 1_000_000_000],
    ['1,000.00', 1_000_000_000],
    ['10000', 10_000_000_000],
    ['10,000.00', 10_000_000_000],
    ['12.340', 12_340_000],
    ['007', 7_000_000],
    ['１２', 12_000_000],
  ])('reads %j as %i microdollars', (typed, microdollars) => {
    expect(parseDollars(typed)).toEqual({ok: true, microdollars});
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['$', 'empty'],
    [undefined, 'empty'],
    [null, 'empty'],
    [25, 'empty'],
    ['abc', 'format'],
    ['4o', 'format'],
    ['40 dollars', 'format'],
    ['1.2.3', 'format'],
    ['1,00', 'format'],
    ['1,0000', 'format'],
    ['.', 'format'],
    ['-', 'format'],
    ['--5', 'format'],
    ['١٢', 'format'],
    ['1e3', 'format'],
    ['0x10', 'format'],
    ['NaN', 'format'],
    ['Infinity', 'format'],
    ['-5', 'negative'],
    ['-0.01', 'negative'],
    ['$-5', 'negative'],
    ['- 5', 'negative'],
    ['12.345', 'cents'],
    ['0.001', 'cents'],
    ['40.501', 'cents'],
    ['10,000.005', 'cents'],
    ['10000.01', 'range'],
    ['10,001', 'range'],
    ['10001', 'range'],
    ['99999999999999999999999', 'range'],
  ] as const)('refuses %j as %s', (typed, problem) => {
    expect(parseDollars(typed)).toEqual({ok: false, problem});
  });

  it('refuses a number written with more than 64 characters as out of range, before any arithmetic, and says the rule: leading zeros count as characters', () => {
    // 64 characters is the longest a limit may be written: a valid value with 62 leading zeros (64 characters in all) is read, one more zero is not.
    expect(parseDollars(`${'0'.repeat(62)}40`)).toEqual({ok: true, microdollars: 40_000_000});
    expect(parseDollars(`${'0'.repeat(63)}40`)).toEqual({ok: false, problem: 'range'});
    expect(parseDollars(`${'0'.repeat(80)}40`)).toEqual({ok: false, problem: 'range'});
    expect(parseDollars(`${'0'.repeat(80)}0`)).toEqual({ok: false, problem: 'range'});
    // The decimals and separators count too.
    expect(parseDollars(`${'0'.repeat(57)}40.5000`)).toEqual({ok: true, microdollars: 40_500_000});
    expect(parseDollars(`${'0'.repeat(58)}40.5000`)).toEqual({ok: false, problem: 'range'});
    // A very long digit string, whatever its value, is `range` and costs a length check: no BigInt is made of it.
    const original = globalThis.BigInt;
    let made = 0;
    globalThis.BigInt = ((value: Parameters<BigIntConstructor>[0]) => {
      made += 1;
      return original(value);
    }) as unknown as BigIntConstructor;
    try {
      expect(parseDollars('9'.repeat(100_000))).toEqual({ok: false, problem: 'range'});
      expect(parseDollars(`${'1,000'.repeat(40)}.00`)).toEqual({ok: false, problem: 'format'});
      expect(made).toBe(0);
    } finally {
      globalThis.BigInt = original;
    }
    // Text that is not a number is still `format`, however long: the remedy is the same as for a short one.
    expect(parseDollars('x'.repeat(200))).toEqual({ok: false, problem: 'format'});
  });

  it('only ever answers a limit the database accepts: whole cents from $0 to $10,000', () => {
    for (let cents = 0; cents <= 1_000_000; cents += 7919) {
      const parsed = parseDollars((cents / 100).toFixed(2));
      expect(parsed).toEqual({ok: true, microdollars: cents * microdollarsPerCent});
      if (parsed.ok) expect(isLimit(parsed.microdollars)).toBe(true);
    }
    expect(parseDollars('10000.00')).toEqual({ok: true, microdollars: maxLimitMicrodollars});
  });

  it('round-trips with formatDollars for every limit it can make', () => {
    for (const microdollars of [0, 10_000, 25_000_000, 40_500_000, 999_990_000, 1_000_000_000, 10_000_000_000]) {
      expect(parseDollars(formatDollars(microdollars))).toEqual({ok: true, microdollars});
    }
  });

  it('names the bounds of a limit through the one formatter, isolated left to right, and no message holds a number of dollars of its own', () => {
    expect(limitBounds()).toEqual({min: isolateLtr('$0.00'), max: isolateLtr('$10,000.00')});
    for (const locale of locales) {
      expect(placeholdersOf(catalogs[locale]['usage.error.range']), locale).toEqual(['max']);
      expect(placeholdersOf(catalogs[locale]['usage.error.invalidLimit']), locale).toEqual(['max', 'min', 'name']);
    }
    // No message of the Usage page writes a dollar amount: the digits in the field messages are examples of typing (40, 40.50), never an amount with a sign.
    for (const locale of locales) {
      for (const [key, message] of Object.entries(catalogs[locale])) {
        if (!key.startsWith('usage.') && !key.startsWith('admin.usage.')) continue;
        const texts = typeof message === 'string' ? [message] : Object.values(message);
        for (const text of texts) expect(text, `${locale}:${key}`).not.toMatch(/\$\s?\d/);
      }
    }
  });

  it('has a message, in both languages, for every way a typed limit can fail', () => {
    expect(Object.keys(limitProblemKeys).sort()).toEqual(['cents', 'empty', 'format', 'negative', 'range']);
    for (const locale of locales) for (const key of Object.values(limitProblemKeys)) expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
  });
});

describe('isLimit and isMicrodollars', () => {
  it('accept whole cents from $0 to the $10,000 ceiling and nothing else', () => {
    for (const value of [0, 10_000, 25_000_000, 10_000_000_000]) expect(isLimit(value)).toBe(true);
    for (const value of [-10_000, 1, 9_999, 10_000_010_000, 10_000_000_001, 0.5, Number.NaN, '25', null, undefined, 2 ** 60]) expect(isLimit(value)).toBe(false);
  });

  it('accept an amount that is a whole, safe, non-negative number', () => {
    for (const value of [0, 1, 19_999_999, 1_000_000_000_000_000]) expect(isMicrodollars(value)).toBe(true);
    for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, '5', null]) expect(isMicrodollars(value)).toBe(false);
  });
});

describe('classify: the state of a limit, by integer arithmetic only, at its edges', () => {
  const limit = 25_000_000;
  it.each([
    [0, 'under'],
    [1, 'under'],
    [19_999_999, 'under'],
    [20_000_000, 'nearly'],
    [20_000_001, 'nearly'],
    [24_999_999, 'nearly'],
    [25_000_000, 'reached'],
    [25_000_001, 'reached'],
    [40_000_000, 'reached'],
  ] as [number, UsageState][])('with a limit of $25.00, %i used is %s', (used, state) => {
    expect(classify(limit, used)).toBe(state);
  });

  it('calls a limit of 0 reached, whether anything is used or not', () => {
    expect(classify(0, 0)).toBe('reached');
    expect(classify(0, 1)).toBe('reached');
    expect(classify(0, 25_000_000)).toBe('reached');
  });

  it('puts the 80% edge exactly at used x 5 = limit x 4, for any limit, with no rounding', () => {
    for (const edge of [10_000, 30_000, 50_000, 70_000, 12_340_000, 10_000_000_000]) {
      const eighty = (edge / 5) * 4;
      expect(classify(edge, eighty - 1)).toBe('under');
      expect(classify(edge, eighty)).toBe('nearly');
      expect(classify(edge, edge - 1)).toBe('nearly');
      expect(classify(edge, edge)).toBe('reached');
    }
  });

  it('cannot overflow or round at the largest amounts a period may hold', () => {
    const big = 2_000_000_000_000_000;
    expect(classify(maxLimitMicrodollars, big)).toBe('reached');
    expect(classify(maxLimitMicrodollars, 7_999_999_999)).toBe('under');
    expect(classify(maxLimitMicrodollars, 8_000_000_000)).toBe('nearly');
  });

  it('has a word, a note and a tone for each state, in both languages', () => {
    for (const state of ['under', 'nearly', 'reached'] as const) {
      expect(usageStateTones[state]).toMatch(/^(success|warning|danger)$/);
      for (const locale of locales) {
        expect(catalogs[locale][usageStateKeys[state].label], `${locale}:${state}`).toBeTruthy();
        expect(catalogs[locale][usageStateKeys[state].note], `${locale}:${state}`).toBeTruthy();
      }
    }
    expect(new Set(Object.values(usageStateTones)).size).toBe(3);
    expect(catalogs.en['usage.state.reached.note']).toMatch(/blocked/);
    expect(catalogs.en['usage.state.reached.note']).toMatch(/already running finishes/);
    expect(catalogs.en['usage.state.reached.note']).toMatch(/Disabling the Account still cancels it/);
  });
});

describe('figuresOf and reconciles: the four amounts always add up', () => {
  const row = (limit: number, settled: number, reserved: number) => ({limit, settled, reserved});

  it('shows the worked examples of the story', () => {
    // 25M limit, 10M settled, 2M reserved: a change to 40M carries 10M and 2M, so 28M is available.
    expect(figuresOf(row(40_000_000, 10_000_000, 2_000_000))).toEqual({limit: 40_000_000, settled: 10_000_000, reserved: 2_000_000, used: 12_000_000, available: 28_000_000, over: 0, state: 'under'});
    // ... and a reset carries nothing settled and the 2M still reserved: 23M of 25M is available.
    expect(figuresOf(row(25_000_000, 0, 2_000_000))).toEqual({limit: 25_000_000, settled: 0, reserved: 2_000_000, used: 2_000_000, available: 23_000_000, over: 0, state: 'under'});
  });

  it('lowering a limit below what is used leaves the Account at its limit, with the amount over shown', () => {
    expect(figuresOf(row(10_000_000, 20_000_000, 0))).toEqual({limit: 10_000_000, settled: 20_000_000, reserved: 0, used: 20_000_000, available: 0, over: 10_000_000, state: 'reached'});
  });

  it('reconciles in every state: settled + reserved + available is the limit, or the limit + over is what is used', () => {
    const limits = [0, 10_000, 25_000_000, 50_000_000, 10_000_000_000];
    const amounts = [0, 1, 9_999, 5_000_000, 19_999_999, 20_000_000, 24_999_999, 25_000_000, 30_000_001, 10_000_000_000, 12_000_000_000];
    let checked = 0;
    for (const limit of limits) {
      for (const settled of amounts) {
        for (const reserved of amounts) {
          const figures = figuresOf(row(limit, settled, reserved));
          expect(reconciles(figures), JSON.stringify(figures)).toBe(true);
          expect(figures.available === 0 || figures.over === 0).toBe(true);
          expect(figures.state).toBe(classify(limit, settled + reserved));
          checked += 1;
        }
      }
    }
    expect(checked).toBe(limits.length * amounts.length * amounts.length);
  });

  it('notices amounts that do not add up', () => {
    const figures = figuresOf(row(25_000_000, 5_000_000, 5_000_000));
    expect(reconciles(figures)).toBe(true);
    expect(reconciles({...figures, available: figures.available + 1})).toBe(false);
    expect(reconciles({...figures, over: 1})).toBe(false);
    const over = figuresOf(row(10_000_000, 15_000_000, 0));
    expect(reconciles(over)).toBe(true);
    expect(reconciles({...over, over: over.over - 1})).toBe(false);
  });
});

describe('meterOf', () => {
  it('splits the bar into settled then reserved, in whole percents of the limit, never above 100 together', () => {
    expect(meterOf(figuresOf({limit: 25_000_000, settled: 0, reserved: 0}))).toEqual({settledPercent: 0, reservedPercent: 0, usedPercent: 0});
    expect(meterOf(figuresOf({limit: 25_000_000, settled: 10_000_000, reserved: 5_000_000}))).toEqual({settledPercent: 40, reservedPercent: 20, usedPercent: 60});
    expect(meterOf(figuresOf({limit: 25_000_000, settled: 19_999_999, reserved: 0}))).toEqual({settledPercent: 79, reservedPercent: 0, usedPercent: 79});
    expect(meterOf(figuresOf({limit: 25_000_000, settled: 25_000_000, reserved: 0}))).toEqual({settledPercent: 100, reservedPercent: 0, usedPercent: 100});
  });

  it('is full, and never more, over the limit', () => {
    expect(meterOf(figuresOf({limit: 10_000_000, settled: 20_000_000, reserved: 5_000_000}))).toEqual({settledPercent: 100, reservedPercent: 0, usedPercent: 100});
    expect(meterOf(figuresOf({limit: 10_000_000, settled: 6_000_000, reserved: 40_000_000}))).toEqual({settledPercent: 60, reservedPercent: 40, usedPercent: 100});
  });

  it('is full for a limit of 0, the way the state says it is reached', () => {
    expect(meterOf(figuresOf({limit: 0, settled: 0, reserved: 0}))).toEqual({settledPercent: 0, reservedPercent: 0, usedPercent: 100});
    expect(meterOf(figuresOf({limit: 0, settled: 1, reserved: 0}))).toEqual({settledPercent: 0, reservedPercent: 100, usedPercent: 100});
  });
});

describe('words for the rows', () => {
  it('exist for every cause and every answer that is a message, in both languages', () => {
    expect(Object.keys(usageCauseKeys).sort()).toEqual(['change', 'initial', 'month', 'reset']);
    for (const locale of locales) {
      for (const key of [...Object.values(usageCauseKeys), ...Object.values(usageMessageKeys)]) expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
    }
  });

  it('pick a message for a refusal that offers the step-up, one that does not, and for a failure that may or may not have changed something', () => {
    expect(usageFailureKey({outcome: 'refused', stepUp: true})).toBe('usage.error.needsConfirm');
    expect(usageFailureKey({outcome: 'refused', stepUp: false})).toBe('usage.error.refused');
    expect(usageFailureKey({outcome: 'unavailable', unknown: false})).toBe('usage.error.unavailable');
    expect(usageFailureKey({outcome: 'unavailable', unknown: true})).toBe('usage.error.unknown');
    expect(catalogs.en['usage.error.unknown']).toMatch(/Check the list/);
  });

  it('write the month as 2026-10, and nothing for a date that is not the first of a month', () => {
    expect(formatMonth('2026-10-01')).toBe('2026-10');
    expect(formatMonth('2026-01-01')).toBe('2026-01');
    for (const bad of ['2026-10-02', '2026-13-01', '2026-00-01', '2026-10', 'October', '']) expect(formatMonth(bad)).toBe('');
  });

  it('name an Account by its address, or by the stand-in when Auth no longer vouches for one', () => {
    expect(usageNameOf({email: 'dana@example.com'}, 'none')).toBe('dana@example.com');
    expect(usageNameOf({email: null}, 'none')).toBe('none');
  });
});

describe('attemptUsageAction', () => {
  const data = () => new FormData();

  it('passes the action\'s own answer through', async () => {
    const answer: UsageActionState = {outcome: 'refused', stepUp: true};
    expect(await attemptUsageAction(async () => answer, usageActionIdle, data(), vi.fn())).toBe(answer);
  });

  it('hands the action the previous state and the form', async () => {
    const action = vi.fn(async () => usageActionIdle);
    const form = data();
    await attemptUsageAction(action, {outcome: 'stale'}, form, vi.fn());
    expect(action).toHaveBeenCalledWith({outcome: 'stale'}, form);
  });

  it('rethrows a redirect for Next.js to follow', async () => {
    const navigate = vi.fn();
    let thrown: unknown;
    try {
      redirect('/login');
    } catch (error) {
      thrown = error;
    }
    await expect(
      attemptUsageAction(async () => {
        throw thrown;
      }, usageActionIdle, data(), navigate),
    ).rejects.toBe(thrown);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('loads the page again when the answer was a redirect by the proxy, and keeps the previous state', async () => {
    const navigate = vi.fn();
    const previous: UsageActionState = {outcome: 'reset'};
    const state = await attemptUsageAction(
      async () => {
        throw new Error(unexpectedResponseMessage);
      },
      previous,
      data(),
      navigate,
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(state).toBe(previous);
  });

  it('reads any other failure as an answer that did not come: unavailable, and the change may have been made', async () => {
    const navigate = vi.fn();
    const state = await attemptUsageAction(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      usageActionIdle,
      data(),
      navigate,
    );
    expect(state).toEqual({outcome: 'unavailable', unknown: true});
    expect(navigate).not.toHaveBeenCalled();
  });
});
