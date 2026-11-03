import type {ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The Usage and limits PAGE (app/admin/usage/page.tsx, Story 2.4), not the cards it renders (tests/unit/usage-page.test.tsx): who gets the page, what happens
// when the database says the caller is no Administrator, when it cannot be read at all, and what a listed answer is passed on as. The guard, the
// confirmation read and the typed call are faked; the page's own decisions are the real ones. What needs a browser is in tests/e2e/usage.spec.ts.
const request = vi.hoisted(() => ({cookies: {} as Record<string, string>}));
const mocks = vi.hoisted(() => ({access: null as unknown, listUsage: vi.fn(), listOverrunIncidents: vi.fn(), readConfirmation: vi.fn()}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in request.cookies ? {name, value: request.cookies[name]} : undefined),
    getAll: () => Object.entries(request.cookies).map(([name, value]) => ({name, value})),
  }),
  headers: async () => ({get: () => null}),
}));
vi.mock('@/lib/auth', async (importOriginal) => {
  const {notFound} = await import('next/navigation');
  return {
    ...(await importOriginal<typeof import('@/lib/auth')>()),
    getAccess: async () => mocks.access,
    // As lib/auth.ts: anyone but an active Administrator gets the 404 page.
    requireAdministrator: async () => {
      const access = mocks.access as {state: string; account?: {role: string}};
      if (access.state !== 'active' || access.account?.role !== 'administrator') return notFound();
      return access;
    },
  };
});
vi.mock('@/lib/administered', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/administered')>()), readConfirmation: mocks.readConfirmation}));
vi.mock('@/lib/usage', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/usage')>()), listUsage: mocks.listUsage, listOverrunIncidents: mocks.listOverrunIncidents}));

import UsagePage, {generateMetadata} from '@/app/admin/usage/page';
import {UsageContent} from '@/components/admin/usage-content';
import {gatingTimeoutMs} from '@/lib/access';
import {AccountsUnavailableError} from '@/lib/accounts';
import {locales, translate, type Locale} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import type {UsageIncident, UsageRow} from '@/lib/usage-view';

const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const user = {id: 'u', email: 'admin@example.com', sessionId: 's'};
const access = (role: 'administrator' | 'member', epoch = 4) => ({state: 'active', user, account: {accountId: ACCOUNT, workspaceId: null, role, epoch, preferences: null}});
const rows: UsageRow[] = [
  {accountId: ACCOUNT, email: 'admin@example.com', role: 'administrator', status: 'active', seq: 1, monthStart: '2026-10-01', limit: 50_000_000, settled: 0, reserved: 0, cause: 'initial'},
  {accountId: '11111111-1111-4111-8111-111111111111', email: 'dana@example.com', role: 'member', status: 'active', seq: 3, monthStart: '2026-10-01', limit: 25_000_000, settled: 21_000_000, reserved: 0, cause: 'change'},
];

const incidents: UsageIncident[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    accountId: '11111111-1111-4111-8111-111111111111',
    provider: 'anthropic',
    operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    jobId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reserved: 1_000_000,
    evidence: 1_750_000,
    over: 750_000,
    createdAt: '2026-10-12T00:24:36+00:00',
    clearedAt: null,
    clearedBy: null,
    clearedByEmail: null,
  },
];

const text = (markup: string) => markup.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const render = (locale: Locale, element: ReactElement) => renderToStaticMarkup(<I18nProvider locale={locale}>{element}</I18nProvider>);
/** What a thrown Next.js navigation (notFound, redirect) says it is. */
const digest = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return (error as {digest?: string}).digest ?? 'error';
  }
  return null;
};
const printed = () => vi.mocked(console.error).mock.calls.flat().map(String).join('\n');

beforeEach(() => {
  request.cookies = {};
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  mocks.access = access('administrator');
  mocks.listUsage.mockReset().mockResolvedValue({outcome: 'listed', rows});
  mocks.listOverrunIncidents.mockReset().mockResolvedValue({outcome: 'listed', incidents});
  mocks.readConfirmation.mockReset().mockResolvedValue('confirmed');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the Usage and limits page', () => {
  it('passes a listed answer on as it is, with the confirmation, and asks as the verified Administrator\'s Account and epoch', async () => {
    const element = (await UsagePage()) as ReactElement<{rows: UsageRow[] | null; confirmation: string}>;
    expect(element.type).toBe(UsageContent);
    expect(element.props.rows).toEqual(rows);
    expect(element.props.confirmation).toBe('confirmed');
    expect(mocks.listUsage).toHaveBeenCalledTimes(1);
    expect(mocks.listUsage).toHaveBeenCalledWith({accountId: ACCOUNT, epoch: 4}, {timeoutMs: gatingTimeoutMs});
    expect(mocks.readConfirmation).toHaveBeenCalledWith(user);
  });

  it('passes the overrun incidents on as they are, and asks for them as the verified Administrator\'s Account and epoch, with the default limit', async () => {
    const element = (await UsagePage()) as ReactElement<{incidents: UsageIncident[] | null}>;
    expect(element.props.incidents).toEqual(incidents);
    expect(mocks.listOverrunIncidents).toHaveBeenCalledTimes(1);
    expect(mocks.listOverrunIncidents).toHaveBeenCalledWith({accountId: ACCOUNT, epoch: 4}, {}, {timeoutMs: gatingTimeoutMs});
  });

  it('passes an empty list of incidents on as an empty list, not as a failed read', async () => {
    mocks.listOverrunIncidents.mockResolvedValue({outcome: 'listed', incidents: []});
    expect(((await UsagePage()) as ReactElement<{incidents: UsageIncident[] | null}>).props.incidents).toEqual([]);
  });

  it.each([
    ['a database that does not answer', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true})],
    ['an answer that makes no sense', new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true})],
    ['an error it did not expect', new Error('boom')],
  ])('renders, with no incidents, when they cannot be read because of %s: the page says so, still lists the Accounts, and logs the failure by name only', async (_name, error) => {
    mocks.listOverrunIncidents.mockRejectedValue(error);
    const element = (await UsagePage()) as ReactElement<{rows: UsageRow[] | null; incidents: UsageIncident[] | null}>;
    expect(element.type).toBe(UsageContent);
    expect(element.props.incidents).toBeNull();
    expect(element.props.rows).toEqual(rows);
    for (const locale of locales) {
      const markup = render(locale, element);
      expect(text(markup)).toContain(translate(locale, 'usage.incidents.error.title'));
      expect(text(markup)).toContain(translate(locale, 'usage.incidents.error.body'));
      expect(markup).not.toContain('usage-incident"');
      expect([...markup.matchAll(/class="invite-item usage-item"/g)]).toHaveLength(rows.length);
    }
    expect(printed()).toContain('The overrun incidents could not be read.');
    expect(printed()).not.toMatch(/admin@example\.com|dana@example\.com|7a1b2c3d|aaaaaaaa|bbbbbbbb|\$\d/);
  });

  it('shows the incidents when the usage of the Accounts cannot be read, and the Accounts when the incidents cannot', async () => {
    mocks.listUsage.mockRejectedValue(new Error('down'));
    const element = (await UsagePage()) as ReactElement<{rows: UsageRow[] | null; incidents: UsageIncident[] | null}>;
    expect(element.props.rows).toBeNull();
    expect(element.props.incidents).toEqual(incidents);
    const markup = render('en', element);
    expect(markup).toContain('usage-incident"');
    expect(text(markup)).toContain(translate('en', 'usage.list.error.title'));
  });

  it.each(['needed', 'unknown'] as const)('passes the confirmation %s on, so the page offers the step-up beforehand only when it is needed', async (confirmation) => {
    mocks.readConfirmation.mockResolvedValue(confirmation);
    expect(((await UsagePage()) as ReactElement<{confirmation: string}>).props.confirmation).toBe(confirmation);
  });

  it('passes an empty list on as an empty list, not as a failed read', async () => {
    mocks.listUsage.mockResolvedValue({outcome: 'listed', rows: []});
    expect(((await UsagePage()) as ReactElement<{rows: UsageRow[] | null}>).props.rows).toEqual([]);
  });

  it('is a 404, as for a page that does not exist, when the database says the caller is no longer an active Administrator (the authority changed since the gate)', async () => {
    mocks.listUsage.mockResolvedValue({outcome: 'denied'});
    expect(await digest(UsagePage())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    // Nothing of the listing, the confirmation or a number comes out of it.
    expect(printed()).not.toContain('could not be read');
  });

  it('is a 404 when the database says the caller is no longer an active Administrator on the incidents alone, and nothing of the incidents comes out of it', async () => {
    mocks.listOverrunIncidents.mockResolvedValue({outcome: 'denied'});
    expect(await digest(UsagePage())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(printed()).not.toContain('could not be read');
  });

  it('is a 404 for an Account that is not the Administrator, and for a session that is not active, before it asks the database for any usage', async () => {
    mocks.access = access('member');
    expect(await digest(UsagePage())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    mocks.access = {state: 'unregistered'};
    expect(await digest(UsagePage())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(mocks.listUsage).not.toHaveBeenCalled();
    expect(mocks.listOverrunIncidents).not.toHaveBeenCalled();
    expect(mocks.readConfirmation).not.toHaveBeenCalled();
  });

  it.each([
    ['a database that does not answer', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true})],
    ['an answer that makes no sense', new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {retryable: false, outcomeUnknown: true})],
    ['an error it did not expect', new Error('boom')],
  ])('renders, with no rows, when the read fails with %s: the page says it could not be loaded and shows no number', async (_name, error) => {
    mocks.listUsage.mockRejectedValue(error);
    // The incidents are another read: with none to show, the page holds no amount at all.
    mocks.listOverrunIncidents.mockResolvedValue({outcome: 'listed', incidents: []});
    const element = (await UsagePage()) as ReactElement<{rows: UsageRow[] | null}>;
    expect(element.type).toBe(UsageContent);
    expect(element.props.rows).toBeNull();
    for (const locale of locales) {
      const markup = render(locale, element);
      expect(text(markup)).toContain(translate(locale, 'usage.list.error.title'));
      expect(text(markup)).toContain(translate(locale, 'usage.list.error.body'));
      expect(markup).toContain('role="alert"');
      expect(markup).not.toContain('usage-item');
      expect(markup).not.toMatch(/\$\d/);
    }
    // The log names the failure and nothing else: no address, no ID, no amount.
    expect(printed()).toContain('The usage of the Accounts could not be read.');
    expect(printed()).not.toMatch(/admin@example\.com|dana@example\.com|7a1b2c3d|\$\d/);
  });

  it('still reads the confirmation when the usage cannot be read, so the step-up can be offered beside the failure', async () => {
    mocks.listUsage.mockRejectedValue(new Error('down'));
    mocks.readConfirmation.mockResolvedValue('needed');
    const element = (await UsagePage()) as ReactElement<{confirmation: string}>;
    expect(element.props.confirmation).toBe('needed');
    expect(render('en', element)).toContain('/step-up?for=administration');
  });

  it('renders every card it was given, in both languages, when the read works', async () => {
    const element = await UsagePage();
    for (const locale of locales) {
      const markup = render(locale, element);
      expect([...markup.matchAll(/class="invite-item usage-item"/g)]).toHaveLength(rows.length);
      expect(text(markup)).toContain('dana@example.com');
      expect(text(markup)).toContain('$21.00');
      // ... and every incident, with the address of its Account.
      expect([...markup.matchAll(/class="invite-item usage-incident"/g)]).toHaveLength(incidents.length);
      expect(text(markup)).toContain('$1.75');
    }
  });
});

describe('the Usage and limits page\'s title', () => {
  it('is Usage and limits for an active Administrator, in the language of the request', async () => {
    expect((await generateMetadata()).title).toBe(translate('en', 'meta.usage'));
    request.cookies = {'nova3d-locale': 'he'};
    expect((await generateMetadata()).title).toBe(translate('he', 'meta.usage'));
  });

  it('is the title of a page that does not exist for anyone else, so the title does not give the page away', async () => {
    for (const other of [access('member'), {state: 'unregistered'}, {state: 'disabled'}]) {
      mocks.access = other;
      expect((await generateMetadata()).title).toBe(translate('en', 'meta.notFound'));
    }
  });

  it('is the title of a page that does not exist when the access cannot be decided', async () => {
    mocks.access = null;
    expect((await generateMetadata()).title).toBe(translate('en', 'meta.notFound'));
  });
});
